import { expect, it, vi } from "vitest";
vi.mock("@/lib/intake/bookstack", () => ({
  BookStack: class {
    async list() {
      return [{ id: 1, name: "Team handbook" }];
    }
  },
}));
vi.mock("@/lib/intake/crypto", () => ({ decrypt: () => "test" }));
vi.mock("@/lib/intake/draft", () => ({
  generateDraft: vi.fn(async () => ({
    title: "Generated",
    html: "<p>Mock draft</p>",
    tags: ["test"],
  })),
}));
import { db } from "@/lib/db";
import { acceptEmail } from "@/lib/intake/inbound";
import { parseEmail } from "@/lib/intake/email";
import { drainEmail } from "@/lib/intake/email-jobs";
import { generateDraft } from "@/lib/intake/draft";
it.skipIf(process.env.INTAKE_DB_TEST !== "1")(
  "atomically accepts mail, replays without charging, rejects senders, rolls back quota and runs mocked drafting",
  async () => {
    vi.stubEnv("INBOUND_EMAIL_ENABLED", "true");
    const user = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `email-test-${crypto.randomUUID()}@example.invalid`,
      ])
    ).rows[0];
    let team: string | undefined, tenant: string | undefined;
    try {
      team = (
        await db.query(
          "INSERT INTO teams(name,owner_user_id) VALUES('Email integration',$1) RETURNING id",
          [user.id],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'owner')",
        [team, user.id],
      );
      await db.query(
        "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',now()+interval '1 day')",
        [team, `test-${team}`],
      );
      const slug = `email-${crypto.randomUUID()}`;
      tenant = (
        await db.query(
          "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$2||'.wissen.app.mintapis.com','running','running') RETURNING id",
          [team, slug],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO tenant_secrets(tenant_id,api_id,api_secret_enc) VALUES($1,'mock','mock')",
        [tenant],
      );
      await db.query(
        "INSERT INTO intake_senders(team_id,pattern) VALUES($1,'@example.com')",
        [team],
      );
      const mail = parseEmail(
        Buffer.from(
          JSON.stringify({
            message_id: crypto.randomUUID(),
            to: [`${slug}@intake.bookhost.co`],
            from: { address: "member@example.com" },
            subject: "Email subject",
            text: "This document must be reviewed by the team. ".repeat(12),
            attachments: [],
            received_at: new Date().toISOString(),
          }),
        ),
      );
      const [ids, replay] = await Promise.all([
        acceptEmail(mail),
        acceptEmail(mail),
      ]);
      expect(replay).toEqual(ids);
      expect(ids).toHaveLength(1);
      expect(
        (
          await db.query("SELECT used FROM intake_quota WHERE team_id=$1", [
            team,
          ])
        ).rows[0].used,
      ).toBe(1);
      await expect(
        acceptEmail({
          ...mail,
          from: { address: "stranger@foreign.com", name: "" },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM events WHERE team_id=$1 AND name='inbound_rejected'",
            [team],
          )
        ).rows[0].n,
      ).toBe(1);
      await db.query("UPDATE intake_quota SET draft_limit=1 WHERE team_id=$1", [
        team,
      ]);
      await expect(
        acceptEmail({ ...mail, message_id: crypto.randomUUID() }),
      ).rejects.toMatchObject({ status: 429 });
      await drainEmail();
      for (let n = 0; n < 100; n++) {
        const row = (
          await db.query("SELECT * FROM intake_items WHERE id=$1", [ids[0]])
        ).rows[0];
        if (row.status === "draft") {
          expect(row.source).toBe("email");
          expect(row.draft_title).toBe("Email subject");
          expect(row.source_metadata.from.address).toBe("member@example.com");
          break;
        }
        if (n === 99) throw new Error(`Draft timed out: ${row.status}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(generateDraft).toHaveBeenCalled();
    } finally {
      if (team) {
        await db.query("DELETE FROM events WHERE team_id=$1", [team]);
        await db.query("DELETE FROM intake_items WHERE team_id=$1", [team]);
      }
      if (tenant) await db.query("DELETE FROM tenants WHERE id=$1", [tenant]);
      if (team) {
        await db.query("DELETE FROM memberships WHERE team_id=$1", [team]);
        await db.query("DELETE FROM subscriptions WHERE team_id=$1", [team]);
        await db.query("DELETE FROM rate_limits WHERE key=$1", [
          `intake-team:${team}`,
        ]);
        await db.query("DELETE FROM teams WHERE id=$1", [team]);
      }
      await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    }
  },
  20000,
);
