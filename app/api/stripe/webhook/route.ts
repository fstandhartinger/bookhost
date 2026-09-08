import { stripeClient } from "@/lib/stripe";
import { transaction } from "@/lib/db";
import { handleStripeEvent } from "@/lib/billing";
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET)
    return Response.json(
      { error: "Webhook not configured or missing signature" },
      { status: 400 },
    );
  const stripe = stripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(827492015)");
      await handleStripeEvent(client, event, stripe);
    });
    return Response.json({ received: true });
  } catch {
    console.error("Stripe event processing failed; retry required");
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
