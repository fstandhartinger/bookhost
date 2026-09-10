import { DomainPanel } from "@/components/domain-panel";
import { isIP } from "node:net";
import { storageNotice } from "@/lib/storage-usage";
import { tenantHost } from "@/lib/tenant-host";
import { NEW_TENANT_DOMAIN } from "@/lib/config";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import React from "react";
import { activeTeamId } from "@/lib/active-team";
import { MemberBookStackLogin } from "@/components/member-bookstack-login";
import { TeamPanel } from "@/components/team-panel";
import { billingEligible } from "@/lib/trial";
import { invoicePreview } from "@/lib/invoice-preview";
import { BillingNotice } from "@/components/billing-notice";
import { markNoticeRead } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { freshAuthentication } from "@/lib/security";
import { PasswordForm } from "@/components/password-form";
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ActionButton } from "@/components/action-button";
import { TenantForm, RevealPassword } from "@/components/tenant-form";
import { RefreshStatus } from "@/components/refresh-status";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your team",
  robots: { index: false, follow: false },
};
const date = (value: Date | string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; team?: string }>;
}) {
  const { setup, team: selectedTeam } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const teams = (
    await db.query(
      "SELECT t.*,m.role FROM teams t JOIN memberships m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY m.created_at DESC,t.id",
      [session.user.id],
    )
  ).rows;
  const activeId = await activeTeamId(session.user.id, selectedTeam);
  const team = teams.find((t) => t.id === activeId) || teams[0];
  // Carry the shown team so document intake cannot land on a different one.
  const intakeHref = team ? `/app/intake?team=${team.id}` : "/app/intake";
  const isOwner = !team || team.owner_user_id === session.user.id;
  const userId = session.user.id;
  const ownsTeam = teams.some((t) => t.owner_user_id === userId);
  const canManage = team && ["owner", "admin"].includes(team.role);
  const revocations = canManage
    ? (
        await db.query(
          "SELECT l.user_id,u.email,l.revocation_error FROM member_bookstack_revocations l JOIN users u ON u.id=l.user_id WHERE l.team_id=$1 AND l.revocation_requested_at IS NOT NULL AND l.revoked_at IS NULL",
          [team.id],
        )
      ).rows
    : [];
  const members = canManage
    ? (
        await db.query(
          "SELECT m.user_id,u.email,m.role,m.created_at,CASE WHEN m.role='owner' THEN CASE WHEN EXISTS(SELECT 1 FROM tenants WHERE team_id=m.team_id AND status='running') THEN 'ready' ELSE 'pending' END WHEN l.last_error IS NOT NULL THEN 'error' WHEN l.bookstack_user_id IS NOT NULL THEN 'ready' ELSE 'pending' END AS bookstack_login_status FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN member_bookstack_logins l ON l.team_id=m.team_id AND l.user_id=m.user_id WHERE m.team_id=$1 ORDER BY m.created_at,u.email",
          [team.id],
        )
      ).rows
    : [];
  const invites = canManage
    ? (
        await db.query(
          "SELECT id,role,uses,max_uses,expires_at FROM team_invites WHERE team_id=$1 AND revoked_at IS NULL AND expires_at>now() AND uses<max_uses ORDER BY created_at DESC",
          [team.id],
        )
      ).rows
    : [];
  const subscription = team
    ? (
        await db.query(
          "SELECT * FROM effective_subscriptions WHERE team_id=$1",
          [team.id],
        )
      ).rows[0]
    : null;
  if (
    isOwner &&
    subscription?.status === "active" &&
    !subscription.cancel_at_period_end
  )
    subscription.invoice_amount = await invoicePreview(
      subscription.stripe_subscription_id,
    );
  // Never serialize or select the password into a server component payload.
  const tenant = team
    ? (
        await db.query(
          "SELECT id,slug,host,status,desired_state,error,updated_at,admin_email,storage_used_bytes,storage_measured_at,(initial_password IS NOT NULL) AS has_password FROM tenants WHERE team_id=$1",
          [team.id],
        )
      ).rows[0]
    : null;
  const domains =
    canManage && tenant
      ? (
          await db.query(
            "SELECT host,status,verification_token,last_error,(removal_requested_at IS NOT NULL) AS removing FROM tenant_domains WHERE team_id=$1 ORDER BY requested_at",
            [team.id],
          )
        ).rows
      : [];
  const memberLogin =
    team && !isOwner
      ? (
          await db.query(
            "SELECT bookstack_user_id,bookstack_role,last_error,(initial_password IS NOT NULL) AS has_password FROM member_bookstack_logins WHERE team_id=$1 AND user_id=$2",
            [team.id, session.user.id],
          )
        ).rows[0]
      : null;
  const user = (
    await db.query(
      "SELECT email,email_verified_at,password_set_at FROM users WHERE id=$1",
      [session.user.id],
    )
  ).rows[0];
  const consents = team
    ? (
        await db.query(
          "SELECT document,version,accepted_at FROM consents WHERE team_id=$1 AND user_id=$2 ORDER BY accepted_at,document",
          [team.id, session.user.id],
        )
      ).rows
    : [];
  const notices = (
    await db.query(
      // Carry the team each notice belongs to. A person can be a member of one
      // team and own another; a payment warning for the team they own must not
      // read as if it concerned the team currently on screen.
      `SELECT n.id,n.payload,n.created_at,n.read_at,t.id AS notice_team_id,t.name AS notice_team_name
       FROM notifications n
       LEFT JOIN subscriptions s ON s.stripe_subscription_id=n.subscription_id
       LEFT JOIN teams t ON t.id=s.team_id
       WHERE n.user_id=$1 AND n.resolved_at IS NULL ORDER BY n.created_at DESC LIMIT 50`,
      [session.user.id],
    )
  ).rows;
  const status =
    tenant?.error === "workspace_unavailable"
      ? "failed"
      : !billingEligible(subscription) || tenant?.desired_state === "suspended"
        ? "suspended"
        : tenant?.status === "suspended"
          ? "restoring"
          : tenant?.status;
  const delayed =
    status === "provisioning" &&
    Date.now() - new Date(tenant.updated_at).getTime() > 20 * 60 * 1000;
  const eligible = billingEligible(subscription);
  const descriptions: Record<string, string> = {
    restoring: "Your subscription is valid. Your workspace is being restored.",
    pending: "Your workspace is in the queue. We’ll prepare it shortly.",
    provisioning:
      "Your BookStack workspace is being prepared. This page will update when it is ready.",
    running:
      "Your workspace is ready. Open BookStack to start organising your team’s knowledge.",
    failed:
      "We couldn’t finish setting up your workspace. Contact support so we can help.",
    suspended:
      "Workspace access is suspended. Follow the billing notice above to restore access.",
  };
  return (
    <section className="py-14">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1 className="text-4xl">{team?.name || "Welcome to BookHost."}</h1>
          <p className="mt-3 text-sm text-slate-600">
            Signed in as {session.user.email}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="button-secondary">Sign out</button>
        </form>
      </div>
      {team && isOwner && (
        <OnboardingChecklist
          teamId={team.id}
          dismissed={!!team.onboarding_dismissed_at}
        />
      )}
      {teams.length > 1 && (
        <nav aria-label="Teams" className="mt-4 flex flex-wrap gap-4">
          <form action="/api/team/active" method="post" className="flex gap-3">
            <label>
              Active team{" "}
              <select name="team" defaultValue={team.id}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="button-secondary">Switch team</button>
          </form>
        </nav>
      )}
      {canManage && (
        <div id="team-members">
          <TeamPanel
            teamId={team.id}
            userId={session.user.id}
            role={team.role}
            revocations={revocations}
            members={members.map((m) => ({
              ...m,
              created_at: m.created_at.toISOString(),
            }))}
            invites={invites.map((i) => ({
              ...i,
              expires_at: i.expires_at.toISOString(),
            }))}
          />
        </div>
      )}
      {canManage && tenant && (
        <DomainPanel
          team={team.id}
          tenantHost={tenant.host || `${tenant.slug}.${NEW_TENANT_DOMAIN}`}
          domains={domains}
          ipv4={
            isIP(process.env.CUSTOM_DOMAIN_IPV4 || "") === 4
              ? process.env.CUSTOM_DOMAIN_IPV4!
              : ""
          }
        />
      )}
      {isOwner && (subscription || tenant) && (
        <BillingNotice
          subscription={
            subscription
              ? {
                  ...subscription,
                  desired_state: tenant?.desired_state,
                  tenant_status: tenant?.status,
                  tenant_error: tenant?.error,
                }
              : null
          }
        />
      )}
      <section className="price-card mt-6">
        <h2 className="text-xl">Notices</h2>
        {notices.length ? (
          <ul className="mt-4 space-y-4">
            {notices.map((notice) => (
              <li key={notice.id} className="border-t pt-4">
                <p
                  className={notice.read_at ? "text-slate-500" : "font-medium"}
                >
                  {notice.payload.text}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {date(notice.created_at)} ·{" "}
                  {notice.read_at ? "Read" : "Unread"}
                  {notice.notice_team_name &&
                    notice.notice_team_id !== team?.id &&
                    ` · ${notice.notice_team_name}`}
                </p>
                {/* Billing always resolves the team this person owns, so the
                    link belongs to anyone who owns one — not only to the owner
                    of the team that happens to be on screen. */}
                {ownsTeam && (
                  <a href="/app/billing" className="mr-4 text-sm underline">
                    Resume workspace
                  </a>
                )}
                {!notice.read_at && (
                  <form
                    className="inline"
                    action={async () => {
                      "use server";
                      const current = await auth();
                      if (!current?.user?.id) redirect("/login");
                      await markNoticeRead(db, current.user.id, notice.id);
                      revalidatePath("/app");
                    }}
                  >
                    <button className="text-sm underline">Mark as read</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">You’re all caught up.</p>
        )}
      </section>
      {user?.email_verified_at && !user?.password_set_at && (
        <p role="status" className="mt-4 rounded-lg bg-amber-50 p-4">
          Your email is now verified. Any password set before verification was
          removed.{" "}
          <a className="underline" href="#password-setup">
            Set a new password
          </a>{" "}
          to use password sign-in.
        </p>
      )}
      {!user?.email_verified_at && (
        <p className="mt-4 text-sm text-slate-500">
          Confirm your e-mail once by signing in with Google or an e-mailed
          sign-in link
        </p>
      )}
      <p className="mt-4 text-sm text-slate-600">
        {isOwner
          ? "Your trial starts when you sign up; your workspace is usually ready within 5 minutes."
          : "You are a member of this workspace. Billing is managed by the owner."}
      </p>
      {!isOwner && !ownsTeam && (
        <p className="mt-4 text-sm text-slate-600">
          Want your own workspace?{" "}
          <a className="underline" href="/pricing">
            Start a separate 14-day trial for your own team
          </a>
          .
        </p>
      )}
      <section
        id="password-setup"
        className={`price-card mt-8 ${setup === "password" ? "ring-2 ring-teal-600" : ""}`}
      >
        <h2 className="text-2xl">Sign-in for next time</h2>
        <p className="mt-3 text-sm text-slate-600">
          Set a password to return to this dashboard. You can also sign in with
          Google or an e-mailed sign-in link.
        </p>
        {user?.password_set_at && (
          <p className="mt-3 text-sm">
            Password set on {date(user.password_set_at)}
          </p>
        )}
        {!user?.password_set_at &&
        !user?.email_verified_at &&
        !freshAuthentication(session.auth_time) ? (
          <a href="/login">Sign in again to set a password</a>
        ) : (
          <PasswordForm
            key={String(user?.password_set_at)}
            hasPassword={Boolean(user?.password_set_at)}
          />
        )}
      </section>
      <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div id="workspace" className="price-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl">Your BookStack</h2>
            {tenant && <span className="badge">{status}</span>}
          </div>
          {tenant ? (
            <>
              <p className="mt-5 leading-7 text-slate-600">
                {delayed
                  ? "Taking longer than expected — we’re on it"
                  : descriptions[status] || "Checking workspace status."}
              </p>
              {storageNotice(
                tenant.storage_used_bytes,
                tenant.storage_measured_at,
              ) && (
                <p
                  role="status"
                  className="mt-4 rounded-lg bg-amber-50 p-4 text-sm"
                >
                  {storageNotice(
                    tenant.storage_used_bytes,
                    tenant.storage_measured_at,
                  )}
                </p>
              )}
              {isOwner && status === "suspended" && (
                <ActionButton
                  endpoint={
                    !subscription ||
                    ["canceled", "incomplete_expired"].includes(
                      subscription.status,
                    )
                      ? "/api/checkout"
                      : "/api/portal"
                  }
                  className="button-secondary mt-4"
                >
                  Resume workspace
                </ActionButton>
              )}
              <p className="mt-4 break-all text-sm font-medium">
                {tenantHost(tenant)}
              </p>
              {!delayed &&
                ["pending", "provisioning", "restoring"].includes(status) && (
                  <RefreshStatus status={status} />
                )}
              {status === "running" && (
                <>
                  <a
                    className="button mt-6"
                    href={`/api/bookstack/open?team=${team.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open BookStack ↗
                  </a>
                  <a
                    className="button-secondary mt-3"
                    href={intakeHref}
                  >
                    Document intake (beta)
                  </a>
                  {!isOwner && (
                    <MemberBookStackLogin
                      key={`${team.id}:${session.user.id}`}
                      teamId={team.id}
                      email={user?.email || session.user.email || ""}
                      host={tenantHost(tenant)}
                      login={memberLogin}
                    />
                  )}
                  {isOwner && (
                    <div className="mt-6 border-t pt-5">
                      <h3 className="font-semibold">First sign-in</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        Your BookStack login is separate from this dashboard.
                      </p>
                      <p className="mt-2 break-all text-sm">
                        Admin email:{" "}
                        <strong>
                          {tenant.admin_email || session.user.email}
                        </strong>
                      </p>
                      {tenant.has_password ? (
                        <RevealPassword />
                      ) : (
                        <p className="mt-3 text-sm text-slate-600">
                          The initial password is no longer stored here. If you
                          need access, use “Forgot password” in BookStack or
                          contact support.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
              {["failed", "suspended"].includes(status) && (
                <a
                  href="mailto:info@productivity-boost.com"
                  className="button-secondary mt-5"
                >
                  Contact support
                </a>
              )}
            </>
          ) : !isOwner ? (
            <p className="mt-4">
              Your owner is setting up this workspace.{" "}
              <a className="underline" href={intakeHref}>
                Open document intake
              </a>
            </p>
          ) : eligible ? (
            <>
              <p className="mt-4 text-slate-600">
                Choose your team’s address. We’ll prepare a dedicated workspace
                for you.
              </p>
              <TenantForm teamName={team.name} domain={NEW_TENANT_DOMAIN} />
            </>
          ) : (
            <>
              <p className="my-5 leading-7 text-slate-600">
                {subscription
                  ? "Restore your subscription before creating a workspace. Follow the billing notice above; a returning subscription has no new free trial."
                  : "Start a free trial to create your team’s workspace. No credit card needed."}
              </p>
              <ActionButton
                endpoint={
                  !subscription ||
                  ["canceled", "incomplete_expired"].includes(
                    subscription.status,
                  )
                    ? "/api/checkout"
                    : "/api/portal"
                }
              >
                {subscription ? "Resume workspace" : "Start free trial"}
              </ActionButton>
            </>
          )}
        </div>
        {isOwner && (
          <aside className="price-card">
            <h2 className="text-xl">Your plan</h2>
            <div className="my-5 flex items-center justify-between">
              <span>Team · €39/month</span>
              <span className="badge">
                {subscription?.status || "Not started"}
              </span>
            </div>
            {subscription?.trial_end && (
              <p className="mb-4 text-sm text-slate-600">
                Trial {subscription.status === "trialing" ? "ends" : "ended"}{" "}
                {date(subscription.trial_end)} (UTC).
              </p>
            )}
            {subscription?.cancel_at_period_end && (
              <p className="mb-4 text-sm text-amber-800">
                Cancels at the end of your billing period
                {subscription.current_period_end
                  ? ` on ${date(subscription.current_period_end)}`
                  : ""}
                .
              </p>
            )}
            {subscription?.status === "trialing" &&
              !subscription.has_payment_method &&
              !subscription.cancel_at_period_end && (
                <p className="mb-5 text-sm leading-6 text-slate-600">
                  Add a payment method to continue after your trial. Without
                  one, the subscription ends automatically.
                </p>
              )}
            {subscription?.status === "past_due" && (
              <p className="mb-5 text-sm text-red-800">
                Your payment needs attention. Update your payment method below.
              </p>
            )}
            {team?.stripe_customer_id ? (
              <ActionButton
                endpoint="/api/portal"
                className="button-secondary w-full"
              >
                Manage billing
              </ActionButton>
            ) : (
              <p className="text-sm text-slate-500">
                Billing becomes available after checkout.
              </p>
            )}
            <section className="mt-6 border-t pt-5">
              <h2 className="text-xl">Contract</h2>
              {consents.length ? (
                consents.map((consent) => (
                  <p
                    key={`${consent.document}-${consent.version}`}
                    className="mt-3 text-sm"
                  >
                    <a
                      className="underline"
                      href={`/legal/${consent.document}`}
                    >
                      {consent.document.toUpperCase()}
                    </a>{" "}
                    · version {consent.version} · accepted{" "}
                    {date(consent.accepted_at)} (UTC)
                  </p>
                ))
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  No contract acceptance recorded yet.
                </p>
              )}
            </section>
            <p className="mt-6 text-xs leading-5 text-slate-500">
              Need a hand?{" "}
              <a
                className="underline"
                href="mailto:info@productivity-boost.com"
              >
                Contact support
              </a>
              .
            </p>
          </aside>
        )}
      </div>
    </section>
  );
}
