import { auth } from "@/auth";
import { transaction } from "@/lib/db";
import { validateSlug } from "@/lib/slug";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  const userId = session.user.id;
  const userEmail = session.user.email;
  const body = await request.json().catch(() => ({}));
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const error = validateSlug(slug);
  if (error) return Response.json({ error }, { status: 400 });
  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  try {
    const result = await transaction(async (client) => {
      const team = (
        await client.query(
          "SELECT * FROM teams WHERE owner_user_id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (!team)
        return {
          error: "Start your free trial before creating a workspace.",
          status: 403,
        };
      const subscription = await client.query(
        "SELECT 1 FROM effective_subscriptions WHERE team_id=$1 AND (status='active' OR (status='trialing' AND trial_end>now()))",
        [team.id],
      );
      if (!subscription.rowCount)
        return {
          error: "An active subscription or trial is required.",
          status: 403,
        };
      if (
        (
          await client.query("SELECT 1 FROM tenants WHERE team_id=$1", [
            team.id,
          ])
        ).rowCount
      )
        return { error: "Your team already has a workspace.", status: 409 };
      if (name)
        await client.query("UPDATE teams SET name=$1 WHERE id=$2", [
          name,
          team.id,
        ]);
      await client.query(
        "INSERT INTO tenants(team_id,slug,status,admin_email) VALUES($1,$2,'pending',$3)",
        [team.id, slug, userEmail],
      );
      return { ok: true };
    });
    return Response.json(result, {
      status: "status" in result ? result.status : 201,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return Response.json(
        { error: "This address is taken. Please choose another." },
        { status: 409 },
      );
    return Response.json(
      { error: "Could not create your workspace. Please try again." },
      { status: 503 },
    );
  }
}
