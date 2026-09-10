import { campaign, optedOut } from "@/lib/analytics/shared";
import { requestHash } from "@/lib/analytics/server";
import { normalizeEmail } from "@/lib/email";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { baseUrl } from "@/lib/config";
import { stripeClient } from "@/lib/stripe";
import { WORKSPACE_UNAVAILABLE_MESSAGE } from "@/lib/trial";
import { teamCheckout } from "@/lib/team-checkout";
import { IntakeError } from "@/lib/intake/access";
import { checkoutParams } from "@/lib/checkout";
import { clientIp, digest, rateLimit, sameOrigin } from "@/lib/security";
import { correlationId, reportError } from "@/lib/error-diagnostics";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  let phase = "request_setup";
  let teamId: string | undefined;
  let checkoutSessionId: string | undefined;
  try {
    const session = await auth();
    const body = await request.json().catch(() => ({}));
    const rawEmail = session?.user?.email || body.email;
    const email = normalizeEmail(rawEmail);
    if (
      rawEmail &&
      (typeof rawEmail !== "string" ||
        email.length > 254 ||
        !/^\S+@\S+\.\S+$/.test(email))
    )
      return Response.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      );
    const ip = clientIp(request);
    if (!ip)
      return Response.json({ error: "Missing client IP" }, { status: 400 });
    const key = digest(session?.user?.id || ip);
    if (!(await rateLimit("checkout:" + key, 15)))
      return Response.json(
        { error: "Too many requests. Please try again in an hour." },
        { status: 429 },
      );
    const team = session?.user?.id
      ? (
          await db.query("SELECT * FROM teams WHERE owner_user_id=$1", [
            session.user.id,
          ])
        ).rows[0]
      : null;
    teamId = team?.id;
    // A member of another team starts a trial for a new team of their own.
    // Only an explicit reference to a team the caller does not own is refused:
    // managing a foreign team's billing remains restricted to its owner.
    const requestedTeam =
      typeof body.team === "string" && body.team.trim() ? body.team.trim() : "";
    if (requestedTeam && requestedTeam !== team?.id)
      return Response.json(
        { error: "Only the team owner can manage billing." },
        { status: 403 },
      );
    if (
      team &&
      (
        await db.query(
          "SELECT 1 FROM subscriptions WHERE team_id=$1 AND status IN ('trialing','active','past_due','unpaid','incomplete','paused')",
          [team.id],
        )
      ).rowCount
    )
      return Response.json(
        {
          portal: true,
          error:
            "Your team already has a subscription. Manage it from your dashboard.",
        },
        { status: 409 },
      );
    if (
      !session &&
      email &&
      (await db.query("SELECT 1 FROM users WHERE lower(email)=$1", [email]))
        .rowCount
    )
      return Response.json(
        { error: "Please sign in before starting another subscription." },
        { status: 409 },
      );
    if (!process.env.STRIPE_PRICE_TEAM)
      return Response.json(
        { error: "Billing is being set up. Please try again shortly." },
        { status: 503 },
      );
    const previous = team
      ? (
          await db.query(
            "SELECT 1 FROM subscriptions WHERE team_id=$1 LIMIT 1",
            [team.id],
          )
        ).rowCount
      : 0;
    if (previous) {
      const tenant = (
        await db.query("SELECT status,error FROM tenants WHERE team_id=$1", [
          team.id,
        ])
      ).rows[0];
      // Paying again must not promise back data we destroyed. A team that never
      // reached a running workspace has nothing to restore, so it may subscribe:
      // the onboarding step survives tenant rows and is the durable evidence.
      const everHadWorkspace = tenant
        ? tenant.error === "workspace_unavailable"
        : Boolean(
            (
              await db.query(
                "SELECT 1 FROM team_onboarding WHERE team_id=$1 AND step='workspace'",
                [team!.id],
              )
            ).rowCount,
          );
      if (everHadWorkspace)
        return Response.json(
          { error: WORKSPACE_UNAVAILABLE_MESSAGE },
          { status: 409 },
        );
    }
    const noAnalytics = optedOut(request.headers);
    const utmSource = noAnalytics
      ? null
      : campaign(request.headers.get("x-wissen-utm-source") || body.utm_source);
    const stripe = stripeClient();
    const params = checkoutParams({
      price: process.env.STRIPE_PRICE_TEAM,
      url: baseUrl(),
      email,
      customer: team?.stripe_customer_id,
      teamId: team?.id,
      resume: Boolean(previous),
      utmSource,
      noAnalytics,
    });
    phase = "checkout_create";
    const checkout = team
      ? await teamCheckout(team.id, params, stripe)
      : await stripe.checkout.sessions.create(params);
    checkoutSessionId = checkout.id;
    const nonce = randomBytes(32).toString("hex");
    phase = "attempt_persist";
    await db.query(
      "INSERT INTO checkout_attempts(session_id,nonce_hash,user_id) VALUES($1,$2,$3) ON CONFLICT(session_id) DO NOTHING",
      [checkout.id, digest(nonce), session?.user?.id || null],
    );
    phase = "nonce_persist";
    await db.query(
      "INSERT INTO checkout_attempt_nonces(session_id,nonce_hash) SELECT session_id,$2 FROM checkout_attempts WHERE session_id=$1 AND user_id IS NOT DISTINCT FROM $3 ON CONFLICT DO NOTHING",
      [checkout.id, digest(nonce), session?.user?.id || null],
    );
    if (!noAnalytics) {
      const analyticsCorrelation = correlationId();
      await db
        .query(
          "INSERT INTO events(name,team_id,utm_source,visitor_hash) VALUES('checkout_start',$1,$2,$3)",
          [team?.id || null, utmSource, requestHash(request)],
        )
        .catch((error) =>
          reportError({
            event: "checkout_error",
            phase: "analytics_insert",
            team_id: teamId,
            session_id: checkoutSessionId,
            correlation_id: analyticsCorrelation,
            error,
          }),
        );
    }
    const response = NextResponse.json({ url: checkout.url });
    response.cookies.set("wissen-checkout", nonce, {
      httpOnly: true,
      secure: baseUrl().startsWith("https:"),
      sameSite: "lax",
      path: "/welcome",
      maxAge: 86400,
    });
    return response;
  } catch (error) {
    if (error instanceof IntakeError && error.status === 409)
      return Response.json({ error: error.message }, { status: 409 });
    const reference = correlationId();
    reportError({
      event: "checkout_error",
      phase,
      team_id: teamId,
      session_id: checkoutSessionId,
      correlation_id: reference,
      error,
    });
    return Response.json(
      {
        error: `We could not open checkout. Please try again shortly. Reference: ${reference}`,
        reference,
      },
      { status: 503 },
    );
  }
}
