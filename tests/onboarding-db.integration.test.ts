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
      const sql = await readFile("db/migrations/018_onboarding.sql", "utf8");
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
    } finally {
      await db.query("DELETE FROM events WHERE team_id=$1", [team]);
      await db.query("DELETE FROM teams WHERE id=$1", [team]);
      await db.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
