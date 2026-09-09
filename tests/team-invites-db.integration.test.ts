vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {} }));
import { afterAll, expect, it, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { joinTeam, manageTeam } from "@/lib/team";
import { sessionToken } from "@/lib/session";
import {
  hashPassword,
  verifyPassword,
  consumePasswordAttempt,
  authorizePassword,
} from "@/lib/password";
import { digest } from "@/lib/security";
const enabled = process.env.INTAKE_DB_TEST === "1";
const users: string[] = [],
  teams: string[] = [],
  emails: string[] = [];
const ip = "192.0.2.187",
  password = "invitation-regression-password";
async function user() {
  const email = `invite-db-${randomUUID()}@example.invalid`;
  emails.push(email);
  const row = (
    await db.query(
      "INSERT INTO users(email,password_hash,password_set_at) VALUES($1,$2,now()) RETURNING *",
      [email, await hashPassword(password)],
    )
  ).rows[0];
  users.push(row.id);
  return row;
}
async function team(owner: string) {
  const row = (
    await db.query(
      "INSERT INTO teams(name,owner_user_id) VALUES('Invite DB regression',$1) RETURNING *",
      [owner],
    )
  ).rows[0];
  teams.push(row.id);
  await db.query(
    "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'owner')",
    [row.id, owner],
  );
  return row.id;
}
async function invite(teamId: string, owner: string) {
  return (
    await manageTeam(owner, {
      action: "invite",
      teamId,
      role: "member",
      maxUses: 1,
    })
  ).link!.split("#")[1];
}
afterAll(async () => {
  if (!enabled) return;
  await db.query("DELETE FROM memberships WHERE team_id=ANY($1::uuid[])", [
    teams,
  ]);
  await db.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await db.query("DELETE FROM rate_limits WHERE key=ANY($1::text[])", [
    emails.flatMap((email) => [
      "password-user:" + digest(email),
      "password:" + digest(email + ":" + ip),
    ]),
  ]);
});
it.skipIf(!enabled)(
  "migration 017 applies twice in an isolated rolled-back schema",
  async () => {
    const schema = "invite_migration_" + randomBytes(8).toString("hex"),
      c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(`CREATE SCHEMA ${schema}`);
      await c.query(`SET LOCAL search_path TO ${schema},public`);
      await c.query(
        "CREATE TABLE users(id uuid PRIMARY KEY); CREATE TABLE teams(id uuid PRIMARY KEY); CREATE TABLE memberships(team_id uuid,user_id uuid)",
      );
      const sql = await readFile("db/migrations/017_team_invites.sql", "utf8");
      await c.query(sql);
      await c.query(sql);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  },
);
it.skipIf(!enabled)(
  "five concurrent joins on a one-use link have exactly one winner",
  async () => {
    const owner = await user(),
      teamId = await team(owner.id),
      token = await invite(teamId, owner.id);
    const entrants = await Promise.all(Array.from({ length: 5 }, user));
    const outcomes = await Promise.allSettled(
      entrants.map((u) => joinTeam(token, u.id, {}, u.session_version)),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await db.query("SELECT uses FROM team_invites WHERE token_hash=$1", [
          digest(token),
        ])
      ).rows[0].uses,
    ).toBe(1);
    expect(
      Number(
        (
          await db.query("SELECT count(*) FROM memberships WHERE team_id=$1", [
            teamId,
          ])
        ).rows[0].count,
      ),
    ).toBe(2);
  },
  20000,
);
it.skipIf(!enabled)(
  "revocation before join rejects the old version; password join preserves current version",
  async () => {
    const owner = await user(),
      entrant = await user(),
      teamId = await team(owner.id),
      token = await invite(teamId, owner.id),
      lock = await db.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM teams WHERE id=$1 FOR UPDATE", [teamId]);
      const pending = joinTeam(
        token,
        entrant.id,
        {},
        entrant.session_version,
      ).then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error }),
      );
      await db.query(
        "UPDATE users SET session_version=session_version+1 WHERE id=$1",
        [entrant.id],
      );
      await lock.query("COMMIT");
      expect((await pending).error).toMatchObject({ status: 401 });
      const current = (
        await db.query("SELECT session_version FROM users WHERE id=$1", [
          entrant.id,
        ])
      ).rows[0].session_version;
      const joined = await joinTeam(token, undefined, {
        email: entrant.email,
        password,
      });
      expect(joined.session_version).toBe(current);
      expect(
        await sessionToken({
          sub: entrant.id,
          session_version: entrant.session_version,
        }),
      ).toBeNull();
      expect(
        (
          await db.query("SELECT session_version FROM users WHERE id=$1", [
            entrant.id,
          ])
        ).rows[0].session_version,
      ).toBe(current);
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
  },
);
it.skipIf(!enabled)(
  "verification clears the unverified password and retains join memberships",
  async () => {
    const owner = await user(),
      teamId = await team(owner.id),
      token = await invite(teamId, owner.id);
    const email = `invite-db-${randomUUID()}@example.invalid`;
    emails.push(email);
    const joined = await joinTeam(token, undefined, { email, password });
    users.push(joined.id);
    const verified = await sessionToken({}, joined.id),
      row = (await db.query("SELECT * FROM users WHERE id=$1", [joined.id]))
        .rows[0];
    expect(row.password_hash).toBeNull();
    expect(row.password_set_at).toBeNull();
    expect(row.email_verified_at).toBeTruthy();
    expect(await verifyPassword(row.password_hash, password)).toBe(false);
    expect(
      await sessionToken({
        sub: joined.id,
        session_version: joined.session_version,
      }),
    ).toBeNull();
    expect(verified?.session_version).toBe(joined.session_version + 1);
    expect(
      (
        await db.query("SELECT 1 FROM memberships WHERE user_id=$1", [
          joined.id,
        ])
      ).rowCount,
    ).toBe(1);
    await db.query(
      "UPDATE users SET password_hash=$2,password_set_at=now() WHERE id=$1",
      [joined.id, await hashPassword(password)],
    );
    await sessionToken({}, joined.id);
    expect(
      await verifyPassword(
        (
          await db.query("SELECT password_hash FROM users WHERE id=$1", [
            joined.id,
          ])
        ).rows[0].password_hash,
        password,
      ),
    ).toBe(true);
  },
);
it.skipIf(!enabled).each(["remove", "role"])(
  "%s revokes the member's invites and sessions",
  async (action) => {
    const owner = await user(),
      admin = await user(),
      teamId = await team(owner.id);
    await db.query(
      "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'admin')",
      [teamId, admin.id],
    );
    const token = await invite(teamId, admin.id);
    await manageTeam(owner.id, {
      teamId,
      action,
      userId: admin.id,
      role: "member",
    });
    expect(
      (
        await db.query(
          "SELECT revoked_at FROM team_invites WHERE token_hash=$1",
          [digest(token)],
        )
      ).rows[0].revoked_at,
    ).toBeTruthy();
    expect(
      await sessionToken({
        sub: admin.id,
        session_version: admin.session_version,
      }),
    ).toBeNull();
    await expect(
      joinTeam(token, owner.id, {}, owner.session_version),
    ).rejects.toMatchObject({ status: 410 });
  },
);
it.skipIf(!enabled)("join and login share both password budgets", async () => {
  const u = await user(),
    request = new Request("http://localhost/api/join", {
      headers: { "x-real-ip": ip },
    });
  for (let i = 0; i < 10; i++) await consumePasswordAttempt(u.email, request);
  await expect(
    authorizePassword({ email: u.email, password }, request),
  ).rejects.toMatchObject({ code: "rate_limited" });
  await db.query("UPDATE rate_limits SET hits=30 WHERE key=$1", [
    "password-user:" + digest(u.email),
  ]);
  await db.query("DELETE FROM rate_limits WHERE key=$1", [
    "password:" + digest(u.email + ":" + ip),
  ]);
  await expect(consumePasswordAttempt(u.email, request)).rejects.toMatchObject({
    code: "rate_limited",
  });
});
it.skipIf(!enabled)(
  "two different invitations racing for seat 25 admit exactly one member",
  async () => {
    const owner = await user(),
      teamId = await team(owner.id);
    const tokens = [
      await invite(teamId, owner.id),
      await invite(teamId, owner.id),
    ];
    const seats = await Promise.all(Array.from({ length: 23 }, user));
    await db.query(
      "INSERT INTO memberships(team_id,user_id,role) SELECT $1,unnest($2::uuid[]),'member'",
      [teamId, seats.map((u) => u.id)],
    );
    const entrants = await Promise.all([user(), user()]);
    const outcomes = await Promise.allSettled(
      entrants.map((u, i) => joinTeam(tokens[i], u.id, {}, u.session_version)),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      Number(
        (
          await db.query("SELECT count(*) FROM memberships WHERE team_id=$1", [
            teamId,
          ])
        ).rows[0].count,
      ),
    ).toBe(25);
  },
  20000,
);
it.skipIf(!enabled)(
  "management cannot revoke sessions of a non-member in another team",
  async () => {
    const owner = await user(),
      outsider = await user(),
      teamId = await team(owner.id);
    await expect(
      manageTeam(owner.id, { action: "remove", teamId, userId: outsider.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await sessionToken({
        sub: outsider.id,
        session_version: outsider.session_version,
      }),
    ).not.toBeNull();
  },
);
