import { beforeEach, expect, it, vi } from "vitest";

let stored: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "wissen-team" && stored ? { value: stored } : undefined,
  }),
}));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));

import { activeTeamId, MEMBERSHIP_ORDER } from "@/lib/active-team";

// Newest first; the two older rows share a timestamp, which is what migration
// 017 left behind when it backfilled memberships.created_at with now().
const rows = [
  { team_id: "team-new" },
  { team_id: "team-a" },
  { team_id: "team-b" },
];
const database = { query: vi.fn() };

beforeEach(() => {
  stored = undefined;
  database.query.mockReset().mockResolvedValue({ rows, rowCount: rows.length });
});

it("orders memberships so equal timestamps cannot flip the answer", async () => {
  await activeTeamId("user", undefined, database);
  const sql = String(database.query.mock.calls[0][0]);
  expect(sql).toContain(MEMBERSHIP_ORDER);
  expect(MEMBERSHIP_ORDER).toContain("m.team_id");
});

it("prefers an explicit team over the stored one", async () => {
  stored = "team-a";
  expect(await activeTeamId("user", "team-b", database)).toBe("team-b");
});

it("falls back to the stored team when no link names one", async () => {
  stored = "team-a";
  expect(await activeTeamId("user", undefined, database)).toBe("team-a");
});

it("ignores a team the person does not belong to", async () => {
  stored = "someone-elses-team";
  expect(await activeTeamId("user", "another-foreign-team", database)).toBe(
    "team-new",
  );
});

it("returns nothing when the person has no membership", async () => {
  database.query.mockResolvedValue({ rows: [], rowCount: 0 });
  expect(await activeTeamId("user", "team-a", database)).toBeNull();
});
