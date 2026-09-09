import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { onboarding } from "@/lib/onboarding";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
it.skipIf(process.env.INTAKE_DB_TEST !== "1")(
  "migration is repeatable; concurrent step detection emits once and respects opt-out",
  async () => {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const sql = await readFile(
        "db/migrations/019_team_onboarding.sql",
        "utf8",
      );
      await c.query(sql);
      await c.query(sql);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    const user = (
      await db.query(
        "INSERT INTO users(email,password_set_at) VALUES($1,now()) RETURNING id",
        [`onboarding-${randomUUID()}@example.invalid`],
      )
    ).rows[0].id;
    const team = (
      await db.query(
        "INSERT INTO teams(name,owner_user_id) VALUES('Onboarding integration',$1) RETURNING id",
        [user],
      )
    ).rows[0].id;
    try {
      // Remove only this disposable fixture's initial capture to exercise concurrent first insertion.
      await db.query("DELETE FROM team_onboarding WHERE team_id=$1", [team]);
      await db.query("DELETE FROM events WHERE team_id=$1", [team]);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          db.query("SELECT detect_team_onboarding($1)", [team]),
        ),
      );
      const results = await Promise.all(
        Array.from({ length: 8 }, () => onboarding(team)),
      );
      expect(results[0].filter((s) => s.done).map((s) => s.name)).toEqual([
        "password",
      ]);
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM events WHERE team_id=$1 AND name='onboarding_step_done'",
            [team],
          )
        ).rows[0].n,
      ).toBe(1);
      await db.query(
        "UPDATE teams SET analytics_opt_out=true,bookstack_opened_at=now() WHERE id=$1",
        [team],
      );
      expect((await onboarding(team))[2].done).toBe(true);
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM events WHERE team_id=$1 AND name='onboarding_step_done'",
            [team],
          )
        ).rows[0].n,
      ).toBe(1);
      const colleague = (
        await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
          `c8-${randomUUID()}@example.invalid`,
        ])
      ).rows[0].id;
      try {
        await db.query(
          "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,'owner'),($3,$2,'member')",
          [user, team, colleague],
        );
        expect(
          (await onboarding(team)).find((s) => s.name === "teammate")?.done,
        ).toBe(true);
      } finally {
        await db.query("DELETE FROM memberships WHERE team_id=$1", [team]);
        await db.query("DELETE FROM users WHERE id=$1", [colleague]);
      }
      expect(
        (await onboarding(team)).find((s) => s.name === "teammate")?.done,
      ).toBe(true);
      const tenant = (
        await db.query(
          "INSERT INTO tenants(team_id,slug,status) VALUES($1,$2,'running') RETURNING id",
          [team, `c8-${randomUUID().slice(0, 8)}`],
        )
      ).rows[0].id;
      await db.query(
        `INSERT INTO intake_items(team_id,tenant_id,filename,mime,extracted_text,target_book_id,status)
        VALUES($1,$2,'fixture.txt','text/plain','Fictional integration fixture',1,'published')`,
        [team, tenant],
      );
      const first = (
        await db.query(
          "SELECT step,done_at FROM team_onboarding WHERE team_id=$1 ORDER BY step",
          [team],
        )
      ).rows;
      expect(
        (await onboarding(team)).filter((s) => s.done).map((s) => s.name),
      ).toEqual([
        "password",
        "workspace",
        "bookstack",
        "upload",
        "publish",
        "teammate",
      ]);
      await db.query("DELETE FROM intake_items WHERE team_id=$1", [team]);
      await db.query("DELETE FROM events WHERE team_id=$1", [team]);
      await db.query("UPDATE teams SET analytics_opt_out=false WHERE id=$1", [
        team,
      ]);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          db.query("SELECT detect_team_onboarding($1)", [team]),
        ),
      );
      expect(
        (await onboarding(team)).filter((s) => s.done).map((s) => s.name),
      ).toEqual([
        "password",
        "workspace",
        "bookstack",
        "upload",
        "publish",
        "teammate",
      ]);
      expect(
        (
          await db.query(
            "SELECT step,done_at FROM team_onboarding WHERE team_id=$1 ORDER BY step",
            [team],
          )
        ).rows,
      ).toEqual(first);
      expect(
        (await db.query("SELECT 1 FROM events WHERE team_id=$1", [team])).rows,
      ).toHaveLength(0);
      await db.query("DELETE FROM tenants WHERE id=$1", [tenant]);
    } finally {
      await db.query("DELETE FROM intake_items WHERE team_id=$1", [team]);
      await db.query("DELETE FROM tenants WHERE team_id=$1", [team]);
      await db.query("DELETE FROM events WHERE team_id=$1", [team]);
      await db.query("DELETE FROM teams WHERE id=$1", [team]);
      await db.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
