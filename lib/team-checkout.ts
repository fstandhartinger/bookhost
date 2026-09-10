import type Stripe from "stripe";
import { transaction, db } from "./db";
import { IntakeError } from "./intake/access";

// Reservation commits before Stripe creation. Failed/ambiguous HTTP responses
// leave the exact params and key available to the next request/process.
export async function teamCheckout(
  teamId: string,
  params: Stripe.Checkout.SessionCreateParams,
  stripe: Pick<Stripe, "checkout">,
) {
  const reservation = await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(827492015)");
    await c.query("SELECT id FROM teams WHERE id=$1 FOR UPDATE", [teamId]);
    if (
      (
        await c.query(
          "SELECT 1 FROM subscriptions WHERE team_id=$1 AND status IN ('trialing','active','past_due','unpaid','incomplete','paused')",
          [teamId],
        )
      ).rowCount
    )
      throw new IntakeError("Your team already has a subscription.", 409);
    const previous = (
      await c.query(
        "SELECT stripe_subscription_id,current_period_end FROM subscriptions WHERE team_id=$1 ORDER BY stripe_created_at DESC, stripe_subscription_id DESC LIMIT 1",
        [teamId],
      )
    ).rows[0];
    const period = previous
      ? `${previous.stripe_subscription_id}:${new Date(previous.current_period_end || 0).getTime()}`
      : "initial";
    const saved = (
      await c.query(
        "SELECT * FROM team_checkout_reservations WHERE team_id=$1 FOR UPDATE",
        [teamId],
      )
    ).rows[0];
    if (saved) {
      if (saved.session_id) {
        const session = await stripe.checkout.sessions.retrieve(
          saved.session_id,
        );
        if (session.status === "open") return { ...saved, checkout: session };
        if (session.status === "complete" && saved.period === period)
          throw new IntakeError(
            "Checkout is complete. Billing confirmation is pending.",
            409,
          );
      } else if (new Date(saved.expires_at).getTime() > Date.now())
        return saved;
      // Stripe's fixed expires_at also bounds an unrecorded session after a crash.
    }
    const generation = (saved?.generation || 0) + 1;
    const key = `bookhost:${teamId}:${period}:${generation}`;
    const expires = Math.floor(Date.now() / 1000) + 86400;
    const fixed = { ...params, expires_at: expires };
    await c.query(
      `INSERT INTO team_checkout_reservations(team_id,period,generation,idempotency_key,params,expires_at) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(team_id) DO UPDATE SET period=$2,generation=$3,idempotency_key=$4,params=$5,expires_at=$6,session_id=NULL,created_at=now()`,
      [
        teamId,
        period,
        generation,
        key,
        JSON.stringify(fixed),
        new Date(expires * 1000),
      ],
    );
    return { idempotency_key: key, params: fixed };
  });
  if (reservation.checkout)
    return reservation.checkout as Stripe.Checkout.Session;
  const checkout = await stripe.checkout.sessions.create(reservation.params, {
    idempotencyKey: reservation.idempotency_key,
  });
  await db.query(
    "UPDATE team_checkout_reservations SET session_id=$3 WHERE team_id=$1 AND idempotency_key=$2",
    [teamId, reservation.idempotency_key, checkout.id],
  );
  return checkout;
}
