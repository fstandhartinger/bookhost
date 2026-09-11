import { expect, it, vi } from "vitest";

// vi.mock is hoisted above ordinary consts, so the spy has to be hoisted too.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query } }));
vi.mock("@/lib/intake/access", () => ({ clientFor: vi.fn(), IntakeError: Error }));

import { recoverIntake } from "@/lib/intake/jobs";

query.mockResolvedValue({ rows: [], rowCount: 0 });

it("deletes persisted error diagnostics after the fourteen days we promise", async () => {
  // The privacy notice says application logs are kept 14 days. The error table
  // is an application log, and it had no limit at all when it was introduced.
  query.mockClear();
  await recoverIntake();
  const statements = query.mock.calls.map((call) => String(call[0]));
  const prune = statements.find((sql) => sql.includes("DELETE FROM error_reports"));
  expect(prune).toBeDefined();
  expect(prune).toContain("ts<now()-interval '14 days'");
});

it("keeps the intake retention the privacy notice states separately", async () => {
  query.mockClear();
  await recoverIntake();
  const statements = query.mock.calls.map((call) => String(call[0]));
  expect(
    statements.some((sql) => sql.includes("DELETE FROM intake_items") && sql.includes("30 days")),
  ).toBe(true);
});
