import type Stripe from "stripe";
import type { PoolClient } from "pg";
export type Queryable = Pick<PoolClient, "query">;
export async function syncCheckout(
  client: Queryable,
  session: Stripe.Checkout.Session,
) {
  if (session.metadata?.venture !== "wissen" || session.status !== "complete")
    return null;
  const email = (session.customer_details?.email || session.customer_email)
    ?.trim()
    .toLowerCase();
  const customer =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if (!email || !customer) return null;
  // Never attach an arbitrary Checkout email to an existing account's team.
  const existing = await client.query(
    "SELECT * FROM teams WHERE stripe_customer_id=$1",
    [customer],
  );
  if (existing.rows[0]) return existing.rows[0];
  const account = await client.query(
    `INSERT INTO users(email,name,checkout_session_id) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING *`,
    [email, session.customer_details?.name || null, session.id],
  );
  let u = account.rows[0];
  if (!u) {
    const bound = await client.query(
      "SELECT u.* FROM users u JOIN checkout_attempts a ON a.user_id=u.id WHERE a.session_id=$1 AND u.email=$2",
      [session.id, email],
    );
    u = bound.rows[0];
    if (!u) return null;
  }
  const team = await client.query(
    `INSERT INTO teams(name,owner_user_id,stripe_customer_id) VALUES($1,$2,$3) RETURNING *`,
    [
      `${session.customer_details?.name || email.split("@")[0]}'s team`,
      u.id,
      customer,
    ],
  );
  await client.query(
    "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [u.id, team.rows[0].id, "owner"],
  );
  return team.rows[0];
}
// Run under the shared billing transaction lock, before attaching any checkout.
export async function cancelDuplicateCheckout(
  client: Queryable,
  session: Stripe.Checkout.Session,
  stripe: Pick<Stripe, "subscriptions">,
) {
  const email = (session.customer_details?.email || session.customer_email)
    ?.trim()
    .toLowerCase();
  const id =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!email || !id) return false;
  const existing = await client.query(
    `SELECT s.stripe_subscription_id FROM users u JOIN teams t ON t.owner_user_id=u.id
     JOIN subscriptions s ON s.team_id=t.id WHERE u.email=$1
     AND s.status IN ('trialing','active','past_due') AND s.stripe_subscription_id<>$2 LIMIT 1`,
    [email, id],
  );
  if (!existing.rows[0]) return false;
  const subscription = await stripe.subscriptions.retrieve(id);
  if (subscription.status !== "canceled")
    await stripe.subscriptions.cancel(id, {
      invoice_now: false,
      prorate: false,
    });
  return true;
}
export async function syncSubscription(
  client: Queryable,
  sub: Stripe.Subscription,
) {
  const customer =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const team = await client.query(
    "SELECT id FROM teams WHERE stripe_customer_id=$1",
    [customer],
  );
  if (!team.rows[0]) return;
  const item = sub.items.data[0];
  await client.query(
    `INSERT INTO subscriptions(team_id,stripe_subscription_id,status,price_id,trial_end,current_period_end,cancel_at_period_end) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(stripe_subscription_id) DO UPDATE SET status=EXCLUDED.status,price_id=EXCLUDED.price_id,trial_end=EXCLUDED.trial_end,current_period_end=EXCLUDED.current_period_end,cancel_at_period_end=EXCLUDED.cancel_at_period_end,updated_at=now()`,
    [
      team.rows[0].id,
      sub.id,
      sub.status,
      item?.price.id,
      sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      item?.current_period_end
        ? new Date(item.current_period_end * 1000)
        : null,
      sub.cancel_at_period_end,
    ],
  );
  const desired = ["canceled", "unpaid", "incomplete_expired"].includes(
    sub.status,
  )
    ? "suspended"
    : ["trialing", "active"].includes(sub.status)
      ? "running"
      : null;
  if (desired)
    await client.query(
      "UPDATE tenants SET desired_state=$2,updated_at=now() WHERE team_id=$1 AND desired_state<>$2",
      [team.rows[0].id, desired],
    );
}
export async function handleStripeEvent(
  client: Queryable,
  event: Stripe.Event,
  stripe: Pick<Stripe, "subscriptions">,
) {
  // The caller holds a transaction and a global transaction lock. Fetch current
  // subscriptions rather than trusting delivery order of Stripe snapshots.
  const seen = await client.query(
    "INSERT INTO stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",
    [event.id],
  );
  if (!seen.rowCount) return;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.venture !== "wissen") return;
    if (await cancelDuplicateCheckout(client, session, stripe)) return;
    await syncCheckout(client, session);
    const id =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (id)
      await syncSubscription(client, await stripe.subscriptions.retrieve(id));
  } else if (
    [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(event.type)
  ) {
    const sub = event.data.object as Stripe.Subscription;
    await syncSubscription(
      client,
      event.type === "customer.subscription.deleted"
        ? sub
        : await stripe.subscriptions.retrieve(sub.id),
    );
  } else if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscription = invoice.parent?.subscription_details?.subscription;
    const id =
      typeof subscription === "string" ? subscription : subscription?.id;
    if (id)
      await syncSubscription(client, await stripe.subscriptions.retrieve(id));
  }
}
