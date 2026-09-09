import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { quota } from "@/lib/intake/quota";
import { recoverIntake } from "@/lib/intake/jobs";
it.skipIf(process.env.INTAKE_DB_TEST !== "1")(
  "atomically reserves quota and recovers only stalled jobs against Postgres",
  async () => {
    const user = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `intake-db-${crypto.randomUUID()}@example.invalid`,
      ])
    ).rows[0].id;
    let team: string | undefined;
    let tenant: string | undefined;
    try {
      team = (
        await db.query(
          "INSERT INTO teams(name,owner_user_id) VALUES('Intake SQL integration',$1) RETURNING id",
          [user],
        )
      ).rows[0].id;
      tenant = (
        await db.query(
          "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$2||'.wissen.app.mintapis.com','failed','suspended') RETURNING id",
          [team, `sql-${crypto.randomUUID()}`],
        )
      ).rows[0].id;
      await quota(team!, "trialing");
      await db.query("UPDATE intake_quota SET draft_limit=1 WHERE team_id=$1", [
        team,
      ]);
      const reservations = await Promise.allSettled([
        quota(team!, "trialing", true),
        quota(team!, "trialing", true),
        quota(team!, "trialing", true),
      ]);
      expect(reservations.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(reservations.filter((r) => r.status === "rejected")).toHaveLength(
        2,
      );
      expect((await quota(team!, "trialing")).remaining).toBe(0);
      for (const status of ["queued", "drafting", "approved", "draft"])
        await db.query(
          "INSERT INTO intake_items(team_id,tenant_id,filename,mime,target_book_id,status,updated_at) VALUES($1,$2,$3,'text/plain',1,$3,now()-interval '11 minutes')",
          [team, tenant, status],
        );
      await db.query(
        "INSERT INTO intake_items(team_id,tenant_id,filename,mime,target_book_id,status,created_at) VALUES($1,$2,'expired','text/plain',1,'rejected',now()-interval '31 days')",
        [team, tenant],
      );
      await recoverIntake();
      const rows = (
        await db.query(
          "SELECT filename,status,error FROM intake_items WHERE team_id=$1",
          [team],
        )
      ).rows;
      expect(rows).toHaveLength(4);
      expect(rows.filter((row) => row.status === "failed")).toHaveLength(3);
      expect(rows.find((row) => row.filename === "draft").status).toBe("draft");
      expect(
        rows
          .filter((row) => row.status === "failed")
          .every((row) => row.error.includes("interrupted")),
      ).toBe(true);
    } finally {
      if (team)
        await db.query("DELETE FROM intake_items WHERE team_id=$1", [team]);
      if (tenant) await db.query("DELETE FROM tenants WHERE id=$1", [tenant]);
      if (team) await db.query("DELETE FROM teams WHERE id=$1", [team]);
      await db.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
  20000,
);
