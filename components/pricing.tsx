import { MEMBER_COPY, STORAGE_COPY, DRAFT_COPY } from "@/lib/quotas";
import { PaymentNote } from "@/components/payment-note";
import Link from "next/link";
import { ActionButton } from "./action-button";
import { PLAN } from "@/lib/config";
export function Pricing() {
  return (
    <section id="pricing" className="section scroll-mt-20">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <div className="lg:sticky lg:top-28">
          <p className="eyebrow">One team. One simple plan.</p>
          <h2>A home for your team’s knowledge.</h2>
          <p className="lede">
            Spend time sharing what you know. Let us take care of the
            infrastructure.
          </p>
          <p className="mt-6 max-w-md text-sm leading-6 text-muted">
            Try your own workspace for {PLAN.trialDays} days. No card needed.
            Your trial starts when you sign up through the Stripe registration,
            enter the billing address and choose your workspace address; your
            workspace is usually ready within 5 minutes.
          </p>
          <dl className="mt-8 grid max-w-md grid-cols-3 gap-4 border-t border-ink/10 pt-6 text-sm">
            <div>
              <dt className="text-faint">Trial</dt>
              <dd className="mt-1 font-semibold">{PLAN.trialDays} days</dd>
            </div>
            <div>
              <dt className="text-faint">Card up front</dt>
              <dd className="mt-1 font-semibold">Not needed</dd>
            </div>
            <div>
              <dt className="text-faint">Billing</dt>
              <dd className="mt-1 font-semibold">Monthly</dd>
            </div>
          </dl>
        </div>
        <div className="price-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-semibold">Team</h3>
            <div className="flex items-center gap-2">
              <span className="badge">14 days free</span>
              <span className="badge">No setup fee</span>
            </div>
          </div>
          <p className="my-6 flex items-baseline gap-2">
            <strong className="text-6xl font-semibold tracking-[-.04em]">
              €{PLAN.price}
            </strong>
            <span className="text-muted">/ month plus VAT</span>
          </p>
          <div id="trial">
            <ActionButton className="button w-full" />
            <PaymentNote />
          </div>
          <p className="mb-4 mt-8 text-xs font-semibold uppercase tracking-[.14em] text-faint">
            Everything included
          </p>
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
          </ul>
          <p className="mb-4 mt-8 text-xs font-semibold uppercase tracking-[.14em] text-faint">
            AI betas · non-personal content only
          </p>
          <ul className="checklist">
            <li>Reviewed document intake — available now (beta)</li>
            {/* The one thing none of the hosts in our sponsor row offer, and it
                was missing from the page where people decide. Stated at what it
                actually does today: AI answers with named sources, beta
                restricted to non-personal content. */}
            <li>
              &ldquo;Ask your wiki&rdquo; — available now (beta) for owners and
              admins: it names the page and section behind every answer.
              Answers are AI-written from your pages, with the page and section
              named behind every answer; until the updated processing
              conditions are finally approved, ask only about non-personal
              content.
            </li>
            <li>{DRAFT_COPY}</li>
            <li>Summary, tags and reviewer checklist for each draft</li>
            <li>Owner/admin approval before publication to BookStack</li>
          </ul>
          <p className="mt-6 text-xs leading-5 text-muted">
            Only workspace owners/admins can publish; members can upload and
            review. Drafts are shared with your BookHost dashboard team;
            BookStack page permissions apply after publication.
          </p>
          <p className="mt-6 text-xs leading-5 text-muted">
            Planned: email intake and answers scoped to each
            member&rsquo;s own BookStack permissions. These are not available
            today; there is no committed release date.
          </p>
          <p className="mt-6 border-t border-ink/10 pt-5 text-center text-xs font-medium text-muted">
            No credit card · Cancel anytime · Plus applicable VAT
          </p>
          <p className="mt-3 text-xs leading-5 text-faint">
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
