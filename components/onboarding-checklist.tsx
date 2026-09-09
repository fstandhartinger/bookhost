import { OnboardingRefresh } from "@/components/onboarding-refresh";
import { onboarding } from "@/lib/onboarding";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
export async function OnboardingChecklist({
  teamId,
  dismissed,
}: {
  teamId: string;
  dismissed: boolean;
}) {
  if (dismissed) return null;
  const steps = await onboarding(teamId);
  const count = steps.filter((s) => s.done).length;
  if (steps.filter((s) => s.name !== "payment").every((s) => s.done))
    return (
      <section className="price-card mt-6" aria-label="Onboarding complete">
        <h2 className="text-xl">Done — you&apos;re all set</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your team is ready to build its knowledge base.
        </p>
        <form
          action={async () => {
            "use server";
            const session = await auth();
            if (!session?.user?.id) return;
            await db.query(
              "UPDATE teams SET onboarding_dismissed_at=now() WHERE id=$1 AND owner_user_id=$2",
              [teamId, session.user.id],
            );
            revalidatePath("/app");
          }}
        >
          <button className="button-secondary mt-4">
            Continue to dashboard
          </button>
        </form>
      </section>
    );
  return (
    <section className="price-card mt-6" aria-labelledby="onboarding-title">
      <OnboardingRefresh
        progress={steps.map((s) => `${s.name}:${s.done}`).join(",")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="onboarding-title" className="text-2xl">
          Get started with BookHost
        </h2>
        <span className="text-sm font-medium">
          {count} of {steps.length} complete
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Start with a password and workspace, then upload a document and approve
        your first page. Aim for your first page in 5 minutes.
      </p>
      <progress
        aria-label="Onboarding progress"
        className="mt-4 h-2 w-full accent-teal-700"
        value={count}
        max={steps.length}
      />
      <ol className="mt-4 divide-y divide-slate-200">
        {steps.map((step, index) => (
          <li
            key={step.name}
            data-step={step.name}
            data-done={step.done}
            className="flex items-center gap-3 py-3"
          >
            <span
              aria-label={step.done ? "Complete" : "Incomplete"}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${step.done ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {step.done ? "✓" : index + 1}
            </span>
            <a
              className={`min-w-0 text-sm underline underline-offset-4 ${step.done ? "text-slate-500" : "font-medium text-teal-800"}`}
              href={
                step.name === "bookstack" && steps[1].done
                  ? `/api/bookstack/open?team=${teamId}`
                  : step.href
              }
              target={
                step.name === "bookstack" && steps[1].done
                  ? "_blank"
                  : undefined
              }
              rel="noopener noreferrer"
            >
              {step.label}
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        Progress updates automatically. BookStack progress records opening the
        workspace; sign in there with your separate BookStack credentials. A
        teammate completes their step when they join. Payment is optional during
        your 14-day trial.
      </p>
    </section>
  );
}
