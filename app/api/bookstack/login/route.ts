import { ensureBookStackLogin } from "@/lib/bookstack-members";
import { memberRequest } from "@/lib/bookstack-member-request";
import { errorResponse } from "@/lib/intake/access";
export async function POST(request: Request) {
  try {
    const { teamId, userId } = await memberRequest(request);
    return Response.json(await ensureBookStackLogin(teamId, userId), {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
