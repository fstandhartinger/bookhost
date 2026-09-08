import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { auth, sessionCookie } from "@/auth";
import { transaction } from "@/lib/db";
import { stripeClient } from "@/lib/stripe";
import { syncCheckout, syncSubscription } from "@/lib/billing";
import { baseUrl } from "@/lib/config";
import { digest } from "@/lib/security";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("session_id");
  const nonce = request.cookies.get("wissen-checkout")?.value;
  const login = () =>
    NextResponse.redirect(new URL("/login?checkout=retry", baseUrl()));
  if (!id?.startsWith("cs_") || !nonce) return login();
  try {
    const current = await auth();
    const stripe = stripeClient();
    const checkout = await stripe.checkout.sessions.retrieve(id);
    if (
      checkout.status !== "complete" ||
      checkout.metadata?.venture !== "wissen"
    )
      return login();
    const subscriptionId =
      typeof checkout.subscription === "string"
        ? checkout.subscription
        : checkout.subscription?.id;
    const sub = subscriptionId
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : null;
    const result = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(827492015)");
      const attempt = (
        await client.query(
          "SELECT * FROM checkout_attempts WHERE session_id=$1 AND nonce_hash=$2 AND created_at>now()-interval '24 hours' FOR UPDATE",
          [id, digest(nonce)],
        )
      ).rows[0];
      if (
        !attempt ||
        (attempt.user_id && attempt.user_id !== current?.user?.id)
      )
        return null;
      if (
        (
          await client.query(
            "SELECT 1 FROM checkout_logins WHERE session_id=$1",
            [id],
          )
        ).rowCount
      )
        return null;
      const team = await syncCheckout(client, checkout);
      if (!team) return null;
      const user = (
        await client.query("SELECT * FROM users WHERE id=$1", [
          team.owner_user_id,
        ])
      ).rows[0];
      if (user.checkout_session_id !== id && current?.user?.id !== user.id)
        return null;
      if (sub) await syncSubscription(client, sub);
      const cookie = sessionCookie();
      // Encode before consuming: a configuration error must not burn the login.
      const token = await encode({
        token: { sub: user.id, email: user.email, name: user.name },
        secret: process.env.AUTH_SECRET!,
        salt: cookie.name,
        maxAge: 7 * 86400,
      });
      await client.query("INSERT INTO checkout_logins(session_id) VALUES($1)", [
        id,
      ]);
      return { cookie, token };
    });
    if (!result) return login();
    const response = NextResponse.redirect(new URL("/app", baseUrl()));
    response.cookies.set(result.cookie.name, result.token, {
      ...result.cookie.options,
      maxAge: 7 * 86400,
    });
    response.cookies.set("wissen-checkout", "", {
      path: "/welcome",
      maxAge: 0,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return login();
  }
}
