import { randomBytes } from "node:crypto";
import { transaction } from "./db";
import { clientFor, IntakeError, uuid } from "./intake/access";

type Role = { id: number; display_name: string };
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

export async function ensureBookStackLogin(teamId: string, userId: string) {
  if (!uuid(teamId) || !uuid(userId))
    throw new IntakeError("Membership not found.", 404);
  const result = await transaction(async (c) => {
    // Serialize creation, retries, and membership removal across server processes.
    const member = (
      await c.query(
        `SELECT m.role,u.email,u.name,t.id,t.slug,t.host,t.status,t.desired_state,tm.owner_user_id
       FROM memberships m JOIN users u ON u.id=m.user_id
       JOIN teams tm ON tm.id=m.team_id LEFT JOIN tenants t ON t.team_id=m.team_id
       WHERE m.team_id=$1 AND m.user_id=$2 FOR UPDATE OF m`,
        [teamId, userId],
      )
    ).rows[0];
    if (!member) throw new IntakeError("Membership not found.", 404);
    if (member.role === "owner" || member.owner_user_id === userId)
      return { ok: true };
    await c.query(
      "INSERT INTO member_bookstack_logins(team_id,user_id) VALUES($1,$2) ON CONFLICT(team_id,user_id) DO NOTHING",
      [teamId, userId],
    );
    try {
      if (
        (
          await c.query(
            "SELECT 1 FROM member_bookstack_revocations WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL",
            [teamId, userId],
          )
        ).rowCount
      )
        throw new IntakeError(
          "Previous BookStack access removal must finish before creating a login.",
          409,
        );
      if (member.status !== "running" || member.desired_state !== "running")
        throw new IntakeError(
          "Your workspace is not running. Try again when it is ready.",
          409,
        );
      const saved = (
        await c.query(
          "SELECT bookstack_user_id,last_error,managed_by_bookhost,revocation_requested_at,revoked_at FROM member_bookstack_logins WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
          [teamId, userId],
        )
      ).rows[0];
      if (saved?.revocation_requested_at && !saved.revoked_at)
        throw new IntakeError(
          "Previous BookStack access removal must finish before creating a login.",
          409,
        );
      if (saved?.bookstack_user_id && !saved.last_error && !saved.revoked_at)
        return { ok: true };
      const client = await clientFor(member, c);
      const email = member.email.trim().toLowerCase();
      const users = await client.request<{
        data: { id: number; email: string }[];
      }>(`users?filter[email]=${encodeURIComponent(email)}`);
      const existing = users.data.find((u) => u.email.toLowerCase() === email);
      let accountId: number;
      let roleName: string;
      let password: string | null = null;
      if (existing) {
        // Preserve the existing account's password and roles, including owner accounts.
        const account = await client.request<{ id: number; roles: Role[] }>(
          `users/${existing.id}`,
        );
        accountId = account.id;
        roleName =
          account.roles.map((r) => r.display_name).join(", ") ||
          "No role assigned";
      } else {
        let editor: Role | undefined;
        for (let offset = 0; offset <= 9500; offset += 500) {
          const roles = await client.request<{ data: Role[]; total: number }>(
            `roles?count=500&offset=${offset}`,
          );
          editor = roles.data.find((r) => r.display_name === "Editor");
          if (
            editor ||
            offset + roles.data.length >= roles.total ||
            !roles.data.length
          )
            break;
        }
        if (!editor || !validId(editor.id))
          throw new IntakeError(
            'BookStack role "Editor" was not found. Ask your workspace administrator to restore it.',
            409,
          );
        password = randomBytes(24).toString("base64url");
        const account = await client.request<{ id: number }>("users", {
          name: (member.name?.trim() || email.split("@")[0]).slice(0, 100),
          email,
          password,
          send_invite: false,
          roles: [editor.id],
        });
        accountId = account.id;
        roleName = "Editor";
      }
      if (!validId(accountId)) throw new Error("Invalid BookStack response");
      await c.query(
        "UPDATE member_bookstack_logins SET bookstack_user_id=$3,bookstack_role=$4,initial_password=$5,last_error=NULL,updated_at=now() WHERE team_id=$1 AND user_id=$2",
        [teamId, userId, accountId, roleName, password],
      );
      await c.query(
        "UPDATE member_bookstack_logins SET managed_by_bookhost=$3,revocation_requested_at=NULL,revoked_at=NULL,revocation_error=NULL WHERE team_id=$1 AND user_id=$2",
        [
          teamId,
          userId,
          Boolean(password) ||
            (saved?.bookstack_user_id === accountId &&
              saved?.managed_by_bookhost === true &&
              !saved?.revoked_at),
        ],
      );
      return { ok: true };
    } catch (error) {
      // Only our controlled errors may be persisted; never upstream bodies or DB errors.
      const safe =
        error instanceof IntakeError
          ? error
          : new IntakeError(
              "Could not create your BookStack login. Please try again or contact support.",
              503,
            );
      await c.query(
        "UPDATE member_bookstack_logins SET last_error=$3,updated_at=now() WHERE team_id=$1 AND user_id=$2",
        [teamId, userId, safe.message],
      );
      return { error: safe };
    }
  });
  // Throw after commit so an API failure remains visible and retryable.
  if (result.error) throw result.error;
  return { ok: true };
}

// Called under the team and membership locks. Upstream failures are durable and
// never undo removal from BookHost. DELETE retries accept an already absent user.
export async function revokeBookStackLogin(
  c: import("./billing").Queryable,
  teamId: string,
  userId: string,
) {
  // Copy before membership's existing cascade removes the live login mapping.
  await c.query(
    `INSERT INTO member_bookstack_revocations(team_id,user_id,bookstack_user_id,managed_by_bookhost)
    SELECT team_id,user_id,bookstack_user_id,managed_by_bookhost FROM member_bookstack_logins WHERE team_id=$1 AND user_id=$2
    ON CONFLICT(team_id,user_id) DO UPDATE SET bookstack_user_id=EXCLUDED.bookstack_user_id,managed_by_bookhost=EXCLUDED.managed_by_bookhost,revoked_at=NULL,revocation_requested_at=now()
    WHERE member_bookstack_revocations.revoked_at IS NOT NULL`,
    [teamId, userId],
  );
  const saved = (
    await c.query(
      "SELECT * FROM member_bookstack_revocations WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
      [teamId, userId],
    )
  ).rows[0];
  if (!saved || saved.revoked_at) return;
  await c.query(
    "UPDATE member_bookstack_logins SET initial_password=NULL,revocation_requested_at=now(),revocation_error='BookStack access removal pending',updated_at=now() WHERE team_id=$1 AND user_id=$2",
    [teamId, userId],
  );
  try {
    if (saved.bookstack_user_id) {
      if (saved.managed_by_bookhost !== true)
        throw new Error("Unverified account provenance");
      const tenant = (
        await c.query(
          "SELECT t.*,u.email FROM tenants t JOIN teams tm ON tm.id=t.team_id JOIN users u ON u.id=tm.owner_user_id WHERE t.team_id=$1",
          [teamId],
        )
      ).rows[0];
      if (!tenant) throw new Error("Missing tenant");
      const client = await clientFor(tenant, c);
      const email = tenant.email.trim().toLowerCase();
      const users = await client.request<{
        data: { id: number; email: string }[];
      }>(`users?filter[email]=${encodeURIComponent(email)}`);
      const owner = users.data.find((u) => u.email.toLowerCase() === email);
      if (!owner || !validId(owner.id) || owner.id === saved.bookstack_user_id)
        throw new Error("Cannot safely migrate ownership");
      await client.request(
        `users/${saved.bookstack_user_id}`,
        { migrate_ownership_id: owner.id },
        "DELETE",
      );
    }
    for (const table of [
      "member_bookstack_logins",
      "member_bookstack_revocations",
    ])
      await c.query(
        `UPDATE ${table} SET revoked_at=now(),revocation_error=NULL,updated_at=now() WHERE team_id=$1 AND user_id=$2`,
        [teamId, userId],
      );
  } catch {
    const error =
      saved.managed_by_bookhost === true
        ? "BookStack access removal failed. Retry to revoke access; content will be transferred to the owner."
        : "Existing or unverified BookStack account: workspace administrator must revoke access and confirm account ownership. Automatic deletion withheld.";
    for (const table of [
      "member_bookstack_logins",
      "member_bookstack_revocations",
    ])
      await c.query(
        `UPDATE ${table} SET revocation_error=$3,updated_at=now() WHERE team_id=$1 AND user_id=$2`,
        [teamId, userId, error],
      );
  }
}
