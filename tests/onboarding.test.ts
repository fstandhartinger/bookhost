import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
import {
  detectSteps,
  onboardingSteps,
  type OnboardingFacts,
} from "@/lib/onboarding";
const empty: OnboardingFacts = {
  password: false,
  workspace: false,
  bookstack: false,
  upload: false,
  publish: false,
  teammate: false,
  payment: false,
};
it("a new team starts with seven incomplete actionable steps", () => {
  expect(detectSteps(empty)).toHaveLength(7);
  expect(detectSteps(empty).every((s) => !s.done && s.href)).toBe(true);
});
it.each(onboardingSteps)("detects $name independently", ({ name }) => {
  expect(
    detectSteps({ ...empty, [name]: true })
      .filter((s) => s.done)
      .map((s) => s.name),
  ).toEqual([name]);
});
it("recognizes a completed team", () => {
  expect(
    detectSteps(
      Object.fromEntries(
        onboardingSteps.map((s) => [s.name, true]),
      ) as unknown as OnboardingFacts,
    ).every((s) => s.done),
  ).toBe(true);
});
