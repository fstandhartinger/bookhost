import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { auth, sessionCookie } from "@/auth";
import { transaction } from "@/lib/db";
import { stripeClient } from "@/lib/stripe";
import {
  syncCheckout,
  syncSubscription,
  cancelDuplicateCheckout,
} from "@/lib/billing";
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
      if (await cancelDuplicateCheckout(client, checkout, stripe))
        return { duplicate: true } as const;
      const team = await syncCheckout(client, checkout);
      if (!team) return null;
      const user = (
        await client.query("SELECT * FROM users WHERE id=$1", [
          team.owner_user_id,
        ])
      ).rows[0];
      if (user.email_verified_at && current?.user?.id !== user.id) return null;
      if (user.checkout_session_id !== id && current?.user?.id !== user.id)
        return null;
      // Fetch only after acquiring the same lock used by the webhook. Stripe
      // subscriptions have no updated timestamp; serialized fresh reads prevent stale writes.
      if (subscriptionId)
        await syncSubscription(
          client,
          await stripe.subscriptions.retrieve(subscriptionId),
        );
      for (const document of ["agb", "avv"]) {
        await client.query(
          `INSERT INTO consents(user_id,team_id,document,version,ip,user_agent)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,team_id,document,version) DO NOTHING`,
          [
            user.id,
            team.id,
            document,
            "2026-09-08",
            request.headers
              .get("x-forwarded-for")
              ?.split(",")[0]
              .trim()
              .slice(0, 128) || null,
            request.headers.get("user-agent")?.slice(0, 1024) || null,
          ],
        );
      }
      const cookie = sessionCookie();
      // Encode before consuming: a configuration error must not burn the login.
      const token = await encode({
        token: {
          sub: user.id,
          email: user.email,
          name: user.name,
          session_version: user.session_version,
        },
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
    if ("duplicate" in result)
      return NextResponse.redirect(
        new URL("/login?checkout=existing", baseUrl()),
      );
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
