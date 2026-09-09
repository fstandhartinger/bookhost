import { db } from "@/lib/db";

export const onboardingSteps = [
  { name: "password", label: "Set a password", href: "#password-setup" },
  { name: "workspace", label: "Create your workspace", href: "#workspace" },
  {
    name: "bookstack",
    label: "Open BookStack and sign in",
    href: "#workspace",
  },
  { name: "upload", label: "Upload your first document", href: "/app/intake" },
  { name: "publish", label: "Publish your first page", href: "/app/intake" },
  { name: "teammate", label: "Invite a teammate", href: "#team-members" },
  { name: "payment", label: "Add a payment method", href: "/app/billing" },
] as const;
export interface OnboardingFacts {
  password: boolean;
  workspace: boolean;
  bookstack: boolean;
  upload: boolean;
  publish: boolean;
  teammate: boolean;
  payment: boolean;
}
export function detectSteps(facts: OnboardingFacts) {
  return onboardingSteps.map((step) => ({ ...step, done: !!facts[step.name] }));
}
export async function onboarding(teamId: string) {
  const { rows } = await db.query<{ step: string }>(
    "SELECT step FROM team_onboarding WHERE team_id=$1",
    [teamId],
  );
  const done = new Set(rows.map((row) => row.step));
  return onboardingSteps.map((step) => ({
    ...step,
    done: done.has(step.name),
  }));
}
