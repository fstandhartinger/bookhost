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
      "SELECT t.*,m.role FROM teams t JOIN memberships m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY (t.owner_user_id=$1) DESC,t.created_at",
      [session.user.id],
    )
  ).rows;
  const team = teams.find((t) => t.id === selectedTeam) || teams[0];
  const isOwner = !team || team.owner_user_id === session.user.id;
  const canManage = team && ["owner", "admin"].includes(team.role);
  const members = canManage
    ? (
        await db.query(
          "SELECT m.user_id,u.email,m.role,m.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY m.created_at,u.email",
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
          "SELECT id,slug,status,desired_state,updated_at,admin_email,(initial_password IS NOT NULL) AS has_password FROM tenants WHERE team_id=$1",
          [team.id],
        )
      ).rows[0]
    : null;
  const user = (
    await db.query(
      "SELECT email_verified_at,password_set_at FROM users WHERE id=$1",
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
      "SELECT id,payload,created_at,read_at FROM notifications WHERE user_id=$1 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 50",
      [session.user.id],
    )
  ).rows;
  const status =
    !billingEligible(subscription) || tenant?.desired_state === "suspended"
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
          <h1 className="text-4xl">{team?.name || "Welcome to Wissen."}</h1>
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
      {teams.length > 1 && (
        <nav aria-label="Teams" className="mt-4 flex flex-wrap gap-4">
          {teams.map((t) => (
            <a
              key={t.id}
              className="underline"
              href={`/app?team=${t.id}`}
              aria-current={team.id === t.id ? "page" : undefined}
            >
              {t.name}
            </a>
          ))}
        </nav>
      )}
      {canManage && (
        <TeamPanel
          teamId={team.id}
          userId={session.user.id}
          role={team.role}
          members={members.map((m) => ({
            ...m,
            created_at: m.created_at.toISOString(),
          }))}
          invites={invites.map((i) => ({
            ...i,
            expires_at: i.expires_at.toISOString(),
          }))}
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
                </p>
                {isOwner && (
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
      {!user?.email_verified_at && (
        <p className="mt-4 text-sm text-slate-500">
          Confirm your e-mail by signing in via link once e-mail sign-in is
          available
        </p>
      )}
      <p className="mt-4 text-sm text-slate-600">
        Your trial starts when you sign up; your workspace is usually ready
        within 5 minutes.
      </p>
      <section
        id="password-setup"
        className={`price-card mt-8 ${setup === "password" ? "ring-2 ring-teal-600" : ""}`}
      >
        <h2 className="text-2xl">Sign-in for next time</h2>
        <p className="mt-3 text-sm text-slate-600">
          Set a password to return to this dashboard. Magic link and Google
          sign-in are coming soon.
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
        <div className="price-card">
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
                {tenant.slug}.wissen.app.mintapis.com
              </p>
              {!delayed &&
                ["pending", "provisioning", "restoring"].includes(status) && (
                  <RefreshStatus />
                )}
              {status === "running" && (
                <>
                  <a
                    className="button mt-6"
                    href={`https://${tenant.slug}.wissen.app.mintapis.com`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open BookStack ↗
                  </a>
                  <a className="button-secondary mt-3" href="/app/intake">
                    Document intake (beta)
                  </a>
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
              <a className="underline" href="/app/intake">
                Open document intake
              </a>
            </p>
          ) : eligible ? (
            <>
              <p className="mt-4 text-slate-600">
                Choose your team’s address. We’ll prepare a dedicated workspace
                for you.
              </p>
              <TenantForm teamName={team.name} />
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
