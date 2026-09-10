import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { db, transaction } from "./db";
import { sameOrigin, rateLimit } from "./security";
import { validDomain, verifyDomain } from "./custom-domains";
const json = (error: string, status: number) =>
  Response.json({ error }, { status });
export async function domainRequest(
  request: Request,
  action: "add" | "remove" | "check",
) {
  if (!sameOrigin(request)) return json("Invalid origin", 403);
  const session = await auth();
  if (!session?.user?.id) return json("Sign in first", 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json("Invalid request", 400);
  }
  if (!body || typeof body.team !== "string" || !validDomain(body.host))
    return json(
      "Enter a lowercase public domain such as wiki.example.org. BookHost domains and internationalized names are reserved or unsupported.",
      400,
    );
  const { team, host } = body;
  const member = (
    await db.query(
      "SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2",
      [team, session.user.id],
    )
  ).rows[0];
  if (!member || !["owner", "admin"].includes(member.role))
    return json("Only owners and admins can manage domains", 403);
  if (!(await rateLimit(`domains:${team}`, 10, 60)))
    return json("Too many requests. Wait one minute before trying again.", 429);
  try {
    return await transaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '2s'");
      // Shared lock with the worker: withdrawal cannot race activation.
      await client.query("SELECT id FROM teams WHERE id=$1 FOR UPDATE", [team]);
      if (action === "add") {
        const count = (
          await client.query(
            "SELECT count(*) FROM tenant_domains WHERE team_id=$1",
            [team],
          )
        ).rows[0];
        if (Number(count.count) >= 3)
          return json(
            "You can request at most three domains. Remove one first.",
            409,
          );
        const tenant = (
          await client.query(
            "SELECT host FROM tenants WHERE team_id=$1 AND status='running' AND desired_state='running'",
            [team],
          )
        ).rows[0];
        if (!tenant) return json("Your workspace must be running first", 409);
        await client.query(
          "INSERT INTO tenant_domains(team_id,host,verification_token) VALUES($1,$2,$3)",
          [team, host, randomBytes(32).toString("hex")],
        );
        return Response.json({ status: "pending_dns" });
      }
      if (action === "remove") {
        await client.query(
          "UPDATE tenant_domains SET removal_requested_at=now(),last_error='Removal queued' WHERE team_id=$1 AND host=$2",
          [team, host],
        );
        return Response.json({ status: "removing" });
      }
      const domain = (
        await client.query(
          "SELECT d.*,n.host AS tenant_host FROM tenant_domains d JOIN tenants n ON n.team_id=d.team_id WHERE d.team_id=$1 AND d.host=$2 AND d.removal_requested_at IS NULL AND n.status='running' AND n.desired_state='running'",
          [team, host],
        )
      ).rows[0];
      if (!domain)
        return json("Domain unavailable or workspace not running", 404);
      if (domain.status === "active")
        return Response.json({ status: "active" });
      const result = await verifyDomain(
        host,
        domain.verification_token,
        domain.tenant_host,
      );
      const status = result.verified ? "verified" : "pending_dns";
      await client.query(
        "UPDATE tenant_domains SET status=$3,last_error=$4,verified_at=CASE WHEN $3='verified' THEN now() ELSE NULL END WHERE team_id=$1 AND host=$2",
        [team, host, status, result.error || null],
      );
      return Response.json({ status, error: result.error });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return json("This domain is already requested", 409);
    return json("Domain request failed. Please retry.", 503);
  }
}
