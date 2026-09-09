import { describe, expect, it } from "vitest";

import {
  classifyAcquisition,
  summarizeTeamCohorts,
} from "../scripts/cohorts.mjs";

describe("cohort semantics", () => {
  it.each([
    [{ utm_source: "test", referrer_host: null }, "internal"],
    [{ utm_source: "orchestrator-smoke", referrer_host: null }, "internal"],
    [{ utm_source: "qa", referrer_host: null }, "internal"],
    [{ utm_source: "e2e", referrer_host: null }, "internal"],
    [{ utm_source: "newsletter", referrer_host: "demo.wissen.app.mintapis.com" }, "internal"],
    [{ utm_source: null, referrer_host: null }, "unclear"],
    [{ utm_source: "", referrer_host: null }, "unclear"],
    [{ utm_source: "newsletter", referrer_host: null }, "external"],
  ] as const)("classifies %j as %s", (attribution, expected) => {
    expect(classifyAcquisition(attribution)).toBe(expected);
  });

  it("keeps isolated teams separate and counts only published intake", () => {
    const teams = [
      {
        id: "internal-team",
        created_at: "2026-09-01T10:00:00.000Z",
        utm_source: "qa",
        referrer_host: null,
        events: [
          { name: "intake_published", ts: "2026-09-01T12:00:00.000Z" },
          { name: "bookstack_opened", ts: "2026-09-02T00:01:00.000Z" },
        ],
      },
      {
        id: "unclear-draft-only",
        created_at: "2026-09-01T23:59:00.000Z",
        utm_source: null,
        referrer_host: null,
        events: [
          { name: "intake_draft", ts: "2026-09-02T00:00:00.000Z" },
        ],
      },
      {
        id: "external-same-utc-day",
        created_at: "2026-09-01T00:01:00.000Z",
        utm_source: "newsletter",
        referrer_host: null,
        events: [
          { name: "intake_published", ts: "2026-09-01T23:59:59.000Z" },
        ],
      },
    ];

    expect(summarizeTeamCohorts(teams)).toEqual([
      { cohort: "internal", teams: 1, teams_with_published_intake: 1, teams_active_day2: 1 },
      { cohort: "unclear", teams: 1, teams_with_published_intake: 0, teams_active_day2: 1 },
      { cohort: "external", teams: 1, teams_with_published_intake: 1, teams_active_day2: 0 },
    ]);
  });

  it("uses UTC calendar dates rather than elapsed 24-hour windows", () => {
    const teams = [{
      id: "midnight-boundary",
      created_at: "2026-09-01T23:59:59.900Z",
      utm_source: "partner",
      referrer_host: null,
      events: [{ name: "bookstack_opened", ts: "2026-09-02T00:00:00.100Z" }],
    }];

    expect(summarizeTeamCohorts(teams)[2]?.teams_active_day2).toBe(1);
  });
});
