import { expect, it } from "vitest";
import { db } from "@/lib/db";
it.skipIf(process.env.INTAKE_DB_TEST !== "1")(
  "records funnel events exactly once via the database triggers",
  async () => {
    const userIds: string[] = [];
    const teamIds: string[] = [];
    let tenant: string | undefined;
    let optOutTenant: string | undefined;
    let draftItem: string | undefined;
    let failedItem: string | undefined;
    let publishedItem: string | undefined;
    try {
      for (const email of [
        `analytics-db-${crypto.randomUUID()}@example.invalid`,
        `analytics-db-${crypto.randomUUID()}@example.invalid`,
      ])
        userIds.push(
          (
            await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
              email,
            ])
          ).rows[0].id,
        );
      teamIds.push(
        (
          await db.query(
            "INSERT INTO teams(name,owner_user_id,utm_source) VALUES('Analytics trigger integration',$1,'qa-funnel') RETURNING id",
            [userIds[0]],
          )
        ).rows[0].id,
      );
      teamIds.push(
        (
          await db.query(
            "INSERT INTO teams(name,owner_user_id,analytics_opt_out) VALUES('Analytics opt-out integration',$1,true) RETURNING id",
            [userIds[1]],
          )
        ).rows[0].id,
      );
      tenant = (
        await db.query(
          "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$2||'.wissen.app.mintapis.com','failed','suspended') RETURNING id",
          [teamIds[0], `analytics-${crypto.randomUUID()}`],
        )
      ).rows[0].id;
      optOutTenant = (
        await db.query(
          "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$2||'.wissen.app.mintapis.com','failed','suspended') RETURNING id",
          [teamIds[1], `analytics-optout-${crypto.randomUUID()}`],
        )
      ).rows[0].id;
      const countEvents = async (teamId: string, name: string) =>
        (
          await db.query(
            "SELECT count(*)::int AS n FROM events WHERE team_id=$1 AND name=$2",
            [teamId, name],
          )
        ).rows[0].n;
      const countFunnelEvents = async (teamId: string) =>
        (
          await db.query(
            "SELECT count(*)::int AS n FROM events WHERE team_id=$1 AND name IN ('workspace_created','intake_draft','intake_published')",
            [teamId],
          )
        ).rows[0].n;
      expect(await countEvents(teamIds[0], "workspace_created")).toBe(1);
      expect(
        (
          await db.query(
            "SELECT utm_source FROM events WHERE team_id=$1 AND name='workspace_created'",
            [teamIds[0]],
          )
        ).rows[0].utm_source,
      ).toBe("qa-funnel");
      expect(await countEvents(teamIds[1], "workspace_created")).toBe(0);
      expect(await countFunnelEvents(teamIds[1])).toBe(0);
      const insertItem = async (status: string) =>
        (
          await db.query(
            "INSERT INTO intake_items(team_id,tenant_id,filename,mime,target_book_id,status) VALUES($1,$2,$3,'text/plain',1,$4) RETURNING id",
            [teamIds[0], tenant, `analytics-${status}.md`, status],
          )
        ).rows[0].id;
      draftItem = await insertItem("drafting");
      failedItem = await insertItem("drafting");
      publishedItem = await insertItem("approved");
      await db.query("UPDATE intake_items SET status='draft' WHERE id=$1", [
        draftItem,
      ]);
      expect(await countEvents(teamIds[0], "intake_draft")).toBe(1);
      await db.query("UPDATE intake_items SET status='failed' WHERE id=$1", [
        failedItem,
      ]);
      expect(await countFunnelEvents(teamIds[0])).toBe(2);
      await db.query("UPDATE intake_items SET status='published' WHERE id=$1", [
        publishedItem,
      ]);
      expect(await countEvents(teamIds[0], "intake_published")).toBe(1);
      await db.query("UPDATE intake_items SET status='published' WHERE id=$1", [
        publishedItem,
      ]);
      expect(await countEvents(teamIds[0], "intake_published")).toBe(1);
      expect(await countFunnelEvents(teamIds[0])).toBe(3);
    } finally {
      for (const teamId of teamIds)
        await db.query("DELETE FROM events WHERE team_id=$1", [teamId]);
      for (const teamId of teamIds)
        await db.query("DELETE FROM intake_items WHERE team_id=$1", [teamId]);
      if (tenant) await db.query("DELETE FROM tenants WHERE id=$1", [tenant]);
      if (optOutTenant)
        await db.query("DELETE FROM tenants WHERE id=$1", [optOutTenant]);
      for (const teamId of teamIds)
        await db.query("DELETE FROM teams WHERE id=$1", [teamId]);
      for (const userId of userIds)
        await db.query("DELETE FROM users WHERE id=$1", [userId]);
    }
  },
  20000,
);
