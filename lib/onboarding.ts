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
  const {
    rows: [facts],
  } = await db.query<OnboardingFacts>(
    `
    SELECT (u.password_set_at IS NOT NULL) AS password,
      EXISTS(SELECT 1 FROM tenants WHERE team_id=t.id AND status='running') AS workspace,
      (t.bookstack_opened_at IS NOT NULL) AS bookstack,
      EXISTS(SELECT 1 FROM intake_items WHERE team_id=t.id) AS upload,
      EXISTS(SELECT 1 FROM intake_items WHERE team_id=t.id AND status='published') AS publish,
      (SELECT count(*)>1 FROM memberships WHERE team_id=t.id) AS teammate,
      EXISTS(SELECT 1 FROM effective_subscriptions WHERE team_id=t.id AND has_payment_method) AS payment
    FROM teams t JOIN users u ON u.id=t.owner_user_id WHERE t.id=$1`,
    [teamId],
  );
  const steps = detectSteps(facts);
  await db.query(
    `INSERT INTO events(name,team_id,utm_source,step_name)
    SELECT 'onboarding_step_done',id,utm_source,step FROM teams
    CROSS JOIN unnest($2::text[]) AS step WHERE id=$1 AND NOT analytics_opt_out
    ON CONFLICT DO NOTHING`,
    [teamId, steps.filter((s) => s.done).map((s) => s.name)],
  );
  return steps;
}
