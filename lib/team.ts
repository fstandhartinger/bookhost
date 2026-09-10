import {
  ensureBookStackLogin,
  revokeBookStackLogin,
} from "./bookstack-members";
import { randomBytes } from "node:crypto";
import { db, transaction } from "./db";
import { digest } from "./security";
import {
  hashPassword,
  verifyPassword,
  validNewPassword,
  normalizeEmail,
} from "./password";
import { IntakeError, uuid } from "./intake/access";
import { PUBLIC_BASE_URL } from "./config";
import { QUOTAS } from "./quotas";
export const MEMBER_LIMIT = QUOTAS.members;
export function inviteProblem(
  invite:
    | {
        revoked_at: unknown;
        expires_at: Date | string;
        uses: number;
        max_uses: number;
      }
    | undefined,
) {
  if (!invite) return "Invitation not found.";
  if (invite.revoked_at) return "This invitation has been revoked.";
  if (new Date(invite.expires_at).getTime() <= Date.now())
    return "This invitation has expired.";
  if (invite.uses >= invite.max_uses)
    return "This invitation has already been used up.";
  return null;
}
export async function getInvite(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  return (
    await db.query(
      "SELECT i.*,t.name FROM team_invites i JOIN teams t ON t.id=i.team_id WHERE token_hash=$1",
      [digest(token)],
    )
  ).rows[0];
}
export async function manageTeam(
  userId: string,
  data: Record<string, unknown>,
) {
  if (typeof data.teamId !== "string" || !uuid(data.teamId))
    throw new IntakeError("Team not found.", 404);
  return transaction(async (c) => {
    const team = (
      await c.query("SELECT * FROM teams WHERE id=$1 FOR UPDATE", [data.teamId])
    ).rows[0];
    const actor = (
      await c.query(
        "SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2",
        [data.teamId, userId],
      )
    ).rows[0];
    if (!team || !actor || !["owner", "admin"].includes(actor.role))
      throw new IntakeError("Only owners and admins can manage the team.", 403);
    if (data.action === "invite") {
      if (
        !["admin", "member"].includes(String(data.role)) ||
        ![1, 10].includes(Number(data.maxUses))
      )
        throw new IntakeError("Choose a role and 1 or 10 uses.");
      const count = Number(
        (
          await c.query("SELECT count(*) FROM memberships WHERE team_id=$1", [
            team.id,
          ])
        ).rows[0].count,
      );
      if (count >= MEMBER_LIMIT)
        throw new IntakeError(
          `Your plan allows up to ${MEMBER_LIMIT} dashboard members, including the owner.`,
          409,
        );
      const token = randomBytes(32).toString("hex");
      await c.query(
        "INSERT INTO team_invites(team_id,token_hash,role,created_by,max_uses) VALUES($1,$2,$3,$4,$5)",
        [team.id, digest(token), data.role, userId, Number(data.maxUses)],
      );
      return { link: `${PUBLIC_BASE_URL}/join#${token}` };
    }
    if (data.action === "revoke") {
      if (typeof data.inviteId !== "string" || !uuid(data.inviteId))
        throw new IntakeError("Invalid invitation.");
      await c.query(
        "UPDATE team_invites SET revoked_at=now() WHERE id=$1 AND team_id=$2 AND revoked_at IS NULL",
        [data.inviteId, team.id],
      );
      return { ok: true };
    }
    if (typeof data.userId !== "string" || !uuid(data.userId))
      throw new IntakeError("Invalid member.");
    if (data.userId === userId || data.userId === team.owner_user_id)
      throw new IntakeError("You cannot change yourself or the owner.", 403);
    const target = (
      await c.query(
        "SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
        [team.id, data.userId],
      )
    ).rows[0];
    if (data.action === "retry-revocation") {
      if (target)
        throw new IntakeError("Member still belongs to the team.", 409);
      await revokeBookStackLogin(c, team.id, data.userId);
      return { ok: true };
    }
    if (!target) throw new IntakeError("Member not found.", 404);
    if (data.action === "remove") {
      await revokeBookStackLogin(c, team.id, data.userId);
      await c.query("DELETE FROM memberships WHERE team_id=$1 AND user_id=$2", [
        team.id,
        data.userId,
      ]);
    } else if (data.action === "role") {
      if (team.owner_user_id !== userId)
        throw new IntakeError("Only the owner can change roles.", 403);
      if (!["admin", "member"].includes(String(data.role)))
        throw new IntakeError("Invalid role.");
      await c.query(
        "UPDATE memberships SET role=$3 WHERE team_id=$1 AND user_id=$2",
        [team.id, data.userId, data.role],
      );
    } else throw new IntakeError("Invalid action.");
    if (
      data.action === "remove" ||
      (data.action === "role" &&
        target.role === "admin" &&
        data.role === "member")
    ) {
      await c.query(
        "UPDATE team_invites SET revoked_at=now() WHERE team_id=$1 AND created_by=$2 AND revoked_at IS NULL",
        [team.id, data.userId],
      );
      // No session_version bump here. The session token carries no team or
      // role, so every page and route resolves both from the database on each
      // request: deleting the membership already ends the access. Bumping the
      // counter would sign the person out of every team at once, including a
      // workspace of their own that this removal has nothing to do with.
    }
    return { ok: true };
  });
}
export async function joinTeam(
  token: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  sessionVersion?: number,
) {
  const initial = await getInvite(token);
  const problem = inviteProblem(initial);
  if (problem) throw new IntakeError(problem, 410);
  const email = normalizeEmail(data.email);
  const password = typeof data.password === "string" ? data.password : "";
  if (
    !userId &&
    (email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      !validNewPassword(password, password))
  )
    throw new IntakeError(
      "Enter a valid email and a password of 10–1024 characters.",
    );
  // Hash before acquiring the team lock; authenticate existing accounts under lock.
  const hash = userId ? null : await hashPassword(password);
  const joined = await transaction(async (c) => {
    await c.query("SELECT id FROM teams WHERE id=$1 FOR UPDATE", [
      initial.team_id,
    ]);
    const invite = (
      await c.query("SELECT * FROM team_invites WHERE id=$1 FOR UPDATE", [
        initial.id,
      ])
    ).rows[0];
    const issue = inviteProblem(invite);
    if (issue) throw new IntakeError(issue, 410);
    let user;
    if (userId) {
      user = (
        await c.query(
          "SELECT id,email,name,session_version FROM users WHERE id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (
        !user ||
        sessionVersion === undefined ||
        user.session_version !== sessionVersion
      )
        throw new IntakeError("Please sign in again.", 401);
    } else {
      // Serialize account creation across different teams too.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        email,
      ]);
      user = (
        await c.query("SELECT * FROM users WHERE lower(email)=$1 FOR UPDATE", [
          email,
        ])
      ).rows[0];
      const passwordMatches = await verifyPassword(
        user?.password_hash || null,
        password,
      );
      if (user && !passwordMatches)
        throw new IntakeError("Could not join with these details", 401);
    }
    if (
      user &&
      (
        await c.query(
          "SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2",
          [invite.team_id, user.id],
        )
      ).rowCount
    )
      return { ...user, team_id: invite.team_id };
    const count = Number(
      (
        await c.query("SELECT count(*) FROM memberships WHERE team_id=$1", [
          invite.team_id,
        ])
      ).rows[0].count,
    );
    if (count >= MEMBER_LIMIT)
      throw new IntakeError(
        `This team has reached its limit of ${MEMBER_LIMIT} dashboard members. Ask an admin to free a place.`,
        409,
      );
    if (!user && userId) throw new IntakeError("Please sign in first.", 401);
    if (!user)
      user = (
        await c.query(
          "INSERT INTO users(email,password_hash,password_set_at) VALUES($1,$2,now()) RETURNING id,email,name,session_version",
          [email, hash],
        )
      ).rows[0];
    await c.query(
      "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,$3)",
      [invite.team_id, user.id, invite.role],
    );
    await c.query("UPDATE team_invites SET uses=uses+1 WHERE id=$1", [
      invite.id,
    ]);
    return { ...user, team_id: invite.team_id };
  });
  // Membership is already committed; tenant/API failures must not block joining.
  try {
    await ensureBookStackLogin(joined.team_id, joined.id);
  } catch {
    // Provisioning errors are persisted by ensureBookStackLogin; retry in the dashboard.
  }
  return joined;
}
