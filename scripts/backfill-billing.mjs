// Run once after 014, with the same external DB/TLS environment and Stripe key.
// Stripe calls are read-only. Existing subscription status is never changed.
import pg from "pg";
import Stripe from "stripe";
import { databaseConfig } from "./db-config.mjs";
const db = new pg.Pool(databaseConfig());
try {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 15000,
  });
  const { rows } = await db.query(
    "SELECT stripe_subscription_id FROM subscriptions WHERE stripe_created_at IS NULL",
  );
  let updated = 0;
  for (const row of rows) {
    const s = await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
      expand: ["customer"],
    });
    const hasPaymentMethod = Boolean(
      s.default_payment_method ||
      s.default_source ||
      (typeof s.customer !== "string" &&
        !s.customer.deleted &&
        (s.customer.invoice_settings.default_payment_method ||
          s.customer.default_source)),
    );
    await db.query(
      "UPDATE subscriptions SET stripe_created_at=$2,has_payment_method=$3 WHERE stripe_subscription_id=$1 AND stripe_created_at IS NULL",
      [s.id, new Date(s.created * 1000), hasPaymentMethod],
    );
    updated++;
  }
  console.log(
    `Backfilled ${updated} subscription creation timestamps and payment-method flags.`,
  );
} catch {
  console.error(
    "Billing backfill failed; verify external DB/TLS and Stripe configuration. Safe to retry.",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
