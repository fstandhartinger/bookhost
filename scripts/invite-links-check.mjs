// Local production acceptance: synthetic SQL identities/sessions only, no provider logins or mail.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { encode } from "next-auth/jwt";
import { databaseConfig } from "./db-config.mjs";
const origin = "http://127.0.0.1:3985";
if (process.env.AUTH_URL !== origin)
  throw new Error("Set AUTH_URL to local acceptance origin");
const pool = new pg.Pool(databaseConfig());
const tag = randomUUID(),
  ids = [],
  teams = [],
  emails = [];
const ip = "192.0.2.186",
  password = "acceptance-password-123";
const hash = (s) => createHash("sha256").update(s).digest("hex");
let browser;
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
async function post(path, data, session = "", requestOrigin = origin) {
  return fetch(origin + path, {
    method: "POST",
    headers: {
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      "Content-Type": "application/json",
      "x-real-ip": ip,
      cookie: session,
    },
    body: JSON.stringify(data),
    redirect: "manual",
  });
}
async function user(prefix) {
  const email =
    prefix === "operator"
      ? "invite-operator@example.invalid"
      : `${prefix}-${tag}@example.invalid`;
  emails.push(email);
  const u = (
    await pool.query("INSERT INTO users(email) VALUES($1) RETURNING *", [email])
  ).rows[0];
  ids.push(u.id);
  return u;
}
async function team(owner, name) {
  const t = (
    await pool.query(
      "INSERT INTO teams(name,owner_user_id) VALUES($1,$2) RETURNING id",
      [name, owner.id],
    )
  ).rows[0].id;
  teams.push(t);
  await pool.query(
    "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'owner')",
    [t, owner.id],
  );
  return t;
}
async function invitation(teamId, session, role = "member", maxUses = 10) {
  const r = await post(
    "/api/team",
    { action: "invite", teamId, role, maxUses },
    session,
  );
  assert.equal(r.status, 200);
  const { link } = await r.json();
  assert.match(link, /\/join#[a-f0-9]{64}$/);
  return link.split("#")[1];
}
async function context(token) {
  const r = await post("/api/join/context", { token });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(r.headers.get("set-cookie"), /Max-Age=600/i);
  return r.headers.getSetCookie()[0].split(";")[0];
}
try {
  const owner = await user("owner"),
    ownerCookie = await cookie(owner),
    teamId = await team(owner, "Invite production check");
  const token = await invitation(teamId, ownerCookie);
  for (const path of [
    "/api/team",
    "/api/team/active",
    "/api/join",
    "/api/join/context",
  ]) {
    for (const foreign of [undefined, "null", "https://foreign.invalid"]) {
      const r = await post(
        path,
        {},
        ownerCookie,
        foreign === undefined ? "" : foreign,
      );
      assert.equal(r.status, 403, path);
    }
  }
  const joinCookie = await context(token);
  let r = await fetch(origin + "/join", { headers: { cookie: joinCookie } });
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  let html = await r.text();
  assert.match(html, /Invite production check/);
  assert(!html.includes(token));
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  const email = `member-${tag}@example.invalid`;
  emails.push(email);
  r = await post("/api/join", { email, password }, joinCookie);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, `/app?team=${teamId}`);
  const memberCookie = r.headers
    .getSetCookie()
    .find((c) => c.startsWith("authjs.session-token="))
    .split(";")[0];
  const member = (
    await pool.query("SELECT * FROM users WHERE email=$1", [email])
  ).rows[0];
  ids.push(member.id);
  assert.equal(member.email_verified_at, null);
  r = await post(
    "/api/join",
    { email, password: "incorrect-password" },
    joinCookie,
  );
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "Could not join with these details");
  r = await post("/api/join", {}, memberCookie + "; " + joinCookie);
  assert.equal(r.status, 200);
  assert(
    !r.headers
      .getSetCookie()
      .some((c) => c.startsWith("authjs.session-token=")),
  );
  assert.equal(
    (
      await pool.query("SELECT uses FROM team_invites WHERE token_hash=$1", [
        hash(token),
      ])
    ).rows[0].uses,
    1,
  );
  r = await post(
    "/api/team",
    { action: "invite", teamId, role: "admin", maxUses: 1 },
    memberCookie,
  );
  assert.equal(r.status, 403);
  r = await post(
    "/api/team",
    { action: "remove", teamId, userId: member.id },
    ownerCookie,
  );
  assert.equal(r.status, 200);
  const revokedVersion = (
    await pool.query("SELECT session_version FROM users WHERE id=$1", [
      member.id,
    ])
  ).rows[0].session_version;
  r = await post("/api/join", {}, memberCookie + "; " + joinCookie);
  assert.notEqual(r.status, 200);
  r = await fetch(origin + "/app", {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  assert.equal(r.status, 307);
  r = await post("/api/join", { email, password }, joinCookie);
  assert.equal(r.status, 200);
  assert.equal(
    (
      await pool.query("SELECT session_version FROM users WHERE id=$1", [
        member.id,
      ])
    ).rows[0].session_version,
    revokedVersion,
  );
  const operator = await user("operator");
  r = await fetch(origin + "/admin/stats", {
    headers: { cookie: await cookie(operator) },
  });
  assert.equal(r.status, 404);
  await pool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    operator.id,
  ]);
  r = await fetch(origin + "/admin/stats", {
    headers: { cookie: await cookie(operator) },
  });
  assert.equal(r.status, 200);
  // Real Chromium executes the fragment bootstrap. Synthetic sessions are injected;
  // no login UI, provider, email or real user's browser profile is touched.
  if (!process.env.INVITE_PLAYWRIGHT_MODULE)
    throw new Error(
      "Set INVITE_PLAYWRIGHT_MODULE to installed playwright module for browser acceptance",
    );
  const { chromium } = await import(process.env.INVITE_PLAYWRIGHT_MODULE);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const bc = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "x-real-ip": ip, DNT: "1" },
  });
  const page = await bc.newPage(),
    paths = [];
  page.on("request", (req) =>
    paths.push(new URL(req.url()).pathname + new URL(req.url()).search),
  );
  await page.goto(origin + "/join#" + token);
  await page.getByRole("button", { name: "Join team", exact: true }).waitFor();
  assert.equal(page.url(), origin + "/join");
  assert(paths.every((path) => !path.includes(token)));
  assert(!(await page.evaluate(() => document.cookie)).includes(token));
  await page.getByRole("link", { name: "sign in first" }).click();
  await page.waitForURL(origin + "/login");
  const guest = await user("browser"),
    encoded = await cookie(guest);
  await bc.addCookies([
    {
      name: "authjs.session-token",
      value: encoded.slice(encoded.indexOf("=") + 1),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(origin + "/login");
  await page.waitForURL(origin + "/join");
  await page.getByRole("button", { name: `Join as ${guest.email}` }).click();
  await page.waitForURL(/\/app\?team=/);
  assert.match(
    await page.locator("main").innerText(),
    /Invite production check/,
  );
  const owner2 = await user("owner2"),
    team2 = await team(owner2, "Second invited team"),
    token2 = await invitation(team2, await cookie(owner2));
  await page.goto(origin + "/join#" + token2);
  await page
    .getByRole("heading", { name: "Join Second invited team" })
    .waitFor();
  await page.getByRole("button", { name: `Join as ${guest.email}` }).click();
  await page.waitForURL(/\/app\?team=/);
  await page.goto(origin + "/app");
  assert.equal(await page.locator("select[name=team]").inputValue(), team2);
  await page.selectOption("select[name=team]", teamId);
  const switchResponse = page.waitForResponse((r) =>
    r.url().endsWith("/api/team/active"),
  );
  await page.getByRole("button", { name: "Switch team" }).click();
  const switched = await switchResponse;
  assert.equal(switched.status(), 303, "team switch status");
  assert.equal(switched.headers().location, origin + "/app");
  await page.waitForURL(origin + "/app");
  await page.waitForLoadState("networkidle");
  await page.reload();
  assert.equal(await page.locator("select[name=team]").inputValue(), teamId);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  if (process.env.INVITE_SCREENSHOT)
    await page.screenshot({
      path: process.env.INVITE_SCREENSHOT,
      fullPage: true,
    });
  const nojs = await browser.newContext({
      javaScriptEnabled: false,
      extraHTTPHeaders: { "x-real-ip": ip },
    }),
    manual = await nojs.newPage();
  await manual.goto(origin + "/join");
  await manual.locator("summary").click();
  await manual.locator("input[name=token]").fill(token);
  await manual.getByRole("button", { name: "Open invitation" }).click();
  await manual
    .getByRole("heading", { name: "Join Invite production check" })
    .waitFor();
  console.log(
    "PASS: fragment bootstrap and HTTP-only context; no token in HTTP URLs/HTML; no-JS token form; origin checks; generic password error; verified admin gate; revocation -> join; existing membership without consumption; login return; multi-team cookie and mobile layout.",
  );
} finally {
  await browser?.close();
  await pool.query("DELETE FROM memberships WHERE team_id=ANY($1::uuid[])", [
    teams,
  ]);
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query(
    "DELETE FROM users WHERE id=ANY($1::uuid[]) OR email=ANY($2::text[])",
    [ids, emails],
  );
  await pool.query("DELETE FROM rate_limits WHERE key=ANY($1::text[])", [
    [
      "join-context:" + hash(ip),
      ...ids.map((id) => "team:" + id),
      ...emails.flatMap((e) => [
        "password-user:" + hash(e),
        "password:" + hash(e + ":" + ip),
      ]),
    ],
  ]);
  await pool.end();
  console.log("Synthetic test records removed.");
}
