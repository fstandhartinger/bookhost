import { billingEligible } from "./trial";
import { campaign } from "./analytics/shared";
import { normalizeEmail } from "./email";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
export type Queryable = Pick<PoolClient, "query">;
export async function syncCheckout(
  client: Queryable,
  session: Stripe.Checkout.Session,
) {
  if (session.metadata?.venture !== "wissen" || session.status !== "complete")
    return null;
  const email = normalizeEmail(
    session.customer_details?.email || session.customer_email,
  );
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
  if (existing.rows[0]) {
    await client.query(
      "UPDATE teams SET utm_source=COALESCE(utm_source,$2),analytics_opt_out=$3 WHERE id=$1",
      [
        existing.rows[0].id,
        campaign(session.metadata?.utm_source),
        session.metadata?.no_analytics === "1",
      ],
    );
    return existing.rows[0];
  }
  const account = await client.query(
    `INSERT INTO users(email,name,checkout_session_id) VALUES($1,$2,$3) ON CONFLICT (lower(email)) DO NOTHING RETURNING *`,
    [email, session.customer_details?.name || null, session.id],
  );
  let u = account.rows[0];
  if (!u) {
    const bound = await client.query(
      "SELECT u.* FROM users u JOIN checkout_attempts a ON a.user_id=u.id WHERE a.session_id=$1 AND lower(u.email)=$2",
      [session.id, email],
    );
    u = bound.rows[0];
    if (!u) return null;
  }
  const team = await client.query(
    `INSERT INTO teams(name,owner_user_id,stripe_customer_id,utm_source,analytics_opt_out) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [
      `${session.customer_details?.name || email.split("@")[0]}'s team`,
      u.id,
      customer,
      campaign(session.metadata?.utm_source),
      session.metadata?.no_analytics === "1",
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
  const email = normalizeEmail(
    session.customer_details?.email || session.customer_email,
  );
  const id =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!email || !id) return false;
  const existing = await client.query(
    `SELECT s.stripe_subscription_id FROM users u JOIN teams t ON t.owner_user_id=u.id
     JOIN subscriptions s ON s.team_id=t.id WHERE lower(u.email)=$1
     AND s.status IN ('trialing','active','past_due') AND s.stripe_subscription_id<>$2 LIMIT 1`,
    [email, id],
  );
  if (!existing.rows[0]) return false;
  const subscription = await stripe.subscriptions.retrieve(id, {
    expand: ["customer"],
  });
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
    `INSERT INTO subscriptions(team_id,stripe_subscription_id,status,price_id,trial_end,current_period_end,cancel_at_period_end,stripe_created_at,has_payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(stripe_subscription_id) DO UPDATE SET status=EXCLUDED.status,price_id=EXCLUDED.price_id,trial_end=EXCLUDED.trial_end,current_period_end=EXCLUDED.current_period_end,cancel_at_period_end=EXCLUDED.cancel_at_period_end,stripe_created_at=EXCLUDED.stripe_created_at,has_payment_method=EXCLUDED.has_payment_method,updated_at=now()`,
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
      new Date(sub.created * 1000),
      Boolean(
        sub.default_payment_method ||
        sub.default_source ||
        (typeof sub.customer !== "string" &&
          !sub.customer.deleted &&
          (sub.customer.invoice_settings.default_payment_method ||
            sub.customer.default_source)),
      ),
    ],
  );
  const current = (
    await client.query(
      "SELECT * FROM effective_subscriptions WHERE team_id=$1",
      [team.rows[0].id],
    )
  ).rows[0];
  const desired = billingEligible(current) ? "running" : "suspended";
  await client.query(
    "UPDATE tenants SET desired_state=$2,updated_at=now() WHERE team_id=$1 AND desired_state<>$2",
    [team.rows[0].id, desired],
  );
  await client.query(
    `UPDATE notifications SET resolved_at=now() WHERE user_id IN
    (SELECT owner_user_id FROM teams WHERE id=$1) AND resolved_at IS NULL AND
    (subscription_id IS DISTINCT FROM $2 OR $3='active' OR ($4 AND kind LIKE 'trial_ending%'))`,
    [
      team.rows[0].id,
      current?.stripe_subscription_id,
      current?.status,
      current?.has_payment_method ?? false,
    ],
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
      await syncSubscription(
        client,
        await stripe.subscriptions.retrieve(id, { expand: ["customer"] }),
      );
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
        : await stripe.subscriptions.retrieve(sub.id, { expand: ["customer"] }),
    );
  } else if (event.type === "customer.updated") {
    const customer = event.data.object as Stripe.Customer;
    const subscriptions = await client.query(
      `SELECT s.stripe_subscription_id FROM subscriptions s
      JOIN teams t ON t.id=s.team_id WHERE t.stripe_customer_id=$1 AND s.status IN ('trialing','active','past_due')`,
      [customer.id],
    );
    for (const row of subscriptions.rows)
      await syncSubscription(
        client,
        await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
          expand: ["customer"],
        }),
      );
  } else if (["invoice.payment_failed", "invoice.paid"].includes(event.type)) {
    const invoice = event.data.object as Stripe.Invoice;
    const subscription = invoice.parent?.subscription_details?.subscription;
    const id =
      typeof subscription === "string" ? subscription : subscription?.id;
    if (id)
      await syncSubscription(
        client,
        await stripe.subscriptions.retrieve(id, { expand: ["customer"] }),
      );
  }
}
