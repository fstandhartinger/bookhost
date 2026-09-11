import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { db, transaction } from "@/lib/db";
import { handleStripeEvent } from "@/lib/billing";
const enabled = process.env.INTAKE_DB_TEST === "1";
const users: string[] = [],
  teams: string[] = [],
  tenants: string[] = [],
  stripeEvents: string[] = [];
afterAll(async () => {
  if (!enabled) return;
  await db.query("DELETE FROM subscriptions WHERE team_id=ANY($1::uuid[])", [
    teams,
  ]);
  await db.query(
    "DELETE FROM team_onboarding WHERE team_id=ANY($1::uuid[])",
    [teams],
  );
  await db.query("DELETE FROM events WHERE team_id=ANY($1::uuid[])", [teams]);
  await db.query("DELETE FROM notifications WHERE user_id=ANY($1::uuid[])", [
    users,
  ]);
  await db.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])", [tenants]);
  await db.query("DELETE FROM stripe_events WHERE id=ANY($1::text[])", [
    stripeEvents,
  ]);
  await db.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
});
it.skipIf(!enabled)(
  "a card added on the Stripe customer converts the no-card trial: payment method stored, payment onboarding captured, stale trial notice resolved",
  async () => {
    const nowSec = Math.floor(Date.now() / 1000),
      trialEndSec = nowSec + 8 * 86400,
      trialEnd = new Date(trialEndSec * 1000);
    const customerId = `cus_pc_${randomUUID()}`,
      subId = `sub_pc_${randomUUID()}`,
      eventId = `evt_pc_${randomUUID()}`;
    stripeEvents.push(eventId);
    // A no-card trial: user, team bound to the Stripe customer, running tenant
    // and a trialing subscription without any payment method.
    const owner = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `payment-chain-${randomUUID()}@example.invalid`,
      ])
    ).rows[0].id;
    users.push(owner);
    const teamId = (
      await db.query(
        "INSERT INTO teams(name,owner_user_id,stripe_customer_id) VALUES('Payment chain integration',$1,$2) RETURNING id",
        [owner, customerId],
      )
    ).rows[0].id;
    teams.push(teamId);
    tenants.push(
      (
        await db.query(
          "INSERT INTO tenants(team_id,slug,host,status) VALUES($1,$2,$3,'running') RETURNING id",
          [teamId, `paychain-${randomUUID().slice(0, 8)}`, randomUUID()],
        )
      ).rows[0].id,
    );
    await db.query(
      "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,price_id,trial_end,has_payment_method) VALUES($1,$2,'trialing','price_payment_chain',$3,false)",
      [teamId, subId, trialEnd],
    );
    // The open pre-dunning mail that real trials get 3 days before trial end.
    const noticeId = (
      await db.query(
        `INSERT INTO notifications(user_id,kind,period,payload,subscription_id)
         VALUES($1,'trial_ending_3d',$2,$3::jsonb,$4) RETURNING id`,
        [
          owner,
          `${subId}:${trialEnd.toISOString()}`,
          JSON.stringify({
            text: "Your free trial ends soon. Add a payment method to keep your workspace.",
            href: "/app/billing",
          }),
          subId,
        ],
      )
    ).rows[0].id;
    expect(
      (
        await db.query(
          "SELECT has_payment_method FROM subscriptions WHERE team_id=$1",
          [teamId],
        )
      ).rows[0].has_payment_method,
    ).toBe(false);
    expect(
      (
        await db.query(
          "SELECT step FROM team_onboarding WHERE team_id=$1 AND step='payment'",
          [teamId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("SELECT resolved_at FROM notifications WHERE id=$1", [
          noticeId,
        ])
      ).rows[0].resolved_at,
    ).toBeNull();
    // A card added in the Stripe customer portal: the subscription itself
    // carries no default_payment_method, only the expanded customer does.
    const retrieved = {
      id: subId,
      created: nowSec - 86400,
      customer: {
        id: customerId,
        invoice_settings: { default_payment_method: "pm_payment_chain" },
      },
      status: "trialing",
      trial_end: trialEndSec,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: { id: "price_payment_chain" },
            current_period_end: nowSec + 30 * 86400,
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    const stripe = {
      subscriptions: { retrieve: async () => retrieved },
    } as unknown as Pick<Stripe, "subscriptions">;
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(827492015)");
      await handleStripeEvent(
        client,
        {
          id: eventId,
          created: nowSec,
          type: "customer.updated",
          data: { object: { id: customerId } },
        } as unknown as Stripe.Event,
        stripe,
      );
    });
    // A card on the customer is a payment method for the team.
    expect(
      (
        await db.query(
          "SELECT has_payment_method FROM subscriptions WHERE team_id=$1",
          [teamId],
        )
      ).rows[0].has_payment_method,
    ).toBe(true);
    // The capture_onboarding trigger records the payment step on its own.
    expect(
      (
        await db.query(
          "SELECT step FROM team_onboarding WHERE team_id=$1 AND step='payment'",
          [teamId],
        )
      ).rows,
    ).toHaveLength(1);
    // The stale "trial ends in 3 days" mail is resolved by the sync.
    expect(
      (
        await db.query("SELECT resolved_at FROM notifications WHERE id=$1", [
          noticeId,
        ])
      ).rows[0].resolved_at,
    ).not.toBeNull();
  },
  20000,
);
