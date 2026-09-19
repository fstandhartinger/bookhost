import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/analytics/server";
import { operatorVisits } from "@/scripts/analytics-report.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !isAdmin(session?.user?.email))
    return Response.json({ error: "Not found" }, { status: 404 });
  const operator = (
    await db.query("SELECT email,email_verified_at FROM users WHERE id=$1", [
      session.user.id,
    ])
  ).rows[0];
  if (!operator?.email_verified_at || !isAdmin(operator.email))
    return Response.json({ error: "Not found" }, { status: 404 });
  const raw = new URL(request.url).searchParams.get("days");
  const days = raw === null ? 14 : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    return Response.json(
      { error: "days must be an integer between 1 and 90" },
      { status: 400 },
    );
  const data = await operatorVisits(db, days);
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}