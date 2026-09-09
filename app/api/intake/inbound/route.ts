import { boundedBody, errorResponse, IntakeError } from "@/lib/intake/access";
import { EMAIL_LIMIT, parseEmail, verifySignature } from "@/lib/intake/email";
import { acceptEmail } from "@/lib/intake/inbound";
import { drainEmail } from "@/lib/intake/email-jobs";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!request.headers.get("x-wissen-signature"))
      throw new IntakeError("Invalid signature.", 401);
    const raw = Buffer.from(
      await (await boundedBody(request, EMAIL_LIMIT)).arrayBuffer(),
    );
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
