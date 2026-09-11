import { MEMBER_COPY, STORAGE_COPY, DRAFT_COPY } from "@/lib/quotas";
import { PaymentNote } from "@/components/payment-note";
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
            Your trial starts when you sign up through the Stripe registration,
            enter the billing address and choose your workspace address; your
            workspace is usually ready within 5 minutes.
          </p>
        </div>
        <div className="price-card">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Team</h3>
            <div className="flex items-center gap-2">
              <span className="badge">14 days free</span>
              <span className="badge">No setup fee</span>
            </div>
          </div>
          <p className="my-6">
            <strong className="text-5xl font-semibold tracking-tight">
              €{PLAN.price}
            </strong>
            <span className="text-slate-600"> / month</span>
          </p>
          <div id="trial">
            <ActionButton className="button w-full" />
            <PaymentNote />
          </div>
          <ul className="checklist">
            <li>Your own hosted BookStack workspace</li>
            <li>Your own domain, or a bookhost.co address</li>
            <li>{MEMBER_COPY}</li>
            <li>{STORAGE_COPY}</li>
            <li>
              Fair use for CPU and database resources; contact us for more
            </li>
            <li>BookStack content exports, governed by your permissions</li>
            <li>Hosting, maintenance and security updates</li>
            <li>
              Daily backups and email support —{" "}
              <Link
                className="underline"
                href="/blog/how-we-test-every-bookstack-backup-restore"
              >
                How we test restores
              </Link>
              {" · "}
              <Link className="underline" href="/reliability">
                Backups, recovery and current limits
              </Link>
            </li>
            <li>Seven-day backup retention and restore help</li>
            <li>Reviewed document intake — available now (beta)</li>
            <li>{DRAFT_COPY}</li>
            <li>Summary, tags and reviewer checklist for each draft</li>
            <li>Owner/admin approval before publication to BookStack</li>
          </ul>
          <p className="mt-5 text-xs leading-5 text-slate-600">
            Only workspace owners/admins can publish; members can upload and
            review. Drafts are shared with your BookHost dashboard team;
            BookStack page permissions apply after publication.
          </p>
          <p className="mt-5 text-xs leading-5 text-slate-600">
            Planned: email intake and permission-aware AI answers. These are not
            available today; there is no committed release date.
          </p>
          <p className="mt-4 text-xs text-slate-600 text-center">
            No credit card · Cancel anytime · Plus applicable VAT
          </p>
          <p className="mt-3 text-xs text-slate-600">
            Add a payment method in Manage billing to continue after the trial.
            Without one, your trial ends automatically without a charge.
            €39/month + 19 % VAT (€46.41). EU businesses with a valid VAT ID
            outside Germany: contact us and we apply reverse charge manually. No
            setup fee for the standard plan. By continuing, you agree to the{" "}
            <Link className="underline" href="/legal/agb">
              Terms
            </Link>{" "}
            and{" "}
            <Link className="underline" href="/legal/avv">
              Data Processing Agreement
            </Link>
            , and acknowledge our{" "}
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
