import { campaign, optedOut } from "@/lib/analytics/shared";
import { requestHash } from "@/lib/analytics/server";
import { normalizeEmail } from "@/lib/email";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { baseUrl } from "@/lib/config";
import { stripeClient } from "@/lib/stripe";
import { checkoutParams } from "@/lib/checkout";
import { clientIp, digest, rateLimit, sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin" }, { status: 403 });
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
    const noAnalytics = optedOut(request.headers);
    const utmSource = noAnalytics
      ? null
      : campaign(request.headers.get("x-wissen-utm-source") || body.utm_source);
    const stripe = stripeClient();
    const checkout = await stripe.checkout.sessions.create(
      checkoutParams({
        price: process.env.STRIPE_PRICE_TEAM,
        url: baseUrl(),
        email,
        customer: team?.stripe_customer_id,
        teamId: team?.id,
        resume: Boolean(previous),
        utmSource,
        noAnalytics,
      }),
    );
    const nonce = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO checkout_attempts(session_id,nonce_hash,user_id) VALUES($1,$2,$3)",
      [checkout.id, digest(nonce), session?.user?.id || null],
    );
    if (!noAnalytics)
      await db
        .query(
          "INSERT INTO events(name,team_id,utm_source,visitor_hash) VALUES('checkout_start',$1,$2,$3)",
          [team?.id || null, utmSource, requestHash(request)],
        )
        .catch(() => {});
    const response = NextResponse.json({ url: checkout.url });
    response.cookies.set("wissen-checkout", nonce, {
      httpOnly: true,
      secure: baseUrl().startsWith("https:"),
      sameSite: "lax",
      path: "/welcome",
      maxAge: 86400,
    });
    return response;
  } catch {
    return Response.json(
      { error: "We could not open checkout. Please try again shortly." },
      { status: 503 },
    );
  }
}
