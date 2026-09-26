import { verifyBookStackTicket, TicketError } from "@/lib/live-edit/bookstack-ticket";
import { documentNameFor } from "@/lib/live-edit/join-token";
import { presenceCount } from "@/lib/live-edit/presence-store";
import { IntakeError } from "@/lib/intake/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const claim = await verifyBookStackTicket(
      url.searchParams.get("ticket"),
      url.searchParams.get("sig"),
    );
    const count = presenceCount(documentNameFor(claim.tenant, claim.pageId));
    return Response.json(
      { ok: true, count },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof TicketError || error instanceof IntakeError)
      return Response.json({ ok: false, reason: error.message });
    return Response.json({ ok: false, reason: "Could not check Live Edit presence." });
  }
}
