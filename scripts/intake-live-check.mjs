// Operator-only acceptance test. Explicit opt-in; no real logins, cards or email.
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { encode } from "next-auth/jwt";
import { databaseConfig } from "./db-config.mjs";
if (process.env.INTAKE_LIVE_CHECK !== "demo")
  throw new Error(
    "Set INTAKE_LIVE_CHECK=demo to run the real demo acceptance test.",
  );
const pool = new pg.Pool(databaseConfig());
const base = "http://127.0.0.1:3995";
const userIds = [];
let teamId;
let demoId;
function decrypt(value, slug) {
  const raw = Buffer.from(value.slice(3), "base64");
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.INTAKE_KMS_KEY, "hex"),
    raw.subarray(0, 12),
  );
  d.setAAD(Buffer.from(slug));
  d.setAuthTag(raw.subarray(-16));
  return Buffer.concat([d.update(raw.subarray(12, -16)), d.final()]).toString();
}
async function identity(label) {
  const user = (
    await pool.query(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      [
        `intake-${label}-${Date.now()}@example.invalid`,
        `Intake acceptance ${label}`,
      ],
    )
  ).rows[0];
  userIds.push(user.id);
  return {
    id: user.id,
    cookie:
      "authjs.session-token=" +
      (await encode({
        token: {
          sub: user.id,
          email: `intake-${label}@example.invalid`,
          name: "Intake acceptance",
        },
        secret: process.env.AUTH_SECRET,
        salt: "authjs.session-token",
        maxAge: 600,
      })),
  };
}
async function api(identity, path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { Cookie: identity.cookie, Origin: base, ...options.headers },
  });
  const body = await response.json();
  return { status: response.status, body };
}
try {
  const owner = await identity("owner");
  const member = await identity("member");
  const outsider = await identity("outsider");
  teamId = (
    await pool.query(
      "INSERT INTO teams(name,owner_user_id) VALUES($1,$2) RETURNING id",
      ["Intake acceptance test", owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$3,'owner'),($2,$3,'member')",
    [owner.id, member.id, teamId],
  );
  const assigned = await pool.query(
    "UPDATE tenants SET team_id=$1 WHERE slug='demo' AND team_id IS NULL AND status='running' RETURNING id",
    [teamId],
  );
  assert.equal(assigned.rowCount, 1, "Demo must be running and unassigned");
  demoId = assigned.rows[0].id;
  const destinations = await api(owner, `/api/intake?tenant=${demoId}`);
  assert.equal(destinations.status, 200, JSON.stringify(destinations.body));
  assert.ok(destinations.body.books.length, "Demo needs a book");
  const book = destinations.body.books[0];
  assert.equal(
    (await api(outsider, `/api/intake?tenant=${demoId}`)).status,
    404,
  );
  const markdown =
    "# Reviewed document intake: a team checklist\n\nThis demonstration explains how to turn a source document into reviewed BookStack knowledge.\n\n1. Choose the destination book or chapter.\n2. Upload a document and ask for a draft.\n3. Compare the proposed summary with the original source.\n4. Check names, dates and claims. Resolve missing details with the document owner.\n5. A team owner or admin approves publication.\n\nAI suggestions can contain errors. A human reviewer remains responsible for the final page. This example does not define a company policy.\n\nOpen question: who owns the review schedule for your team? Set an owner and review date before using this as an operating procedure.\n";
  const form = new FormData();
  form.set("tenant_id", demoId);
  form.set("book_id", String(book.id));
  form.set(
    "file",
    new Blob([markdown], { type: "text/markdown" }),
    "reviewed-intake-checklist.md",
  );
  const uploaded = await api(owner, "/api/intake", {
    method: "POST",
    body: form,
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const id = uploaded.body.id;
  const draft = await api(owner, `/api/intake/${id}`);
  assert.equal(draft.body.status, "draft", JSON.stringify(draft.body));
  assert.ok(draft.body.draft_html.includes("Things a reviewer should check"));
  assert.equal((await api(outsider, `/api/intake/${id}`)).status, 404);
  const publish = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "publish",
      title: "Reviewed document intake: a team checklist",
      html: draft.body.draft_html,
    }),
  };
  assert.equal((await api(member, `/api/intake/${id}`, publish)).status, 403);
  assert.equal((await api(outsider, `/api/intake/${id}`, publish)).status, 404);
  const published = await api(owner, `/api/intake/${id}`, publish);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal((await api(owner, `/api/intake/${id}`, publish)).status, 409);
  const row = (
    await pool.query(
      "SELECT status,bookstack_page_id FROM intake_items WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(row.status, "published");
  const secret = (
    await pool.query(
      "SELECT api_id,api_secret_enc FROM tenant_secrets WHERE tenant_id=$1",
      [demoId],
    )
  ).rows[0];
  const remote = await fetch(
    `https://demo.wissen.app.mintapis.com/api/pages/${row.bookstack_page_id}`,
    {
      headers: {
        Authorization: `Token ${secret.api_id}:${decrypt(secret.api_secret_enc, "demo")}`,
      },
    },
  );
  assert.equal(remote.status, 200);
  const page = await remote.json();
  assert.equal(page.name, "Reviewed document intake: a team checklist");
  assert.equal(page.draft, false);
  assert.ok(page.html.includes("Summary"));
  const result = {
    url: published.body.url,
    page_id: page.id,
    page_title: page.name,
    book: book.name,
    tests: [
      "real Markdown upload",
      "real Chutes draft",
      "member publish 403",
      "foreign team GET/POST 404",
      "owner publish 200",
      "second publish 409",
      "BookStack API confirms normal page",
    ],
    timestamp: new Date().toISOString(),
  };
  await writeFile(
    "/home/flori/ventures2/bookstack/work/intake-live-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (demoId)
    await pool.query(
      "UPDATE tenants SET team_id=NULL WHERE id=$1 AND team_id=$2",
      [demoId, teamId],
    );
  if (teamId) {
    await pool.query("DELETE FROM intake_items WHERE team_id=$1", [teamId]);
    await pool.query("DELETE FROM memberships WHERE team_id=$1", [teamId]);
    await pool.query("DELETE FROM teams WHERE id=$1", [teamId]);
    await pool.query("DELETE FROM rate_limits WHERE key=$1", [
      "intake-team:" + teamId,
    ]);
  }
  for (const id of userIds) {
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    await pool.query("DELETE FROM rate_limits WHERE key=$1", [
      "intake-user:" + id,
    ]);
  }
  await pool.end();
  console.log(
    "Acceptance test identities, items and demo assignment cleaned up.",
  );
}
