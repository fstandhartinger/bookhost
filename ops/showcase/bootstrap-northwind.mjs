#!/usr/bin/env node
// Operator-only bootstrap for the one retained fictional showcase workspace.
import { randomBytes } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import argon2 from "argon2";
import pg from "pg";
import { databaseConfig } from "../../scripts/db-config.mjs";

const slug = "showcase-northwind";
const credentialsPath =
  "/home/flori/ventures2/bookstack/work/showcase-northwind-users.env";
const users = [
  { email: "mira.chen@northwind.example", name: "Mira Chen", role: "owner" },
  { email: "sam.patel@northwind.example", name: "Sam Patel", role: "member" },
];
const passwords = users.map(() => randomBytes(24).toString("base64url"));
const hashes = await Promise.all(
  passwords.map((password) =>
    argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    }),
  ),
);
const pool = new pg.Pool(databaseConfig());
let client;
let credentialsHandle;
let createdCredentials = false;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    slug,
  ]);
  const conflicts = await client.query(
    `SELECT slug AS value FROM tenants WHERE slug=$1
     UNION ALL SELECT lower(email) AS value FROM users WHERE lower(email)=ANY($2::text[])`,
    [slug, users.map((user) => user.email)],
  );
  if (conflicts.rowCount)
    throw new Error("Showcase slug or synthetic user email already exists");
  const target = await client.query(
    "SELECT current_database() AS database, current_user AS role",
  );
  console.log(
    `Exact showcase target: database=${target.rows[0].database} team=Northwind Studio slug=${slug} users=${users.map((user) => user.email).join(",")} credentials=${credentialsPath}`,
  );

  credentialsHandle = await open(credentialsPath, "wx", 0o600);
  createdCredentials = true;
  const credentialText = users
    .map(
      (user, index) =>
        `${user.role.toUpperCase()}_EMAIL=${user.email}\n${user.role.toUpperCase()}_PASSWORD=${passwords[index]}`,
    )
    .join("\n");
  await credentialsHandle.writeFile(`${credentialText}\n`, "utf8");
  await credentialsHandle.sync();
  await credentialsHandle.close();
  credentialsHandle = undefined;

  const owner = (
    await client.query(
      `INSERT INTO users(email,name,password_hash,password_set_at,email_verified_at)
       VALUES($1,$2,$3,now(),now()) RETURNING id`,
      [users[0].email, users[0].name, hashes[0]],
    )
  ).rows[0];
  const member = (
    await client.query(
      `INSERT INTO users(email,name,password_hash,password_set_at,email_verified_at)
       VALUES($1,$2,$3,now(),now()) RETURNING id`,
      [users[1].email, users[1].name, hashes[1]],
    )
  ).rows[0];
  const team = (
    await client.query(
      `INSERT INTO teams(name,owner_user_id,is_showcase)
       VALUES('Northwind Studio',$1,true) RETURNING id`,
      [owner.id],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO memberships(user_id,team_id,role)
     VALUES($1,$3,'owner'),($2,$3,'member')`,
    [owner.id, member.id, team.id],
  );
  await client.query(
    `INSERT INTO subscriptions(team_id,stripe_subscription_id,status,price_id,
       current_period_end,has_payment_method,stripe_created_at)
     VALUES($1,'internal:showcase-northwind','active','internal-showcase',
       now()+interval '10 years',false,now())`,
    [team.id],
  );
  await client.query(
    `INSERT INTO tenants(team_id,slug,admin_email,status,desired_state)
     VALUES($1,$2,$3,'pending','running')`,
    [team.id, slug, users[0].email],
  );
  await client.query("COMMIT");
  createdCredentials = false;
  console.log(
    `Created the single marked Northwind showcase. Dashboard credentials are stored at ${credentialsPath}; values were not printed.`,
  );
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  if (createdCredentials) await unlink(credentialsPath).catch(() => undefined);
  console.error(
    error instanceof Error &&
      error.message === "Showcase slug or synthetic user email already exists"
      ? `Showcase bootstrap stopped without committing: ${error.message}.`
      : "Showcase bootstrap stopped without committing; inspect local operator logs.",
  );
  process.exitCode = 1;
} finally {
  if (credentialsHandle) await credentialsHandle.close().catch(() => undefined);
  client?.release();
  await pool.end();
}
