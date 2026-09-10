import { afterEach, describe, expect, it } from "vitest";
import { acquireSlot } from "@/lib/intake/slots";

afterEach(() => {
  delete process.env.INTAKE_MAX_CONCURRENT;
  delete process.env.INTAKE_MAX_PER_TEAM;
});

describe("intake admission slots", () => {
  it("allows one slot each for two different teams", () => {
    const teamA = acquireSlot("team-a");
    const teamB = acquireSlot("team-b");

    expect(teamA).not.toBeNull();
    expect(teamB).not.toBeNull();
    teamA?.();
    teamB?.();
  });

  it("does not let Team A occupy both slots while Team B waits", () => {
    const first = acquireSlot("team-a");
    const second = acquireSlot("team-a");
    const teamB = acquireSlot("team-b");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(teamB).not.toBeNull();
    first?.();
    second?.();
    teamB?.();
  });

  it("rejects a second slot for the same team", () => {
    const first = acquireSlot("team-a");
    const second = acquireSlot("team-a");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    first?.();
    second?.();
  });

  it("still enforces the global limit", () => {
    process.env.INTAKE_MAX_CONCURRENT = "2";
    process.env.INTAKE_MAX_PER_TEAM = "2";
    const first = acquireSlot("team-a");
    const second = acquireSlot("team-b");
    const third = acquireSlot("team-c");

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull();
    first?.();
    second?.();
  });

  it("does not change the count when a release is called twice", () => {
    const first = acquireSlot("team-a");
    first?.();
    first?.();

    const second = acquireSlot("team-a");
    expect(second).not.toBeNull();
    second?.();
  });
});
