import { auth } from "@/auth";
import { db } from "@/lib/db";
import { stripeClient } from "@/lib/stripe";
import { baseUrl } from "@/lib/config";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  try {
    const team = (
      await db.query(
        "SELECT stripe_customer_id FROM teams WHERE owner_user_id=$1",
        [session.user.id],
      )
    ).rows[0];
    if (!team?.stripe_customer_id)
      return Response.json(
        { error: "Start a free trial first." },
        { status: 400 },
      );
    const portal = await stripeClient().billingPortal.sessions.create({
      customer: team.stripe_customer_id,
      ...(process.env.STRIPE_PORTAL_CONFIG
        ? { configuration: process.env.STRIPE_PORTAL_CONFIG }
        : {}),
      return_url: baseUrl() + "/app",
    });
    return Response.json({ url: portal.url });
  } catch {
    return Response.json(
      { error: "Billing is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
