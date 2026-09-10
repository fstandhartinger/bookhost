import { describe, expect, it, vi } from "vitest";
import {
  generateNotifications,
  deliverNotifications,
} from "../lib/notifications";
import type { Queryable } from "../lib/billing";

const start = new Date("2026-10-01T00:00:00Z");
const at = (hours: number) => new Date(+start + hours * 3600_000);
const workspaceText =
  "Your BookHost trial is running, but your workspace isn't created yet. Choose your workspace address — it is ready in about five minutes.";
const pageText =
  "Your workspace is ready. Upload one document and approve the suggested page — most teams do this in under five minutes.";
function fixture() {
  const team = {
    team_id: "team",
    owner_user_id: "owner",
    email: "owner@example.invalid",
    stripe_subscription_id: "sub_trial",
    status: "trialing",
    trial_end: at(336),
    current_period_end: at(336),
    team_created_at: start,
    workspace_done: false,
    publish_done: false,
    workspace_exists: false,
  };
  const notices: {
    id: string;
    kind: string;
    period: string;
    payload: { text: string; href: string };
    resolved_at: unknown;
    mail_status: string;
  }[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("pg_try_advisory")) return { rows: [{ acquired: true }] };
    if (sql.includes("UPDATE notifications n SET resolved_at")) {
      // Model the activation resolution only when the query explicitly supports it.
      if (
        sql.includes("activation_workspace") &&
        sql.includes("team_onboarding")
      ) {
        for (const n of notices) {
          if (
            team.status !== "trialing" ||
            +team.trial_end <= +(values[0] as Date) ||
            (n.kind === "activation_workspace"
              ? team.workspace_done
              : team.publish_done)
          )
            n.resolved_at = values[0];
        }
      }
      return { rows: [] };
    }
    if (sql.includes("SELECT s.*")) return { rows: [team] };
    if (sql.includes("INSERT INTO notifications")) {
      const [, kind, period, payload] = values as string[];
      if (notices.some((n) => n.kind === kind && n.period === period))
        return { rows: [], rowCount: 0 };
      const n = {
        id: String(notices.length),
        kind,
        period,
        payload: JSON.parse(payload),
        resolved_at: null,
        mail_status: "pending",
      };
      notices.push(n);
      return { rows: [{ id: n.id }], rowCount: 1 };
    }
    if (sql.includes("JOIN users u ON u.id=n.user_id"))
      return {
        rows: notices
          .filter((n) => !n.resolved_at && n.mail_status !== "sent")
          .map((n) => ({ ...n, email: team.email })),
      };
    if (sql.includes("UPDATE notifications SET mail_status"))
      notices.find((n) => n.id === values[0])!.mail_status =
        values[1] as string;
    return { rows: [] };
  });
  return { team, notices, query, db: { query } as unknown as Queryable };
}
describe("activation nudges", () => {
  it("waits 24 hours, displays in-app and deduplicates subsequent runs", async () => {
    const f = fixture();
    const send = vi.fn();
    expect(await generateNotifications(f.db, at(23))).toBe(0);
    expect(await generateNotifications(f.db, at(25))).toBe(1);
    expect(f.notices).toEqual([
      expect.objectContaining({
        kind: "activation_workspace",
        period: `sub_trial:${at(336).toISOString()}`,
        payload: { text: workspaceText, href: "/app" },
      }),
    ]);
    await deliverNotifications(f.db, send);
    expect(send).not.toHaveBeenCalled();
    expect(await generateNotifications(f.db, at(26))).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("resolves a failed workspace notice before retry when the step completes", async () => {
    const f = fixture();
    await generateNotifications(f.db, at(25));
    f.team.workspace_done = true;
    f.team.workspace_exists = true;
    const send = vi.fn();
    await generateNotifications(f.db, at(26));
    expect(f.notices[0]?.resolved_at).toEqual(at(26));
    expect(send).not.toHaveBeenCalled();
  });
  it("waits 72 hours then nudges the first page and resolves on publication", async () => {
    const f = fixture();
    f.team.workspace_done = true;
    f.team.workspace_exists = true;
    expect(await generateNotifications(f.db, at(71))).toBe(0);
    expect(await generateNotifications(f.db, at(73))).toBe(1);
    expect(f.notices[0]).toMatchObject({
      kind: "activation_first_page",
      payload: { text: pageText, href: "/app/intake" },
    });
    expect(await generateNotifications(f.db, at(74))).toBe(0);
    f.team.publish_done = true;
    const send = vi.fn();
    await generateNotifications(f.db, at(75));
    expect(f.notices[0].resolved_at).toEqual(at(75));
    expect(send).not.toHaveBeenCalled();
  });
  it("does not nudge an already published page", async () => {
    const f = fixture();
    f.team.workspace_done = true;
    f.team.workspace_exists = true;
    f.team.publish_done = true;
    expect(await generateNotifications(f.db, at(73))).toBe(0);
  });
  it("prioritizes the workspace even after 72 hours", async () => {
    const f = fixture();
    await generateNotifications(f.db, at(73));
    expect(f.notices.map((n) => n.kind)).toEqual(["activation_workspace"]);
  });
  it.each(["active", "canceled", "expired"])(
    "resolves pending activation and sends none for %s",
    async (status) => {
      const f = fixture();
      await generateNotifications(f.db, at(25));
      if (status === "expired") f.team.trial_end = at(26);
      else f.team.status = status;
      const send = vi.fn();
      await generateNotifications(f.db, at(27));
      expect(
        f.notices.filter(
          (n) => n.kind.startsWith("activation") && !n.resolved_at,
        ),
      ).toHaveLength(0);
      expect(
        send.mock.calls.filter((call) =>
          call[2]?.kind?.startsWith("activation"),
        ),
      ).toHaveLength(0);
      expect(
        f.notices.find((n) => n.kind === "activation_workspace")?.resolved_at,
      ).toEqual(at(27));
    },
  );
  it("never changes the mail status of in-app activation notices", async () => {
    const f = fixture();
    const send = vi.fn().mockRejectedValue(new Error("fixture"));
    await generateNotifications(f.db, at(25));
    await deliverNotifications(f.db, send);
    await generateNotifications(f.db, at(26));
    await deliverNotifications(f.db, send);
    expect(f.notices[0]?.mail_status).toBe("pending");
    expect(send).not.toHaveBeenCalled();
  });
});
