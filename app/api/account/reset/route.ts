import { after, NextResponse } from "next/server";
import { smtpReady } from "@/lib/config";
import { clientIp, digest, rateLimit, sameOrigin } from "@/lib/security";
import { normalizeEmail, validNewPassword } from "@/lib/password";
import { sendPasswordReset, resetPassword } from "@/lib/password-reset";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!smtpReady())
    return NextResponse.json(
      {
        error:
          "Email reset is not available yet. Contact info@productivity-boost.com.",
      },
      { status: 503 },
    );
  const data = await request.json().catch(() => ({}));
  const email = normalizeEmail(data.email);
  const ip = clientIp(request);
  if (!ip)
    return NextResponse.json({ error: "Missing client IP" }, { status: 400 });
  const limited = () =>
    NextResponse.json({ error: "Try again in 15 minutes" }, { status: 429 });
  if (data.token) {
    if (
      !(await rateLimit(
        "password-reset-token:" + digest(String(data.token)) + ":" + digest(ip),
        10,
        900,
      )) ||
      !(await rateLimit("password-reset-redeem-ip:" + digest(ip), 10, 900))
    )
      return limited();
    if (
      typeof data.password !== "string" ||
      !validNewPassword(data.password, data.confirmation)
    )
      return NextResponse.json(
        { error: "Use 10–1024 characters and matching passwords" },
        { status: 400 },
      );
    if (!(await resetPassword(String(data.token), data.password)))
      return NextResponse.json(
        { error: "This reset link is invalid or expired. Request a new one." },
        { status: 400 },
      );
    return NextResponse.json({ ok: true, reset: true });
  }
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json(
      { error: "Enter a valid email address" },
      { status: 400 },
    );
  if (
    !(await rateLimit("password-reset-ip:" + digest(ip), 10, 900)) ||
    !(await rateLimit("password-reset-email:" + digest(email), 5, 900))
  )
    return limited();
  after(async () => {
    try {
      await sendPasswordReset(email);
    } catch {
      console.error("Password reset delivery failed");
    }
  });
  return NextResponse.json({ ok: true });
}
