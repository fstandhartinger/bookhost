import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  subscription: null as Record<string, unknown> | null,
  teamRole: "member" as "owner" | "admin" | "member",
}));

vi.mock("@/auth", () => ({ auth: state.auth, signOut: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: state.query } }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/components/intake", () => ({ Intake: () => createElement("div", null, "Intake") }));
vi.mock("@/components/action-button", () => ({
  ActionButton: ({ children }: { children: ReactNode }) =>
    createElement("button", null, children),
}));
vi.mock("@/components/onboarding-checklist", () => ({
  OnboardingChecklist: () => null,
}));
vi.mock("@/components/team-panel", () => ({ TeamPanel: () => null }));
vi.mock("@/components/password-form", () => ({
  PasswordForm: () => null,
  RevealPassword: () => null,
}));
vi.mock("@/components/tenant-form", () => ({
  TenantForm: () => null,
  RevealPassword: () => null,
}));
vi.mock("@/components/refresh-status", () => ({ RefreshStatus: () => null }));
vi.mock("@/lib/invoice-preview", () => ({ invoicePreview: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ markNoticeRead: vi.fn() }));
vi.mock("@/lib/security", () => ({
  freshAuthentication: () => true,
}));

import IntakePage from "@/app/app/intake/page";
import Dashboard from "@/app/app/page";

const subscription = {
  status: "trialing",
  trial_end: new Date(Date.now() + 7 * 86400000),
  current_period_end: null,
  has_payment_method: true,
};

function setup(role: "owner" | "member", currentSubscription: Record<string, unknown> | null) {
  state.teamRole = role;
  state.subscription = currentSubscription;
  state.auth.mockResolvedValue({
    auth_time: Math.floor(Date.now() / 1000),
    user: { id: role === "owner" ? "owner-1" : "member-1", email: `${role}@example.invalid` },
  });
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM tenants t JOIN memberships"))
      return { rows: [{ id: "tenant-1", team_id: "team-1", slug: "fixture", role }] };
    if (sql.includes("FROM teams t JOIN memberships"))
      return {
        rows: [{ id: "team-1", name: "Fixture", owner_user_id: "owner-1", role }],
      };
    if (sql.includes("FROM effective_subscriptions"))
      return { rows: currentSubscription ? [currentSubscription] : [] };
    if (sql.includes("FROM tenants WHERE team_id")) return { rows: [] };
    if (sql.includes("FROM users WHERE id"))
      return { rows: [{ email_verified_at: new Date(), password_set_at: new Date() }] };
    if (sql.includes("FROM consents")) return { rows: [] };
    if (sql.includes("FROM notifications")) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  state.auth.mockReset();
  state.query.mockReset();
  setup("member", subscription);
});

describe("member billing view", () => {
  it("does not show checkout for a member with an active trial", async () => {
    const markup = renderToStaticMarkup(await IntakePage());
    expect(markup).not.toContain("No subscription is linked");
    expect(markup).not.toContain("Resume workspace");
    expect(markup).not.toContain("Start checkout");
  });

  it("shows only a neutral member message without a subscription", async () => {
    setup("member", null);
    const markup = renderToStaticMarkup(await IntakePage());
    expect(markup).toContain("Billing is managed by the team owner.");
    expect(markup).not.toContain("Resume workspace");
    expect(markup).not.toContain("Start checkout");
    expect(markup).not.toContain("Manage billing");
  });

  it("keeps the owner checkout notice when no subscription exists", async () => {
    setup("owner", null);
    const markup = renderToStaticMarkup(await IntakePage());
    expect(markup).toContain("No subscription is linked");
    expect(markup).toContain("Resume workspace");
  });

  it("uses neutral dashboard copy for members and keeps owner copy", async () => {
    const memberMarkup = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
    expect(memberMarkup).not.toContain("Your trial starts when you sign up");
    expect(memberMarkup).toContain("You are a member of this workspace.");

    setup("owner", null);
    const ownerMarkup = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
    expect(ownerMarkup).toContain("Your trial starts when you sign up");
  });
});

describe("own-workspace hint", () => {
  async function renderDashboard(
    userId: string,
    teams: Record<string, unknown>[],
    selected?: string,
  ) {
    state.auth.mockResolvedValue({
      auth_time: Math.floor(Date.now() / 1000),
      user: { id: userId, email: `${userId}@example.invalid` },
    });
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM teams t JOIN memberships")) return { rows: teams };
      if (sql.includes("FROM users WHERE id"))
        return {
          rows: [
            {
              email: `${userId}@example.invalid`,
              email_verified_at: new Date(),
              password_set_at: new Date(),
            },
          ],
        };
      return { rows: [] };
    });
    return renderToStaticMarkup(
      await Dashboard({ searchParams: Promise.resolve({ team: selected }) }),
    );
  }

  it("shows the hint to a member of a foreign team without their own team", async () => {
    const markup = await renderDashboard("member-1", [
      { id: "team-f", name: "F-co", owner_user_id: "owner-9", role: "member" },
    ]);
    expect(markup).toContain("You are a member of this workspace.");
    expect(markup).toContain("Want your own workspace?");
    expect(markup).toContain('href="/pricing"');
  });

  it("shows no hint to an owner", async () => {
    const markup = await renderDashboard("owner-1", [
      { id: "team-o", name: "O-co", owner_user_id: "owner-1", role: "owner" },
    ]);
    expect(markup).not.toContain("Want your own workspace?");
  });

  it("shows no hint to a member who already owns a team", async () => {
    const markup = await renderDashboard(
      "member-1",
      [
        { id: "team-f", name: "F-co", owner_user_id: "owner-9", role: "member" },
        { id: "team-o2", name: "Mine", owner_user_id: "member-1", role: "owner" },
      ],
      "team-f",
    );
    expect(markup).not.toContain("Want your own workspace?");
  });
});
