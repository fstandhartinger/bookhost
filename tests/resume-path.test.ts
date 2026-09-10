import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  event: {} as Stripe.Event,
}));
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "owner", email: "owner@example.invalid" } }),
  signOut: vi.fn(),
  sessionCookie: () => ({
    name: "session",
    options: { path: "/", httpOnly: true },
  }),
}));
vi.mock("@/lib/db", () => ({
  db: { query: mock.query },
  transaction: async (fn: (db: unknown) => unknown) =>
    fn({ query: mock.query }),
}));
vi.mock("@/lib/stripe", () => ({
  stripeClient: () => ({
    checkout: {
      sessions: { create: mock.create, retrieve: async () => checkout },
    },
    subscriptions: { retrieve: mock.retrieve, cancel: vi.fn() },
    webhooks: { constructEvent: () => mock.event },
  }),
}));
vi.mock("next-auth/jwt", () => ({ encode: async () => "fixture-token" }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/security", () => ({
  freshAuthentication: () => true,
  sameOrigin: () => true,
  clientIp: () => "192.0.2.1",
  rateLimit: async () => true,
  digest: () => "fixture-hash",
}));
vi.mock("@/lib/invoice-preview", () => ({
  invoicePreview: async () => "€39 + VAT",
}));
vi.mock("@/components/action-button", () => ({
  ActionButton: ({
    children,
    endpoint,
  }: {
    children: ReactNode;
    endpoint: string;
  }) => createElement("button", { "data-endpoint": endpoint }, children),
}));
vi.mock("@/components/onboarding-checklist", () => ({
  OnboardingChecklist: () => null,
}));
vi.mock("@/components/team-panel", () => ({ TeamPanel: () => null }));
vi.mock("@/components/password-form", () => ({ PasswordForm: () => null }));
vi.mock("@/components/tenant-form", () => ({
  TenantForm: () => null,
  RevealPassword: () => null,
}));
vi.mock("@/components/refresh-status", () => ({ RefreshStatus: () => null }));
vi.mock("@/components/intake", () => ({
  Intake: () => createElement("div", null, "INTAKE-AVAILABLE"),
}));
import { generateNotifications } from "@/lib/notifications";
import { type Queryable } from "@/lib/billing";
import { POST as openCheckout } from "@/app/api/checkout/route";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { GET as welcome } from "@/app/welcome/route";
import Dashboard from "@/app/app/page";
import IntakePage from "@/app/app/intake/page";
import { workspace, itemForUser } from "@/lib/intake/access";
const expiry = new Date("2026-09-23T12:00:00Z");
const team = {
  id: "team",
  name: "Fixture",
  owner_user_id: "owner",
  stripe_customer_id: "cus_fixture",
  role: "owner",
};
const id = "11111111-1111-4111-8111-111111111111";
const checkout = {
  id: "cs_resume",
  status: "complete",
  metadata: { venture: "wissen", team_id: "team" },
  customer: "cus_fixture",
  customer_email: "owner@example.invalid",
  subscription: "sub_paid",
};
let subscription: Record<string, unknown>;
let tenant: {
  id: string;
  team_id: string;
  slug: string;
  host: string;
  status: string;
  desired_state: string;
  error: string | null;
} | null;
let notices: {
  id: string;
  kind: string;
  payload: { text: string };
  created_at: Date;
  resolved_at: Date | null;
}[];
const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });
const db = { query: mock.query } as unknown as Queryable;
const eligible = () =>
  subscription.status === "active" ||
  (subscription.status === "trialing" &&
    new Date(subscription.trial_end as Date) > new Date());
// Stateful in-memory DB boundary; assert security predicates before emulating them.
// Unknown reads throw so a new production query cannot silently get permissive data.
async function query(sql: string, values: unknown[] = []) {
  if (sql.includes("pg_try_advisory_xact_lock"))
    return result([{ acquired: true }]);
  if (sql.includes("pg_advisory_xact_lock")) return result();
  if (sql.startsWith("UPDATE subscriptions SET")) return result();
  if (sql.startsWith("UPDATE tenants n SET")) {
    if (sql.includes("s.status IN ('past_due','unpaid')")) return result();
    expect(sql).toContain("s.trial_end <= $1");
    expect(sql).toContain("s.status='trialing'");
    if (tenant && subscription.status === "trialing" && !eligible())
      tenant.desired_state = "suspended";
    return result();
  }
  if (sql.startsWith("UPDATE tenants SET desired_state")) {
    if (tenant) tenant.desired_state = String(values[1]);
    return result();
  }
  if (sql.startsWith("UPDATE notifications")) {
    if (subscription.status === "active")
      notices.forEach((n) => (n.resolved_at = new Date()));
    return result();
  }
  if (sql.startsWith("INSERT INTO notifications")) {
    if (notices.some((n) => n.kind === values[1])) return result();
    notices.push({
      id: "notice",
      kind: String(values[1]),
      payload: JSON.parse(String(values[3])),
      created_at: new Date(),
      resolved_at: null,
    });
    return result([{ id: "notice" }]);
  }
  if (sql.includes("FROM (SELECT DISTINCT team_id"))
    return result([
      {
        ...subscription,
        owner_user_id: "owner",
        email: "owner@example.invalid",
        desired_state: tenant?.desired_state,
      },
    ]);
  if (sql.startsWith("INSERT INTO subscriptions")) {
    subscription = {
      team_id: values[0],
      stripe_subscription_id: values[1],
      status: values[2],
      trial_end: values[4],
      current_period_end: values[5],
      has_payment_method: values[8],
    };
    return result();
  }
  if (sql.includes("FROM users u JOIN teams t")) return result(); // no competing subscription
  if (sql.includes("FROM tenants t JOIN memberships")) {
    if (sql.includes("WHERE m.user_id=$1")) {
      expect(sql).toContain("t.status='running' AND t.desired_state='running'");
      expect(sql).toContain("trial_end<=now()");
      return result(
        tenant &&
          tenant.status === "running" &&
          tenant.desired_state === "running" &&
          eligible()
          ? [{ ...tenant, role: "owner" }]
          : [],
      );
    }
    return result(
      tenant
        ? [
            {
              ...tenant,
              role: "owner",
              subscription_status: eligible() ? subscription.status : "expired",
            },
          ]
        : [],
    );
  }
  if (sql.includes("FROM intake_items i JOIN tenants"))
    return result(
      tenant
        ? [
            {
              ...tenant,
              tenant_status: tenant.status,
              role: "owner",
              subscription_status: eligible() ? subscription.status : "expired",
            },
          ]
        : [],
    );
  if (
    sql.includes("FROM member_bookstack_logins") ||
    sql.includes("FROM member_bookstack_revocations") ||
    sql.includes("FROM team_checkout_reservations") ||
    sql.startsWith("UPDATE team_checkout_reservations")
  )
    return result();
  if (sql.startsWith("SELECT m.user_id")) return result();
  if (sql.includes("FROM teams")) return result([team]);
  if (sql.includes("FROM effective_subscriptions"))
    return result([
      {
        ...subscription,
        desired_state: tenant?.desired_state,
        tenant_status: tenant?.status,
      },
    ]);
  if (sql.includes("FROM subscriptions"))
    return result(
      sql.includes("status IN") &&
        !["trialing", "active"].includes(String(subscription.status))
        ? []
        : [{ present: 1 }],
    );
  if (sql.includes("FROM tenants WHERE team_id"))
    return result(tenant ? [tenant] : []);
  if (sql.includes("FROM users WHERE id"))
    return result([
      {
        id: "owner",
        email: "owner@example.invalid",
        email_verified_at: expiry,
        password_set_at: expiry,
      },
    ]);
  if (sql.includes("FROM notifications"))
    return result(notices.filter((n) => !n.resolved_at));
  if (sql.includes("FROM memberships WHERE user_id"))
    return result([{ team_id: "team", role: "owner" }]);
  if (
    sql.includes("FROM memberships m") ||
    sql.includes("FROM team_invites") ||
    sql.includes("FROM consents") ||
    sql.includes("FROM checkout_logins")
  )
    return result();
  if (sql.includes("FROM checkout_attempts"))
    return result([{ user_id: "owner" }]);
  if (sql.startsWith("INSERT INTO stripe_events"))
    return result([{ id: "event" }]);
  if (sql.startsWith("INSERT INTO") || sql.startsWith("UPDATE teams"))
    return result();
  throw new Error(`Unhandled mock SQL: ${sql}`);
}
const request = () =>
  new Request("https://bookhost.co/api/checkout", {
    method: "POST",
    body: "{}",
  });
const dashboard = async () =>
  renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
async function deliver(type: string, status = "active") {
  const sub = {
    id: "sub_paid",
    customer: "cus_fixture",
    created: Math.floor(Date.now() / 1000),
    status,
    trial_end: null,
    default_payment_method: "pm_fixture",
    items: {
      data: [
        {
          price: { id: "price_fixture" },
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        },
      ],
    },
  };
  mock.retrieve.mockResolvedValue(sub);
  mock.event = {
    id: `evt_${type}`,
    type,
    data: { object: type === "checkout.session.completed" ? checkout : sub },
  } as Stripe.Event;
  expect(
    (
      await webhook(
        new Request("https://bookhost.co/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "fixture" },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(200);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(expiry);
  vi.stubEnv("STRIPE_PRICE_TEAM", "price_fixture");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "fixture");
  subscription = {
    team_id: "team",
    stripe_subscription_id: "sub_trial",
    status: "trialing",
    trial_end: expiry,
    current_period_end: expiry,
    has_payment_method: false,
  };
  tenant = {
    id,
    team_id: "team",
    slug: "customer-team",
    host: "customer-team.bookhost.co",
    status: "running",
    desired_state: "running",
    error: null,
  };
  notices = [];
  mock.query.mockReset().mockImplementation(query);
  mock.create.mockReset().mockResolvedValue({
    id: checkout.id,
    url: "https://checkout.stripe.com/fixture",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it.each(["checkout.session.completed", "customer.subscription.updated"])(
  "trial expiry -> notice -> dashboard -> paid checkout -> %s -> intake",
  async (type) => {
    expect(await generateNotifications(db, expiry)).toBe(1);
    expect(tenant?.desired_state).toBe("suspended");
    expect(notices[0].kind).toBe("trial_ended");
    expect(await generateNotifications(db, expiry)).toBe(0);
    expect(renderToStaticMarkup(await IntakePage())).not.toContain(
      "INTAKE-AVAILABLE",
    );
    tenant!.status = "suspended"; // worker boundary; executable Python tests cover actual reconciliation
    // Stripe cancels the no-card subscription asynchronously. Before this event, checkout must wait.
    expect((await openCheckout(request())).status).toBe(409);
    mock.event = {
      id: "evt_cancel",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_trial",
          customer: "cus_fixture",
          status: "canceled",
          created: 1,
          trial_end: expiry.getTime() / 1000,
          items: {
            data: [
              {
                price: { id: "price_fixture" },
                current_period_end: expiry.getTime() / 1000,
              },
            ],
          },
        },
      },
    } as Stripe.Event;
    expect(
      (
        await webhook(
          new Request("https://bookhost.co/api/stripe/webhook", {
            method: "POST",
            headers: { "stripe-signature": "fixture" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(200);
    const markup = await dashboard();
    expect(markup).toContain('data-endpoint="/api/checkout"');
    expect(markup).toContain("Resume workspace");
    expect((await openCheckout(request())).status).toBe(200);
    expect(mock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_fixture",
        line_items: [{ price: "price_fixture", quantity: 1 }],
        metadata: { venture: "wissen", team_id: "team" },
        success_url: expect.stringContaining(
          "/welcome?session_id={CHECKOUT_SESSION_ID}",
        ),
      }),
      expect.any(Object),
    );
    const params = mock.create.mock.calls[0][0];
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params.subscription_data).not.toHaveProperty("trial_settings");
    await deliver(type);
    expect(tenant?.desired_state).toBe("running");
    expect(notices.every((n) => n.resolved_at)).toBe(true);
    expect(await dashboard()).toContain("being restored");
    expect(renderToStaticMarkup(await IntakePage())).not.toContain(
      "INTAKE-AVAILABLE",
    );
    const returned = await welcome(
      new NextRequest("https://bookhost.co/welcome?session_id=cs_resume", {
        headers: { cookie: "wissen-checkout=fixture" },
      }),
    );
    expect(returned.headers.get("location")).toContain("/app?setup=password");
    tenant!.status = "running";
    expect(renderToStaticMarkup(await IntakePage())).toContain(
      "INTAKE-AVAILABLE",
    );
    expect(await workspace("owner", id)).toMatchObject({
      desired_state: "running",
    });
  },
);
it.each(["expired", "suspended", "restoring"])(
  "blocks intake page and API during %s",
  async (phase) => {
    if (phase !== "expired") {
      subscription.status = "active";
      tenant!.status = "suspended";
    }
    if (phase === "suspended") tenant!.desired_state = "suspended";
    expect(renderToStaticMarkup(await IntakePage())).not.toContain(
      "INTAKE-AVAILABLE",
    );
    await expect(workspace("owner", id)).rejects.toMatchObject({ status: 409 });
    await expect(itemForUser("owner", id)).rejects.toMatchObject({
      status: 409,
    });
  },
);
it.each(["missing", "destroyed"])(
  "refuses charging for a %s previous workspace",
  async (kind) => {
    subscription.status = "canceled";
    if (kind === "missing") tenant = null;
    else {
      tenant!.status = "failed";
      tenant!.error = "workspace_unavailable";
    }
    const response = await openCheckout(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(
      /workspace.*unavailable.*support/i,
    );
    expect(mock.create).not.toHaveBeenCalled();
  },
);
it("shows an actionable error when payment arrives after workspace destruction", async () => {
  tenant!.status = "failed";
  tenant!.error = "workspace_unavailable";
  await deliver("checkout.session.completed");
  expect(await dashboard()).toMatch(/workspace.*unavailable.*support/i);
  expect(await dashboard()).not.toContain('data-endpoint="/api/checkout"');
});
