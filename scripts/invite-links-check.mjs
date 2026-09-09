// Explicit local acceptance check: synthetic identities, no provider login or email.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { encode } from "next-auth/jwt";
import { databaseConfig } from "./db-config.mjs";
const origin = "http://127.0.0.1:3986";
if (process.env.AUTH_URL !== origin)
  throw new Error("Set AUTH_URL to local acceptance origin");
const pool = new pg.Pool(databaseConfig());
const tag = randomUUID();
const email = `invite-${tag}@example.invalid`;
const ids = [];
let team;
const ip = "192.0.2.186";
const hash = (s) => createHash("sha256").update(s).digest("hex");
async function cookie(user) {
  return (
    "authjs.session-token=" +
    (await encode({
      token: {
        sub: user.id,
        email: user.email,
        session_version: user.session_version,
        auth_time: Math.floor(Date.now() / 1000),
      },
      secret: process.env.AUTH_SECRET,
      salt: "authjs.session-token",
      maxAge: 3600,
    }))
  );
}
async function post(path, data, session = "") {
  return fetch(origin + path, {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      "x-real-ip": ip,
      cookie: session,
    },
    body: JSON.stringify(data),
    redirect: "manual",
  });
}
try {
  const sql = await readFile(
    new URL("../db/migrations/017_team_invites.sql", import.meta.url),
    "utf8",
  );
  await pool.query(sql);
  await pool.query(sql);
  const owner = (
    await pool.query("INSERT INTO users(email) VALUES($1) RETURNING *", [
      `owner-${tag}@example.invalid`,
    ])
  ).rows[0];
  ids.push(owner.id);
  team = (
    await pool.query(
      "INSERT INTO teams(name,owner_user_id) VALUES($1,$2) RETURNING id",
      [`Invite check ${tag}`, owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,'owner')",
    [owner.id, team],
  );
  const ownerCookie = await cookie(owner);
  let res = await post(
    "/api/team",
    { teamId: team, action: "invite", role: "member", maxUses: 1 },
    ownerCookie,
  );
  assert.equal(res.status, 200);
  let link = (await res.json()).link;
  const token = link.split("/").pop();
  const saved = (
    await pool.query("SELECT * FROM team_invites WHERE team_id=$1", [team])
  ).rows[0];
  assert.equal(saved.token_hash, hash(token));
  assert.equal(saved.max_uses, 1);
  res = await fetch(origin + "/join/" + token);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Join Invite check/);
  res = await post("/api/join/" + token, {
    email,
    password: "acceptance-password-123",
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, "/app");
  const memberCookie = res.headers.get("set-cookie").split(";")[0];
  const member = (
    await pool.query("SELECT * FROM users WHERE email=$1", [email])
  ).rows[0];
  ids.push(member.id);
  assert.equal(member.email_verified_at, null);
  assert.equal(
    (
      await pool.query(
        "SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2",
        [team, member.id],
      )
    ).rows[0].role,
    "member",
  );
  res = await fetch(origin + "/app", { headers: { cookie: ownerCookie } });
  assert.match(await res.text(), new RegExp(email.replaceAll(".", "\\.")));
  res = await fetch(origin + "/app", { headers: { cookie: memberCookie } });
  const dashboard = await res.text();
  assert.match(dashboard, /Invite check/);
  assert.doesNotMatch(
    dashboard,
    /Create invitation link|Manage billing|Start free trial|Admin email:/,
  );
  res = await post("/api/checkout", {}, memberCookie);
  assert.equal(res.status, 403);
  for (const action of ["invite", "remove"]) {
    res = await post(
      "/api/team",
      { teamId: team, action, role: "admin", maxUses: 1, userId: owner.id },
      memberCookie,
    );
    assert.equal(res.status, 403);
  }
  res = await post("/api/join/" + token, {
    email: `second-${tag}@example.invalid`,
    password: "acceptance-password-123",
  });
  assert.equal(res.status, 410);
  res = await post(
    "/api/team",
    { teamId: team, action: "invite", role: "admin", maxUses: 10 },
    ownerCookie,
  );
  assert.equal(res.status, 200);
  link = (await res.json()).link;
  const token2 = link.split("/").pop();
  const invite2 = (
    await pool.query("SELECT id FROM team_invites WHERE token_hash=$1", [
      hash(token2),
    ])
  ).rows[0].id;
  res = await post("/api/join/" + token2, {
    email,
    password: "wrong-password-123",
  });
  assert.equal(res.status, 401);
  res = await post(
    "/api/team",
    { teamId: team, action: "remove", userId: member.id },
    ownerCookie,
  );
  assert.equal(res.status, 200);
  res = await post("/api/join/" + token2, {
    email,
    password: "acceptance-password-123",
  });
  assert.equal(res.status, 200);
  assert.equal(
    (
      await pool.query(
        "SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2",
        [team, member.id],
      )
    ).rows[0].role,
    "admin",
  );
  res = await post(
    "/api/team",
    { teamId: team, action: "role", userId: member.id, role: "member" },
    ownerCookie,
  );
  assert.equal(res.status, 200);
  res = await post(
    "/api/team",
    { teamId: team, action: "role", userId: owner.id, role: "member" },
    memberCookie,
  );
  assert.equal(res.status, 403);
  res = await post(
    "/api/team",
    { teamId: team, action: "remove", userId: member.id },
    ownerCookie,
  );
  assert.equal(res.status, 200);
  res = await post("/api/join/" + token2, {}, memberCookie);
  assert.equal(res.status, 200);
  res = await post(
    "/api/team",
    { teamId: team, action: "revoke", inviteId: invite2 },
    ownerCookie,
  );
  assert.equal(res.status, 200);
  res = await post("/api/join/" + token2, {}, memberCookie);
  assert.equal(res.status, 410);
  await pool.query(
    "UPDATE team_invites SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE id=$1",
    [invite2],
  );
  res = await post("/api/join/" + token2, {}, memberCookie);
  assert.equal(res.status, 410);
  await pool.query(
    "UPDATE team_invites SET expires_at=now()+interval '1 day' WHERE id=$1",
    [invite2],
  );
  for (let n = 0; n < 23; n++) {
    const user = (
      await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `seat-${n}-${tag}@example.invalid`,
      ])
    ).rows[0];
    ids.push(user.id);
    await pool.query(
      "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'member')",
      [team, user.id],
    );
  }
  res = await post("/api/join/" + token2, {
    email: `full-${tag}@example.invalid`,
    password: "acceptance-password-123",
  });
  assert.equal(res.status, 409);
  res = await post(
    "/api/team",
    { teamId: team, action: "invite", role: "member", maxUses: 1 },
    ownerCookie,
  );
  assert.equal(res.status, 409);
  console.log(
    "PASS: migration applied twice; HTTP create, fresh join/session, member dashboard, authorization, one-use rejection, existing password, role, revoke, expiry and 25-seat limit.",
  );
} finally {
  if (team) {
    await pool.query("DELETE FROM team_invites WHERE team_id=$1", [team]);
    await pool.query("DELETE FROM memberships WHERE team_id=$1", [team]);
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[]) OR email=$2", [
    ids,
    email,
  ]);
  await pool.query(
    "DELETE FROM rate_limits WHERE key=$1 OR key=ANY($2::text[])",
    ["join:" + hash(ip), ids.map((id) => "team:" + id)],
  );
  await pool.end();
  console.log("Synthetic test records removed.");
}
