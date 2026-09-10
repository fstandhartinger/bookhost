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
import { clientIp, digest } from "@/lib/security";
import { correlationId, reportError } from "@/lib/error-diagnostics";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("session_id");
  const nonce = request.cookies.get("wissen-checkout")?.value;
  const login = () =>
    NextResponse.redirect(new URL("/login?checkout=retry", baseUrl()));
  if (!id?.startsWith("cs_") || !nonce) return login();
  let phase = "stripe_retrieve";
  let trustedSessionId: string | undefined;
  let teamId: string | undefined;
  try {
    const current = await auth();
    const stripe = stripeClient();
    const checkout = await stripe.checkout.sessions.retrieve(id);
    trustedSessionId = /^cs_[A-Za-z0-9_]{1,72}$/.test(checkout.id)
      ? checkout.id
      : undefined;
    if (
      checkout.status !== "complete" ||
      checkout.metadata?.venture !== "wissen"
    )
      return login();
    const subscriptionId =
      typeof checkout.subscription === "string"
        ? checkout.subscription
        : checkout.subscription?.id;
    phase = "attempt_validation";
    const result = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(827492015)");
      const attempt = (
        await client.query(
          "SELECT * FROM checkout_attempts WHERE session_id=$1 AND (nonce_hash=$2 OR EXISTS(SELECT 1 FROM checkout_attempt_nonces n WHERE n.session_id=checkout_attempts.session_id AND n.nonce_hash=$2)) AND created_at>now()-interval '24 hours' FOR UPDATE",
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
      phase = "checkout_sync";
      const team = await syncCheckout(client, checkout);
      if (!team) return null;
      teamId = team.id;
      phase = "account_lookup";
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
      if (subscriptionId) phase = "subscription_sync";
      if (subscriptionId)
        await syncSubscription(
          client,
          await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["customer"],
          }),
        );
      phase = "consent_persist";
      for (const document of ["agb", "avv"]) {
        await client.query(
          `INSERT INTO consents(user_id,team_id,document,version,ip,user_agent)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,team_id,document,version) DO NOTHING`,
          [
            user.id,
            team.id,
            document,
            "2026-09-08",
            clientIp(request),
            request.headers.get("user-agent")?.slice(0, 1024) || null,
          ],
        );
      }
      const cookie = sessionCookie();
      // Encode before consuming: a configuration error must not burn the login.
      phase = "jwt_encode";
      const token = await encode({
        token: {
          auth_time: Math.floor(Date.now() / 1000),
          sub: user.id,
          email: user.email,
          name: user.name,
          session_version: user.session_version,
        },
        secret: process.env.AUTH_SECRET!,
        salt: cookie.name,
        maxAge: 7 * 86400,
      });
      phase = "login_consume";
      await client.query("INSERT INTO checkout_logins(session_id) VALUES($1)", [
        id,
      ]);
      phase = "analytics_insert";
      if (checkout.metadata?.no_analytics !== "1")
        await client.query(
          "INSERT INTO events(name,team_id,utm_source) SELECT 'trial_started',id,utm_source FROM teams WHERE id=$1 AND EXISTS(SELECT 1 FROM subscriptions WHERE team_id=$1 AND status='trialing')",
          [team.id],
        );
      return { cookie, token };
    });
    if (!result) return login();
    if ("duplicate" in result)
      return NextResponse.redirect(
        new URL("/login?checkout=existing", baseUrl()),
      );
    const response = NextResponse.redirect(
      new URL("/app?setup=password", baseUrl()),
    );
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
  } catch (error) {
    const reference = correlationId();
    reportError({
      event: "welcome_error",
      phase,
      team_id: teamId,
      session_id: trustedSessionId,
      correlation_id: reference,
      error,
    });
    return NextResponse.redirect(
      new URL(`/login?checkout=retry&reference=${reference}`, baseUrl()),
    );
  }
}
