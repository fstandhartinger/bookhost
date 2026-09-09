import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { databaseConfig } from "./db-config.mjs";
if (process.env.INBOUND_LIVE_CHECK !== "demo")
  throw Error("Set INBOUND_LIVE_CHECK=demo");
const pool = new pg.Pool(databaseConfig());
const dir = await mkdtemp(join(tmpdir(), "wissen-email-check-"));
let user, team, tenant;
async function post(body, signed = true) {
  const raw = JSON.stringify(body),
    t = Math.floor(Date.now() / 1000);
  const headers = ["Content-Type: application/json"];
  if (signed)
    headers.push(
      `X-BookHost-Signature: t=${t},v1=${createHmac(
        "sha256",
        process.env.INBOUND_WEBHOOK_SECRET,
      )
        .update(t + "." + raw)
        .digest("hex")}`,
    );
  await writeFile(join(dir, "headers"), headers.join("\n") + "\n", {
    mode: 0o600,
  });
  await writeFile(join(dir, "body"), raw, { mode: 0o600 });
  const output = execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "60",
      "-w",
      "\n%{http_code}",
      "-H",
      "@" + join(dir, "headers"),
      "--data-binary",
      "@" + join(dir, "body"),
      "http://127.0.0.1:3989/api/intake/inbound",
    ],
    { encoding: "utf8" },
  );
  const parts = output.trim().split("\n");
  return { status: Number(parts.pop()), body: JSON.parse(parts.join("\n")) };
}
try {
  const email = `inbound-live-${randomUUID()}@example.invalid`;
  user = (
    await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
      email,
    ])
  ).rows[0].id;
  team = (
    await pool.query(
      "INSERT INTO teams(name,owner_user_id) VALUES('Email live acceptance',$1) RETURNING id",
      [user],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, user],
  );
  await pool.query(
    "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',now()+interval '14 days')",
    [team, "inbound-live-" + team],
  );
  const assigned = await pool.query(
    "UPDATE tenants SET team_id=$1 WHERE slug='demo' AND team_id IS NULL AND status='running' AND desired_state='running' RETURNING id",
    [team],
  );
  assert.equal(assigned.rowCount, 1, "Demo must be running and unassigned");
  tenant = assigned.rows[0].id;
  // Reuse a demo destination without creating a BookStack book during acceptance.
  const demoBook = (
    await pool.query(
      "SELECT target_book_id,target_book_name FROM intake_items WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
      [tenant],
    )
  ).rows[0];
  if (demoBook)
    await pool.query(
      "INSERT INTO intake_items(team_id,tenant_id,filename,mime,status,target_book_id,target_book_name) VALUES($1,$2,'acceptance-destination','text/plain','rejected',$3,$4)",
      [team, tenant, demoBook.target_book_id, demoBook.target_book_name],
    );
  const content = Buffer.from(
    "# Review checklist\n\n" +
      "Before publishing a team document, a human reviewer checks the facts, source and intended audience. The owner confirms responsibility and a review date. Nothing is automatically published.\n".repeat(
        4,
      ),
  );
  const mail = {
    message_id: randomUUID(),
    to: ["demo@intake.bookhost.co"],
    from: { address: email, name: "Acceptance" },
    subject: "E-mail review checklist",
    text: "Please review the attached checklist.",
    attachments: [
      {
        filename: "review.md",
        content_type: "text/markdown",
        size: content.length,
        content_base64: content.toString("base64"),
      },
    ],
    received_at: new Date().toISOString(),
  };
  assert.equal((await post(mail, false)).status, 401);
  const foreign = await post({
    ...mail,
    message_id: randomUUID(),
    from: { address: "foreign@example.invalid" },
  });
  assert.equal(foreign.status, 403);
  const accepted = await post(mail);
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  const replay = await post(mail);
  assert.deepEqual(replay, accepted);
  let item;
  for (let n = 0; n < 150; n++) {
    item = (
      await pool.query(
        "SELECT id,status,source,draft_title,draft_html FROM intake_items WHERE id=$1",
        [accepted.body.item_ids[0]],
      )
    ).rows[0];
    if (!["queued", "drafting"].includes(item.status)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(item.status, "draft");
  assert.equal(item.source, "email");
  assert.equal(item.draft_title, mail.subject);
  assert.ok(item.draft_html.length > 50);
  const evidence = {
    timestamp: new Date().toISOString(),
    tests: [
      "signed curl 202",
      "unsigned curl 401",
      "foreign sender 403",
      "replay same IDs",
      "real Chutes pipeline draft",
      "source email",
      "subject retained",
      "test records cleaned in finally",
    ],
    item_id: item.id,
    status: item.status,
    source: item.source,
  };
  await writeFile(
    "/home/flori/ventures2/bookstack/work/email-live-result.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} finally {
  if (team) {
    await pool.query("DELETE FROM events WHERE team_id=$1", [team]);
    await pool.query("DELETE FROM intake_items WHERE team_id=$1", [team]);
  }
  if (tenant)
    await pool.query(
      "UPDATE tenants SET team_id=NULL WHERE id=$1 AND team_id=$2",
      [tenant, team],
    );
  if (team) {
    await pool.query("DELETE FROM memberships WHERE team_id=$1", [team]);
    await pool.query("DELETE FROM subscriptions WHERE team_id=$1", [team]);
    await pool.query("DELETE FROM rate_limits WHERE key=$1", [
      "intake-team:" + team,
    ]);
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
  if (user) await pool.query("DELETE FROM users WHERE id=$1", [user]);
  await rm(dir, { recursive: true, force: true });
  await pool.end();
  console.log("Acceptance data cleaned.");
}
