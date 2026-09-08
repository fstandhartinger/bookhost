import { auth } from "@/auth";
import { transaction } from "@/lib/db";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  const userId = session.user.id;
  try {
    const password = await transaction(async (client) => {
      const tenant = (
        await client.query(
          "SELECT t.id,t.initial_password FROM tenants t JOIN teams tm ON tm.id=t.team_id WHERE tm.owner_user_id=$1 AND t.status='running' FOR UPDATE OF t",
          [userId],
        )
      ).rows[0];
      if (!tenant?.initial_password) return null;
      await client.query(
        "UPDATE tenants SET initial_password=NULL,updated_at=now() WHERE id=$1",
        [tenant.id],
      );
      return tenant.initial_password as string;
    });
    return Response.json(
      password
        ? { password }
        : {
            error:
              "Password already viewed. Use password reset in your BookStack workspace.",
          },
      {
        status: password ? 200 : 410,
        headers: { "Cache-Control": "no-store, private" },
      },
    );
  } catch {
    return Response.json(
      { error: "Could not retrieve credentials. Please try again." },
      { status: 503 },
    );
  }
}
