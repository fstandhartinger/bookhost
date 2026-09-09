import { auth } from "@/auth";
import { sameOrigin, rateLimit } from "@/lib/security";
import { manageTeam } from "@/lib/team";
import { boundedBody, errorResponse } from "@/lib/intake/access";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id)
    return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!(await rateLimit("team:" + session.user.id, 60, 900)))
    return Response.json(
      { error: "Please try again in 15 minutes." },
      { status: 429 },
    );
  try {
    return Response.json(
      await manageTeam(
        session.user.id,
        await (await boundedBody(request, 4096)).json(),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
