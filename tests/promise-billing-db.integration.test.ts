import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { syncSubscription } from "@/lib/billing";
import { generateNotifications } from "@/lib/notifications";

const enabled = process.env.INTAKE_DB_TEST === "1";
const fixtureUsers: string[] = [];
const fixtureTeams: string[] = [];

function stripeSubscription(
  customer: string,
  status: Stripe.Subscription.Status,
  values: Partial<Stripe.Subscription> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `sub_promise_${randomUUID().replaceAll("-", "")}`,
    customer,
    status,
    created: now - 86400,
    cancel_at_period_end: false,
    default_payment_method: "pm_fixture",
    default_source: null,
    trial_end: null,
    ended_at: null,
    canceled_at: null,
    items: {
      data: [
        {
          price: { id: "price_fixture" },
          current_period_end: now + 86400,
        },
      ],
    },
    ...values,
  } as unknown as Stripe.Subscription;
}

async function fixture() {
  const suffix = randomUUID();
  const user = (
    await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
      `promise-${suffix}@example.invalid`,
    ])
  ).rows[0].id as string;
  fixtureUsers.push(user);
  const customer = `cus_promise_${suffix.replaceAll("-", "")}`;
  const team = (
    await db.query(
      "INSERT INTO teams(name,owner_user_id,stripe_customer_id) VALUES($1,$2,$3) RETURNING id",
      ["Promise billing fixture", user, customer],
    )
  ).rows[0].id as string;
  fixtureTeams.push(team);
  await db.query(
    "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$3,'running','running')",
    [team, `promise-${suffix.slice(0, 12)}`, `promise-${suffix}.invalid`],
  );
  return { user, team, customer };
}

async function row(subscriptionId: string) {
  return (
    await db.query(
      `SELECT status,contract_ended_at,payment_grace_started_at,
        payment_grace_until,payment_failure_notified_at
       FROM subscriptions WHERE stripe_subscription_id=$1`,
      [subscriptionId],
    )
  ).rows[0];
}

async function transaction<T>(
  run: (client: import("pg").PoolClient) => Promise<T>,
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const sync = (subscription: Stripe.Subscription) =>
  transaction((client) => syncSubscription(client, subscription));
const hourly = (now: Date) =>
  transaction((client) => generateNotifications(client, now));

describe.skipIf(!enabled)("promised billing lifecycle in PostgreSQL", () => {
  beforeAll(async () => {
    const columns = (
      await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='subscriptions'
         AND column_name=ANY($1::text[])`,
        [
          [
            "contract_ended_at",
            "payment_grace_started_at",
            "payment_grace_until",
            "payment_failure_notified_at",
          ],
        ],
      )
    ).rows;
    expect(columns).toHaveLength(4);
    process.env.PAYMENT_GRACE_DAYS = "7";
  });

  afterAll(async () => {
    for (const team of fixtureTeams) {
      await db.query(
        "DELETE FROM notifications WHERE subscription_id IN (SELECT stripe_subscription_id FROM subscriptions WHERE team_id=$1)",
        [team],
      );
      await db.query("DELETE FROM subscriptions WHERE team_id=$1", [team]);
      await db.query("DELETE FROM tenants WHERE team_id=$1", [team]);
      await db.query("DELETE FROM memberships WHERE team_id=$1", [team]);
      await db.query("DELETE FROM teams WHERE id=$1", [team]);
    }
    for (const user of fixtureUsers)
      await db.query("DELETE FROM users WHERE id=$1", [user]);
    delete process.env.PAYMENT_GRACE_DAYS;
    await db.end();
  });

  it("keeps one delinquency episode across past_due/unpaid and starts a fresh notified episode after recovery", async () => {
    const f = await fixture();
    const subscription = stripeSubscription(f.customer, "past_due");
    await sync(subscription);
    const first = await row(subscription.id);
    expect(first.payment_grace_started_at).toBeInstanceOf(Date);
    expect(first.payment_grace_until.getTime()).toBeGreaterThan(
      first.payment_grace_started_at.getTime(),
    );
    expect(first.payment_failure_notified_at).toBeInstanceOf(Date);
    expect(
      (
        await db.query("SELECT desired_state FROM tenants WHERE team_id=$1", [
          f.team,
        ])
      ).rows[0].desired_state,
    ).toBe("running");

    await sync({ ...subscription, status: "unpaid" });
    const repeated = await row(subscription.id);
    expect(repeated.payment_grace_started_at).toEqual(
      first.payment_grace_started_at,
    );
    expect(repeated.payment_grace_until).toEqual(first.payment_grace_until);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM notifications WHERE subscription_id=$1 AND kind='payment_failed'",
          [subscription.id],
        )
      ).rows[0].n,
    ).toBe(1);

    await sync({ ...subscription, status: "active" });
    const recovered = await row(subscription.id);
    expect(recovered.payment_grace_started_at).toBeNull();
    expect(recovered.payment_grace_until).toBeNull();
    expect(recovered.payment_failure_notified_at).toBeNull();
    await db.query("SELECT pg_sleep(0.01)");
    await sync({ ...subscription, status: "past_due" });
    const next = await row(subscription.id);
    expect(next.payment_grace_started_at.getTime()).toBeGreaterThan(
      first.payment_grace_started_at.getTime(),
    );
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM notifications WHERE subscription_id=$1 AND kind='payment_failed'",
          [subscription.id],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it("the hourly run repairs a legacy delinquency and later suspends without another webhook", async () => {
    const f = await fixture();
    const subscription = stripeSubscription(f.customer, "past_due");
    await sync(subscription);
    await db.query("DELETE FROM notifications WHERE subscription_id=$1", [
      subscription.id,
    ]);
    await db.query(
      `UPDATE subscriptions SET payment_grace_started_at=NULL,
       payment_grace_until=NULL,payment_failure_notified_at=NULL
       WHERE stripe_subscription_id=$1`,
      [subscription.id],
    );
    const repairedAt = new Date("2031-04-05T12:00:00.000Z");

    await hourly(repairedAt);
    const repaired = await row(subscription.id);
    expect(repaired.payment_grace_started_at).toEqual(repairedAt);
    expect(repaired.payment_grace_until).toEqual(
      new Date("2031-04-12T12:00:00.000Z"),
    );
    expect(repaired.payment_failure_notified_at).toBeInstanceOf(Date);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM notifications WHERE subscription_id=$1 AND kind='payment_failed'",
          [subscription.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query("SELECT desired_state FROM tenants WHERE team_id=$1", [
          f.team,
        ])
      ).rows[0].desired_state,
    ).toBe("running");
    await hourly(repaired.payment_grace_until);
    expect(
      (
        await db.query("SELECT desired_state FROM tenants WHERE team_id=$1", [
          f.team,
        ])
      ).rows[0].desired_state,
    ).toBe("suspended");
  });

  it("persists the actual contract end despite delayed events and exposes lifecycle fields in the effective view", async () => {
    const f = await fixture();
    const ended = Math.floor(Date.now() / 1000) - 3 * 86400;
    const canceled = stripeSubscription(f.customer, "canceled", {
      ended_at: ended,
      canceled_at: ended + 3600,
    });
    await sync(canceled);
    expect((await row(canceled.id)).contract_ended_at).toEqual(
      new Date(ended * 1000),
    );

    const trialEnd = ended - 5 * 86400;
    const expired = stripeSubscription(f.customer, "incomplete_expired", {
      id: `${canceled.id}_trial`,
      trial_end: trialEnd,
      canceled_at: ended,
      ended_at: null,
      default_payment_method: null,
    });
    await sync(expired);
    expect((await row(expired.id)).contract_ended_at).toEqual(
      new Date(trialEnd * 1000),
    );
    const effective = (
      await db.query(
        `SELECT contract_ended_at,payment_grace_started_at,payment_grace_until,
          payment_failure_notified_at FROM effective_subscriptions WHERE team_id=$1`,
        [f.team],
      )
    ).rows[0];
    expect(effective).toHaveProperty("contract_ended_at");
    expect(effective).toHaveProperty("payment_grace_started_at");
    expect(effective).toHaveProperty("payment_grace_until");
    expect(effective).toHaveProperty("payment_failure_notified_at");
  });

  it("retains an expired no-card trial end across a repeated delayed subscription sync", async () => {
    const f = await fixture();
    const trialEnd = Math.floor(Date.now() / 1000) - 3600;
    const trial = stripeSubscription(f.customer, "trialing", {
      trial_end: trialEnd,
      default_payment_method: null,
    });
    await sync(trial);
    await hourly(new Date(trialEnd * 1000));
    expect((await row(trial.id)).contract_ended_at).toEqual(
      new Date(trialEnd * 1000),
    );

    await sync(trial);
    expect((await row(trial.id)).contract_ended_at).toEqual(
      new Date(trialEnd * 1000),
    );
  });
});
