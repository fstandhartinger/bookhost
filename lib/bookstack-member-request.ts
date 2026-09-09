import { auth } from "@/auth";
import { sameOrigin } from "./security";
import { boundedBody, IntakeError, uuid } from "./intake/access";

export async function memberRequest(request: Request) {
  if (!sameOrigin(request)) throw new IntakeError("Forbidden", 403);
  const session = await auth();
  if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
  let data;
  try {
    data = await (await boundedBody(request, 4096)).json();
  } catch {
    throw new IntakeError("Invalid request.", 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new IntakeError("Invalid request.");
  if ("userId" in data || "user_id" in data)
    throw new IntakeError("Only your own login can be accessed.", 403);
  if (typeof data.teamId !== "string" || !uuid(data.teamId))
    throw new IntakeError("Team not found.", 404);
  return { teamId: data.teamId as string, userId: session.user.id };
}
