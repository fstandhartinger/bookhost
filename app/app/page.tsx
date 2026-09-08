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
  searchParams: Promise<{ setup?: string }>;
}) {
  const { setup } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const team = (
    await db.query("SELECT * FROM teams WHERE owner_user_id=$1", [
      session.user.id,
    ])
  ).rows[0];
  const subscription = team
    ? (
        await db.query(
          "SELECT * FROM subscriptions WHERE team_id=$1 ORDER BY updated_at DESC LIMIT 1",
          [team.id],
        )
      ).rows[0]
    : null;
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
  const status =
    tenant?.desired_state === "suspended" ? "suspended" : tenant?.status;
  const delayed =
    status === "provisioning" &&
    Date.now() - new Date(tenant.updated_at).getTime() > 20 * 60 * 1000;
  const eligible =
    subscription?.status === "active" ||
    (subscription?.status === "trialing" &&
      new Date(subscription.trial_end) > new Date());
  const descriptions: Record<string, string> = {
    pending: "Your workspace is in the queue. We’ll prepare it shortly.",
    provisioning:
      "Your BookStack workspace is being prepared. This page will update when it is ready.",
    running:
      "Your workspace is ready. Open BookStack to start organising your team’s knowledge.",
    failed:
      "We couldn’t finish setting up your workspace. Contact support so we can help.",
    suspended: "suspended — add a payment method to resume",
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
              {status === "suspended" && (
                <ActionButton
                  endpoint="/api/portal"
                  className="button-secondary mt-4"
                >
                  Manage billing
                </ActionButton>
              )}
              <p className="mt-4 break-all text-sm font-medium">
                {tenant.slug}.wissen.app.mintapis.com
              </p>
              {!delayed && ["pending", "provisioning"].includes(status) && (
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
                Start a free trial to create your team’s workspace. No credit
                card needed.
              </p>
              <ActionButton />
            </>
          )}
        </div>
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
          {subscription?.status === "trialing" && (
            <p className="mb-5 text-sm leading-6 text-slate-600">
              Add a payment method to continue after your trial. Without one,
              the subscription ends automatically.
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
                  <a className="underline" href={`/legal/${consent.document}`}>
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
            <a className="underline" href="mailto:info@productivity-boost.com">
              Contact support
            </a>
            .
          </p>
        </aside>
      </div>
    </section>
  );
}
