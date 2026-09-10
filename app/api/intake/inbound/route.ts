import { requireInboundEmail } from "@/lib/intake/inbound-enabled";
import { boundedBody, errorResponse, IntakeError } from "@/lib/intake/access";
import { EMAIL_LIMIT, parseEmail, verifySignature } from "@/lib/intake/email";
import { acceptEmail } from "@/lib/intake/inbound";
import { drainEmail } from "@/lib/intake/email-jobs";
import { clientIp, digest, rateLimit } from "@/lib/security";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireInboundEmail("webhook");
    if (!process.env.INBOUND_WEBHOOK_SECRET)
      throw new IntakeError("Inbound intake is not configured.", 503);
    if (
      !(await rateLimit("inbound-global", 30, 60)) ||
      !(await rateLimit(
        "inbound-ip:" + digest(clientIp(request) || "unknown"),
        30,
        60,
      ))
    )
      throw new IntakeError("Inbound rate limit reached.", 429);
    if (!request.headers.get("x-wissen-signature"))
      throw new IntakeError("Invalid signature.", 401);
    const length = request.headers.get("content-length");
    if (!length || !/^\d+$/.test(length))
      throw new IntakeError("Content-Length is required.", 411);
    if (Number(length) > EMAIL_LIMIT)
      throw new IntakeError("Request is too large.", 413);
    const raw = Buffer.from(
      await (
        await boundedBody(request, Math.min(EMAIL_LIMIT, Number(length)))
      ).arrayBuffer(),
    );
    if (raw.length !== Number(length))
      throw new IntakeError("Content-Length mismatch.");
    if (
      !verifySignature(
        raw,
        request.headers.get("x-wissen-signature"),
        process.env.INBOUND_WEBHOOK_SECRET,
      )
    )
      throw new IntakeError("Invalid signature.", 401);
    const item_ids = await acceptEmail(parseEmail(raw));
    void drainEmail().catch(() =>
      console.error("Email intake dispatch failed"),
    );
    return Response.json({ item_ids }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
