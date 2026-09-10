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
  const customer =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if ((!customer && !email) || !id) return false;
  // Email is only a fallback for an unbound anonymous customer, never an
  // alternative identity for a customer already attached to a team.
  const existing = await client.query(
    `SELECT s.stripe_subscription_id FROM users u JOIN teams t ON t.owner_user_id=u.id
     JOIN subscriptions s ON s.team_id=t.id WHERE ${customer ? "(t.stripe_customer_id=$1 OR (NOT EXISTS(SELECT 1 FROM teams bound WHERE bound.stripe_customer_id=$1) AND lower(u.email)=$3))" : "lower(u.email)=$1"}
     AND s.status IN ('trialing','active','past_due','unpaid','incomplete','paused') AND s.stripe_subscription_id<>$2 LIMIT 1`,
    customer ? [customer, id, email || null] : [email, id],
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
  console.warn("Duplicate team subscription canceled", {
    customer: customer || "anonymous",
    duplicate_subscription: id,
    retained_subscription: existing.rows[0].stripe_subscription_id,
  });
  return true;
}
export async function syncSubscription(
  client: Queryable,
  sub: Stripe.Subscription,
  observedAt = new Date(),
) {
  const customer =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const team = await client.query(
    "SELECT id FROM teams WHERE stripe_customer_id=$1",
    [customer],
  );
  if (!team.rows[0]) return;
  const item = sub.items.data[0];
  const graceDays = Math.max(
    1,
    Number.parseInt(process.env.PAYMENT_GRACE_DAYS || "7", 10) || 7,
  );
  const hasPaymentMethod = Boolean(
    sub.default_payment_method ||
      sub.default_source ||
      (typeof sub.customer !== "string" &&
        !sub.customer.deleted &&
        (sub.customer.invoice_settings.default_payment_method ||
          sub.customer.default_source)),
  );
  const expiredNoCardTrial = Boolean(
    sub.status === "trialing" &&
      sub.trial_end &&
      sub.trial_end * 1000 <= Date.now() &&
      !hasPaymentMethod,
  );
  const endedAt = sub.ended_at
    ? new Date(sub.ended_at * 1000)
    : expiredNoCardTrial
      ? new Date(sub.trial_end! * 1000)
    : ["canceled", "incomplete_expired"].includes(sub.status)
      ? sub.status === "incomplete_expired" && sub.trial_end && !hasPaymentMethod
        ? new Date(sub.trial_end * 1000)
        : sub.cancel_at_period_end && item?.current_period_end
          ? new Date(item.current_period_end * 1000)
          : sub.canceled_at && !sub.cancel_at_period_end
          ? new Date(sub.canceled_at * 1000)
          : new Date()
      : null;
  await client.query(
    `INSERT INTO subscriptions(team_id,stripe_subscription_id,status,price_id,trial_end,current_period_end,cancel_at_period_end,stripe_created_at,has_payment_method,contract_ended_at,payment_grace_started_at,payment_grace_until,payment_failure_notified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $3 IN ('past_due','unpaid') THEN $12::timestamptz END,CASE WHEN $3 IN ('past_due','unpaid') THEN $12::timestamptz+($11||' days')::interval END,NULL) ON CONFLICT(stripe_subscription_id) DO UPDATE SET status=EXCLUDED.status,price_id=EXCLUDED.price_id,trial_end=EXCLUDED.trial_end,current_period_end=EXCLUDED.current_period_end,cancel_at_period_end=EXCLUDED.cancel_at_period_end,stripe_created_at=EXCLUDED.stripe_created_at,has_payment_method=EXCLUDED.has_payment_method,contract_ended_at=CASE WHEN EXCLUDED.status='active' OR (EXCLUDED.status='trialing' AND EXCLUDED.trial_end>now()) THEN NULL ELSE COALESCE(subscriptions.contract_ended_at,EXCLUDED.contract_ended_at) END,payment_grace_started_at=CASE WHEN EXCLUDED.status IN ('past_due','unpaid') THEN COALESCE(subscriptions.payment_grace_started_at,$12::timestamptz) ELSE NULL END,payment_grace_until=CASE WHEN EXCLUDED.status IN ('past_due','unpaid') THEN COALESCE(subscriptions.payment_grace_until,$12::timestamptz+($11||' days')::interval) ELSE NULL END,payment_failure_notified_at=CASE WHEN EXCLUDED.status IN ('past_due','unpaid') THEN subscriptions.payment_failure_notified_at ELSE NULL END,updated_at=now()`,
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
      hasPaymentMethod,
      endedAt,
      graceDays,
      observedAt,
    ],
  );
  if (["past_due", "unpaid"].includes(sub.status)) {
    await client.query(
      `WITH owner AS (SELECT owner_user_id FROM teams WHERE id=$1), episode AS
       (SELECT stripe_subscription_id||':payment_failed:'||to_char(payment_grace_started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS period FROM subscriptions WHERE stripe_subscription_id=$2), created AS (
        INSERT INTO notifications(user_id,kind,period,payload,subscription_id)
        SELECT owner_user_id,'payment_failed',episode.period,$3::jsonb,$2 FROM owner,episode
        ON CONFLICT(user_id,kind,period) DO NOTHING RETURNING created_at)
       UPDATE subscriptions SET payment_failure_notified_at=COALESCE(payment_failure_notified_at,
         (SELECT created_at FROM created),(SELECT created_at FROM notifications n,owner,episode WHERE n.user_id=owner.owner_user_id AND n.kind='payment_failed' AND n.period=episode.period))
       WHERE stripe_subscription_id=$2`,
      [
        team.rows[0].id,
        sub.id,
        JSON.stringify({
          text: `Your payment failed. Update your payment method and pay the outstanding invoice within ${graceDays} days to keep workspace access.`,
          href: "/app/billing",
        }),
      ],
    );
  }
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
  const eventDate = Number.isFinite(event.created)
    ? new Date(event.created * 1000)
    : new Date();
  const sync = async (sub: Stripe.Subscription, trustEventDate = false) => {
    if (
      !["canceled", "incomplete_expired"].includes(sub.status) &&
      (await cancelDuplicateCheckout(
        client,
        {
          customer: sub.customer,
          subscription: sub.id,
        } as Stripe.Checkout.Session,
        stripe,
      ))
    )
      return;
    await syncSubscription(
      client,
      sub,
      trustEventDate && ["past_due", "unpaid"].includes(sub.status)
        ? eventDate
        : new Date(),
    );
  };
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
      await sync(
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
    await sync(
      event.type === "customer.subscription.deleted"
        ? sub
        : await stripe.subscriptions.retrieve(sub.id, { expand: ["customer"] }),
      ["past_due", "unpaid"].includes(sub.status),
    );
  } else if (event.type === "customer.updated") {
    const customer = event.data.object as Stripe.Customer;
    const subscriptions = await client.query(
      `SELECT s.stripe_subscription_id FROM subscriptions s
      JOIN teams t ON t.id=s.team_id WHERE t.stripe_customer_id=$1 AND s.status IN ('trialing','active','past_due')`,
      [customer.id],
    );
    for (const row of subscriptions.rows)
      await sync(
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
      await sync(
        await stripe.subscriptions.retrieve(id, { expand: ["customer"] }),
        event.type === "invoice.payment_failed",
      );
  }
}
