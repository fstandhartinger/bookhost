import Link from "next/link";
import { ActionButton } from "./action-button";
import { PLAN } from "@/lib/config";
export function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          <p className="eyebrow">ONE TEAM. ONE SIMPLE PLAN.</p>
          <h2>A home for your team’s knowledge.</h2>
          <p className="lede">
            Spend time sharing what you know. Let us take care of the
            infrastructure.
          </p>
          <p className="mt-6 text-sm text-slate-600">
            Try your own workspace for {PLAN.trialDays} days. No card needed.
          </p>
        </div>
        <div className="price-card">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Team</h3>
            <span className="badge">14 days free</span>
          </div>
          <p className="my-6">
            <strong className="text-5xl font-semibold tracking-tight">
              €{PLAN.price}
            </strong>
            <span className="text-slate-600"> / month</span>
          </p>
          <ul className="checklist">
            <li>Your own hosted BookStack workspace</li>
            <li>Hosting, maintenance and security updates</li>
            <li>Daily backups and email support</li>
            <li>Seven-day backup retention and restore help</li>
            <li>
              Reviewed intake{" "}
              <span className="text-xs text-slate-500">— coming soon</span>
            </li>
            <li>
              Permission-aware answers{" "}
              <span className="text-xs text-slate-500">— coming soon</span>
            </li>
          </ul>
          <p className="mt-5 text-xs leading-5 text-slate-600">
            Hosting is available at launch. Document/email intake and AI answers
            are planned for the coming weeks and included once released; timing
            is not guaranteed.
          </p>
          <ActionButton className="button w-full mt-8" />
          <p className="mt-4 text-xs text-slate-600 text-center">
            No credit card · Cancel anytime · Plus applicable VAT
          </p>
          <p className="mt-3 text-xs text-slate-600">
            Without a payment method, your trial ends automatically. By
            continuing, you agree to the{" "}
            <Link className="underline" href="/legal/agb">
              Terms
            </Link>{" "}
            and acknowledge our{" "}
            <Link className="underline" href="/legal/datenschutz">
              Privacy Policy
            </Link>
            . For business teams.
          </p>
        </div>
      </div>
    </section>
  );
}
