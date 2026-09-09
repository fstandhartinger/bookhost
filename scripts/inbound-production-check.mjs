// Opt-in smoke check: read demo credentials, write only to a disposable test DB.
import assert from "node:assert/strict";
import {
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import pg from "pg";
import { databaseConfig } from "./db-config.mjs";
const testUrl = process.env.INBOUND_CHECK_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.includes("inbound_review"))
  throw Error(
    "Set INBOUND_CHECK_DATABASE_URL to a disposable inbound_review database with migrations applied.",
  );
if (testUrl === process.env.DATABASE_URL)
  throw Error("Test and source databases must differ.");
const source = new pg.Pool(databaseConfig());
const target = new pg.Pool({
  connectionString: testUrl,
  connectionTimeoutMillis: 5000,
});
const secret = randomBytes(32).toString("hex");
let child, user, team, tenant;
async function start(configured) {
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      "3988",
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        DATABASE_SSL_CA_BASE64: "",
        INBOUND_WEBHOOK_SECRET: configured ? secret : "",
        AUTH_URL: "http://127.0.0.1:3988",
        AUTH_TRUST_HOST: "true",
        SMTP_HOST: "",
        CHUTES_API_KEY: "",
      },
      stdio: "ignore",
    },
  );
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null)
      throw Error("Local Next server exited before readiness.");
    try {
      if ((await fetch("http://127.0.0.1:3988/healthz")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Local server did not become ready.");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = once(child, "exit");
  child.kill("SIGTERM");
  await done;
  child = undefined;
}
async function post(mail, signed = true) {
  const raw = JSON.stringify(mail),
    t = Math.floor(Date.now() / 1000);
  return fetch("http://127.0.0.1:3988/api/intake/inbound", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      ...(signed
        ? {
            "x-wissen-signature": `t=${t},v1=${createHmac("sha256", secret)
              .update(t + "." + raw)
              .digest("hex")}`,
          }
        : {}),
    },
    signal: AbortSignal.timeout(10000),
  });
}
try {
  // Reuse an existing book and token. This check never creates or publishes books/pages.
  const credentials = (
    await source.query(
      "SELECT s.api_id,s.api_secret_enc FROM tenant_secrets s JOIN tenants t ON t.id=s.tenant_id WHERE t.slug='demo'",
    )
  ).rows[0];
  assert.ok(credentials, "Existing demo API credentials required.");
  const raw = Buffer.from(credentials.api_secret_enc.slice(3), "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.INTAKE_KMS_KEY, "hex"),
    raw.subarray(0, 12),
  );
  cipher.setAAD(Buffer.from("demo"));
  cipher.setAuthTag(raw.subarray(-16));
  const token = Buffer.concat([
    cipher.update(raw.subarray(12, -16)),
    cipher.final(),
  ]).toString();
  const demoBaseUrl = (
    process.env.DEMO_BASE_URL || "https://demo.wissen.app.mintapis.com"
  ).replace(/\/$/, "");
  const response = await fetch(demoBaseUrl + "/api/books?count=1", {
    headers: { Authorization: `Token ${credentials.api_id}:${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200, "Demo book lookup failed.");
  const book = (await response.json()).data[0];
  assert.ok(book, "Existing demo book required.");
  const email = `production-check-${randomUUID()}@example.invalid`;
  user = (
    await target.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
      email,
    ])
  ).rows[0].id;
  team = (
    await target.query(
      "INSERT INTO teams(name,owner_user_id) VALUES('Inbound production check',$1) RETURNING id",
      [user],
    )
  ).rows[0].id;
  await target.query(
    "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, user],
  );
  await target.query(
    "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',now()+interval '1 day')",
    [team, `check-${team}`],
  );
  tenant = (
    await target.query(
      "INSERT INTO tenants(team_id,slug,status,desired_state) VALUES($1,'demo','running','running') RETURNING id",
      [team],
    )
  ).rows[0].id;
  await target.query(
    "INSERT INTO tenant_secrets(tenant_id,api_id,api_secret_enc) VALUES($1,$2,$3)",
    [tenant, credentials.api_id, credentials.api_secret_enc],
  );
  await target.query(
    "INSERT INTO intake_items(team_id,tenant_id,filename,mime,status,target_book_id,target_book_name) VALUES($1,$2,'test-destination','application/octet-stream','rejected',$3,$4)",
    [team, tenant, book.id, book.name],
  );
  const mail = {
    message_id: randomUUID(),
    to: ["demo@intake.bookhost.co"],
    from: { address: email, name: "Production check" },
    subject: "Review regression",
    text: "Human reviewers verify the source before publication. ".repeat(10),
    attachments: [],
    received_at: new Date().toISOString(),
  };
  await start(true);
  assert.equal((await post(mail, false)).status, 401);
  const accepted = await post(mail);
  assert.equal(
    accepted.status,
    202,
    "Signed production request must be accepted.",
  );
  const body = await accepted.json();
  assert.equal(body.item_ids.length, 1);
  assert.equal(
    (
      await target.query(
        "SELECT count(*)::int AS n FROM intake_messages WHERE message_id=$1",
        [mail.message_id],
      )
    ).rows[0].n,
    1,
  );
  const replay = await post(mail);
  assert.equal(replay.status, 202);
  assert.deepEqual(await replay.json(), body);
  await stop();
  await start(false);
  const missing = await post(mail);
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get("retry-after"), "30");
  console.log(
    "Production build on 127.0.0.1:3988: signed 202; unsigned 401; replay 202; missing secret 503 with Retry-After: 30.",
  );
} finally {
  await stop();
  if (team) await target.query("DELETE FROM events WHERE team_id=$1", [team]);
  if (team)
    await target.query("DELETE FROM intake_items WHERE team_id=$1", [team]);
  if (tenant) await target.query("DELETE FROM tenants WHERE id=$1", [tenant]);
  if (team) {
    await target.query("DELETE FROM memberships WHERE team_id=$1", [team]);
    await target.query("DELETE FROM subscriptions WHERE team_id=$1", [team]);
    await target.query("DELETE FROM rate_limits WHERE key=$1", [
      `intake-team:${team}`,
    ]);
    await target.query("DELETE FROM teams WHERE id=$1", [team]);
  }
  if (user) await target.query("DELETE FROM users WHERE id=$1", [user]);
  await Promise.all([source.end(), target.end()]);
  console.log("Production check fixtures removed; local server stopped.");
}
