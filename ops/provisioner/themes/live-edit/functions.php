<?php
/**
 * BookHost Live Edit — BookStack Logical Theme System hook.
 *
 * Installed by ops/provisioner/live_edit_rollout.py into a tenant's
 * bind-mounted /config/www/themes/live-edit/ (symlinked by the linuxserver
 * image to /app/www/themes/live-edit/), activated via APP_THEME=live-edit.
 *
 * Registers the signed ticket route in BookStack's real "web + auth" group,
 * and the signed save route in its "web" group
 * group (ROUTES_REGISTER_WEB_AUTH — see BookStack's
 * app/App/Providers/RouteServiceProvider.php), so unauthenticated requests
 * never reach the handler. It issues a short-lived, HMAC-signed ticket for
 * the *exact signed-in BookStack user and page*, using BookStack's own real
 * permission checks (userCan()) — never a permission BookHost's control
 * plane computed or cached itself. The control plane (lib/live-edit/
 * bookstack-ticket.ts) only re-verifies the signature and expiry; BookStack
 * stays the single source of truth for who may view/edit which page.
 *
 * LIVE_EDIT_TENANT_SLUG and LIVE_EDIT_HMAC_SECRET are tenant-specific env
 * vars set by the rollout script; a ticket forged without this exact
 * tenant's secret fails verification, which is what keeps two tenants'
 * Live Edit sessions isolated from each other.
 */

use BookStack\Entities\Models\Page;
use BookStack\Entities\Repos\PageRepo;
use BookStack\Entities\Repos\RevisionRepo;
use BookStack\Entities\Tools\PageContent;
use BookStack\Activity\ActivityType;
use BookStack\Facades\Activity;
use BookStack\Facades\Theme;
use BookStack\Theming\ThemeEvents;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

Theme::listen(ThemeEvents::ROUTES_REGISTER_WEB_AUTH, function (Router $router) {
    $router->get('live-edit/ticket/{pageId}', function ($pageId) {
        $secret = env('LIVE_EDIT_HMAC_SECRET');
        $tenant = env('LIVE_EDIT_TENANT_SLUG');
        if (!$secret || !$tenant) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $id = (int) $pageId;
        if ($id <= 0) {
            return response()->json(['error' => 'not_found'], 404);
        }

        // scopeVisible() applies BookStack's real query-level view
        // restriction, so a page outside this user's access is a 404 like
        // any other BookStack page they cannot see, not a 403 that would
        // confirm its existence.
        $page = Page::visible()->find($id);
        if (!$page) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if (!userCan('page-view', $page)) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $user = auth()->user();
        $payload = [
            'tenant' => $tenant,
            'pageId' => $page->id,
            'bookstackUserId' => $user->id,
            'userName' => $user->name,
            'userEmail' => $user->email,
            'canEdit' => userCan('page-update', $page),
            'editorType' => (string) $page->editor,
            'exp' => time() + 60,
        ];
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $sig = hash_hmac('sha256', $json, $secret);
        $ticket = rtrim(strtr(base64_encode($json), '+/', '-_'), '=');

        return response()->json(['ticket' => $ticket, 'sig' => $sig]);
    });
});

// The REST API does not offer a conditional page update. This signed route is
// the save-back path for Live Edit: it checks revision_count while holding a
// row lock and performs BookStack's ordinary PageRepo update in the same DB
// transaction. That closes the control-plane GET-to-PUT window without
// replacing BookStack's revision, permission, indexing or activity behavior.
// It is registered outside the session-auth group because calls come from the
// control plane; the per-tenant HMAC, short expiry, page id, expected revision
// and BookStack user id authorize each individual write. CSRF is not relevant
// to this server-to-server route and is disabled only for this endpoint.
Theme::listen(ThemeEvents::ROUTES_REGISTER_WEB, function (Router $router) {
    $route = $router->post('live-edit/save/{pageId}', function (Request $request, $pageId) {
        $secret = env('LIVE_EDIT_HMAC_SECRET');
        $tenant = env('LIVE_EDIT_TENANT_SLUG');
        if (!$secret || !$tenant || !ctype_digit((string) $pageId)) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $id = (int) $pageId;
        $expectedRevision = filter_var($request->input('expectedRevisionCount'), FILTER_VALIDATE_INT);
        $bookstackUserId = filter_var($request->input('bookstackUserId'), FILTER_VALIDATE_INT);
        $expiresAt = filter_var($request->input('exp'), FILTER_VALIDATE_INT);
        $html = $request->input('html');
        $signature = $request->input('signature');
        if (
            $id <= 0 || $expectedRevision === false || $expectedRevision < 0 ||
            $bookstackUserId === false || $bookstackUserId <= 0 ||
            $expiresAt === false || !is_string($html) ||
            !is_string($signature) || !preg_match('/^[a-f0-9]{64}$/i', $signature)
        ) {
            return response()->json(['error' => 'invalid_request'], 400);
        }
        if ($expiresAt < time() || $expiresAt > time() + 60) {
            return response()->json(['error' => 'expired'], 403);
        }

        $htmlToken = rtrim(strtr(base64_encode($html), '+/', '-_'), '=');
        $message = implode("\n", [
            'live-edit-save-v1',
            $tenant,
            (string) $id,
            (string) $bookstackUserId,
            (string) $expectedRevision,
            (string) $expiresAt,
            $htmlToken,
        ]);
        $expectedSignature = hash_hmac('sha256', $message, $secret);
        if (!hash_equals($expectedSignature, strtolower($signature))) {
            return response()->json(['error' => 'invalid_signature'], 403);
        }

        if (!Auth::guard('web')->onceUsingId($bookstackUserId)) {
            return response()->json(['error' => 'user_unavailable'], 403);
        }

        return DB::transaction(function () use ($id, $expectedRevision, $html) {
            $page = Page::query()->whereKey($id)->lockForUpdate()->first();
            if (!$page) {
                return response()->json(['error' => 'not_found'], 404);
            }
            if (!userCan('page-update', $page)) {
                return response()->json(['error' => 'forbidden'], 403);
            }

            if ((int) $page->revision_count !== $expectedRevision) {
                // Keep the native editor's current page intact while saving
                // the collaborative version as a separate normal BookStack
                // revision. Users can compare or restore it from history.
                // The transaction makes the conflict snapshot and revision
                // counter update atomic with respect to other BookStack saves.
                $revisionPage = clone $page;
                (new PageContent($revisionPage))->setNewHTML($html, user());
                $revisionPage->revision_count = ((int) $page->revision_count) + 1;
                $revisionPage->updated_at = now();
                $revisionPage->updated_by = user()->id;

                $page->revision_count = $revisionPage->revision_count;
                $page->updated_at = $revisionPage->updated_at;
                $page->updated_by = user()->id;
                $page->save();

                app(RevisionRepo::class)->storeNewForPage(
                    $revisionPage,
                    'Live Edit conflict copy; a BookStack edit was saved first',
                );
                Activity::add(ActivityType::PAGE_UPDATE, $page);

                return response()->json([
                    'error' => 'revision_conflict',
                    'preserved' => true,
                    'revisionCount' => (int) $page->revision_count,
                ], 409);
            }

            $updated = app(PageRepo::class)->update($page, [
                'html' => $html,
                'changelog' => 'Live edit session',
            ]);
            return response()->json(['revisionCount' => (int) $updated->revision_count]);
        });
    });
    $route->withoutMiddleware(\BookStack\Http\Middleware\VerifyCsrfToken::class);
});
