import { describe, expect, it } from "vitest";
import { classifyTeam, classifyVisit } from "../scripts/cohorts.mjs";

const options = { now: new Date("2026-09-15T12:00:00Z"), adminEmails: ["admin@bookhost.co"], ownDomains: ["productivity-boost.com", "ndhartinger.de", "mintapis.com", "bookhost.co"] };
const base = { createdAt: "2026-09-08T10:00:00Z", firstPublishedIntakeAt: "2026-09-08T12:00:00Z", laterDayUsageAt: "2026-09-09T00:01:00Z" };

describe("cohort semantics", () => {
  it("owner and QA UTM are internal regardless of activity", () => {
    expect(classifyTeam({ ...base, ownerEmail: "customer@example.com", utm_source: "owner" }, options).cohort).toBe("internal");
    expect(classifyTeam({ ...base, ownerEmail: "customer@example.com", utm_source: "qa" }, options).cohort).toBe("internal");
  });
  it("admin email is internal", () => expect(classifyTeam({ ...base, ownerEmail: "ADMIN@BOOKHOST.CO" }, options).cohort).toBe("internal"));
  it("unknown identity is unclear despite intake and day 2", () => expect(classifyTeam({ ...base }, options)).toEqual({ cohort: "unclear", reason: "unknown identity" }));
  it("requires published intake and later UTC-day usage", () => {
    expect(classifyTeam({ ...base, ownerEmail: "buyer@example.com", firstPublishedIntakeAt: undefined }, options).cohort).toBe("unclear");
    expect(classifyTeam({ ...base, ownerEmail: "buyer@example.com", laterDayUsageAt: "2026-09-08T23:59:59Z" }, options).cohort).toBe("unclear");
    expect(classifyTeam({ ...base, ownerEmail: "buyer@example.com" }, options).cohort).toBe("external");
    expect(classifyTeam({ ...base, ownerEmail: "buyer@example.com", firstPublishedIntakeAt: undefined, laterDayUsageAt: undefined }).cohort).toBe("unclear");
  });
  it("uses UTC calendar boundaries", () => {
    expect(classifyTeam({ ...base, ownerEmail: "buyer@example.com", createdAt: "2026-09-08T23:30:00Z", laterDayUsageAt: "2026-09-09T00:10:00Z" }, options).cohort).toBe("external");
    expect(classifyTeam({ ...base, ownerEmail: "buyer@example.com", createdAt: "2026-09-09T00:10:00Z", laterDayUsageAt: "2026-09-09T23:50:00Z" }, options).cohort).toBe("unclear");
  });
  it("draft and failed intake do not qualify", () => expect(classifyTeam({ ...base, ownerEmail: "buyer@example.com", firstPublishedIntakeAt: undefined }, options).reason).toBe("no published intake"));
  it.each([[{ referrer_host: "demo.bookhost.co" }, "internal"], [{ utm_source: "Reddit" }, "unclear (utm: reddit)"], [{}, "unclear (no provenance)"]])("classifies visit %j", (visit, expected) => expect(classifyVisit(visit)).toBe(expected));
  it("visits are never external", () => { for (const visit of [{ utm_source: "newsletter" }, { utm_source: "reddit", utm_medium: "social" }, {}]) expect(classifyVisit(visit)).not.toBe("external"); });
});
