<?php
/**
 * BookHost Live Edit — BookStack Logical Theme System hook.
 *
 * Installed by ops/provisioner/live_edit_rollout.py into a tenant's
 * bind-mounted /config/www/themes/live-edit/ (symlinked by the linuxserver
 * image to /app/www/themes/live-edit/), activated via APP_THEME=live-edit.
 *
 * Registers one route, gated by BookStack's own real "web + auth" middleware
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
use BookStack\Facades\Theme;
use BookStack\Theming\ThemeEvents;
use Illuminate\Routing\Router;

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
