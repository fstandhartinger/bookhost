import Stripe from "stripe";
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new Error("Billing is not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 15000,
  });
}
