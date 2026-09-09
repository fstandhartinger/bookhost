import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
vi.mock("@/lib/db", async (original) => {
  const actual = await original<typeof import("@/lib/db")>();
  actual.db.options.max = 2;
  return actual;
});
const ratePrefix = vi.hoisted(() => `inbound-test-${crypto.randomUUID()}:`);
vi.mock("@/lib/security", async (original) => {
  const actual = await original<typeof import("@/lib/security")>();
  return {
    ...actual,
    rateLimit: (key: string, limit?: number, window?: number) =>
      actual.rateLimit(ratePrefix + key, limit, window),
  };
});
const bookCalls = vi.hoisted(() => ({
  waiting: 0,
  release: undefined as undefined | (() => void),
  barrier: undefined as undefined | Promise<void>,
}));
vi.mock("@/lib/intake/bookstack", () => ({
  BookStack: class {
    async list() {
      if (bookCalls.barrier) {
        if (++bookCalls.waiting === 2) bookCalls.release!();
        await bookCalls.barrier;
      }
      return [{ id: 1, name: "Team handbook" }];
    }
  },
}));
vi.mock("@/lib/intake/crypto", () => ({ decrypt: () => "test" }));
vi.mock("@/lib/intake/email-jobs", async (original) => ({
  ...(await original<typeof import("@/lib/intake/email-jobs")>()),
  drainEmail: vi.fn(async () => {}),
}));
import { db } from "@/lib/db";
import { POST } from "@/app/api/intake/inbound/route";
import { acceptEmail } from "@/lib/intake/inbound";
import { parseEmail } from "@/lib/intake/email";
import { claimEmail } from "@/lib/intake/email-jobs";
import { recoverIntake } from "@/lib/intake/jobs";
const enabled = process.env.INTAKE_DB_TEST === "1";
const fixtures: {
  user: string;
  team: string;
  tenant?: string;
  slug: string;
  email: string;
}[] = [];
beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv("INBOUND_WEBHOOK_SECRET", "integration-test-only");
  for (let n = 0; n < 2; n++) {
    const email = `concurrency-${randomUUID()}@example.invalid`;
    const user = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        email,
      ])
    ).rows[0].id;
    const team = (
      await db.query(
        "INSERT INTO teams(name,owner_user_id) VALUES('Inbound regression',$1) RETURNING id",
        [user],
      )
    ).rows[0].id;
    const fixture = {
      user,
      team,
      slug: `regression-${randomUUID()}`,
      email,
      tenant: undefined as string | undefined,
    };
    fixtures.push(fixture);
    await db.query(
      "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'owner')",
      [team, user],
    );
    await db.query(
      "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',now()+interval '1 day')",
      [team, `test-${team}`],
    );
    fixture.tenant = (
      await db.query(
        "INSERT INTO tenants(team_id,slug,status,desired_state) VALUES($1,$2,'running','running') RETURNING id",
        [team, fixture.slug],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO tenant_secrets(tenant_id,api_id,api_secret_enc) VALUES($1,'mock','mock')",
      [fixture.tenant],
    );
  }
});
afterAll(async () => {
  if (!enabled) return;
  for (const f of fixtures) {
    await db.query("DELETE FROM events WHERE team_id=$1", [f.team]);
    await db.query("DELETE FROM intake_items WHERE team_id=$1", [f.team]);
    if (f.tenant) await db.query("DELETE FROM tenants WHERE id=$1", [f.tenant]);
    await db.query("DELETE FROM memberships WHERE team_id=$1", [f.team]);
    await db.query("DELETE FROM subscriptions WHERE team_id=$1", [f.team]);
    await db.query("DELETE FROM rate_limits WHERE key=$1", [
      `intake-team:${f.team}`,
    ]);
    await db.query("DELETE FROM teams WHERE id=$1", [f.team]);
    await db.query("DELETE FROM users WHERE id=$1", [f.user]);
  }
  await db.query("DELETE FROM rate_limits WHERE key LIKE $1", [
    ratePrefix + "%",
  ]);
  vi.unstubAllEnvs();
  await db.end();
});
function mail(n: number, message_id = randomUUID()) {
  const f = fixtures[n];
  return {
    message_id,
    to: [`${f.slug}@intake.wissen.app.mintapis.com`],
    from: { address: f.email },
    subject: "Concurrency regression",
    text: "Human review is required. ".repeat(15),
    attachments: [],
    received_at: new Date().toISOString(),
  };
}
function post(value: ReturnType<typeof mail>) {
  const raw = JSON.stringify(value),
    t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac("sha256", "integration-test-only")
    .update(t + "." + raw)
    .digest("hex")}`;
  return POST(
    new Request("http://localhost/api/intake/inbound", {
      method: "POST",
      body: raw,
      headers: {
        "content-length": String(Buffer.byteLength(raw)),
        "x-wissen-signature": signature,
        "x-real-ip": "192.0.2.201",
      },
    }),
  );
}
it.skipIf(!enabled)(
  "terminates ten concurrent signed inbound requests with a real pool of max 2 within ten seconds",
  async () => {
    expect(db.options.max).toBe(2);
    expect(db.options.connectionTimeoutMillis).toBe(5000);
    const started = performance.now();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post(mail(0))),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(202));
    expect(performance.now() - started).toBeLessThan(10000);
    expect(db.totalCount).toBeLessThanOrEqual(2);
    const rows = (
      await db.query("SELECT mime FROM intake_items WHERE team_id=$1", [
        fixtures[0].team,
      ])
    ).rows;
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.mime === "application/octet-stream")).toBe(true);
  },
  10000,
);
it.skipIf(!enabled)(
  "resolves concurrent cross-team message ID collisions to permanent 409 without double quota",
  async () => {
    bookCalls.waiting = 0;
    bookCalls.barrier = new Promise<void>((resolve) => {
      bookCalls.release = resolve;
    });
    try {
      // Both requests pass the initial dedupe read before either starts its insert.
      const id = randomUUID();
      const responses = await Promise.all([
        post(mail(0, id)),
        post(mail(1, id)),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
      const stored = (
        await db.query(
          "SELECT item_ids FROM intake_messages WHERE message_id=$1",
          [id],
        )
      ).rows;
      expect(stored).toHaveLength(1);
      expect(stored[0].item_ids).toHaveLength(1);
      const used = (
        await db.query(
          "SELECT sum(used)::int AS used FROM intake_quota WHERE team_id=ANY($1::uuid[])",
          [fixtures.map((f) => f.team)],
        )
      ).rows[0].used;
      expect(used).toBe(11);
    } finally {
      bookCalls.barrier = undefined;
    }
  },
  10000,
);
it.skipIf(!enabled)(
  "claims distinct items atomically and gives the waiting second team a slot",
  async () => {
    await acceptEmail(parseEmail(Buffer.from(JSON.stringify(mail(1)))));
    const claimed = await Promise.all([claimEmail(), claimEmail()]);
    expect(claimed.every(Boolean)).toBe(true);
    expect(new Set(claimed.map((r) => r.id)).size).toBe(2);
    const running = (
      await db.query(
        "SELECT team_id,count(*)::int AS n FROM intake_items WHERE status='drafting' AND team_id=ANY($1::uuid[]) GROUP BY team_id",
        [fixtures.map((f) => f.team)],
      )
    ).rows;
    expect(running).toHaveLength(2);
    expect(running.every((r) => r.n === 1)).toBe(true);
    expect(await claimEmail()).toBeUndefined();
  },
);
it.skipIf(!enabled)(
  "expires orphaned queued email after 30 minutes and message IDs after 90 days; replay returns 410",
  async () => {
    const value = mail(1);
    const [id] = await acceptEmail(
      parseEmail(Buffer.from(JSON.stringify(value))),
    );
    await db.query("DELETE FROM intake_email_files WHERE item_id=$1", [id]);
    await db.query(
      "UPDATE intake_items SET updated_at=now()-interval '31 minutes' WHERE id=$1",
      [id],
    );
    const expired = randomUUID();
    await db.query(
      "INSERT INTO intake_messages(message_id,team_id,created_at) VALUES($1,$2,now()-interval '91 days')",
      [expired, fixtures[1].team],
    );
    await recoverIntake();
    expect(
      (
        await db.query("SELECT status,error FROM intake_items WHERE id=$1", [
          id,
        ])
      ).rows[0],
    ).toMatchObject({
      status: "failed",
      error: expect.stringContaining("source is missing"),
    });
    expect(
      (
        await db.query("SELECT 1 FROM intake_messages WHERE message_id=$1", [
          expired,
        ])
      ).rowCount,
    ).toBe(0);
    await db.query("DELETE FROM intake_items WHERE id=$1", [id]);
    expect((await post(value)).status).toBe(410);
  },
);
