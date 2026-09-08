import { ActionButton } from "@/components/action-button";
import { Pricing } from "@/components/pricing";
import { faqs, benefits, steps } from "@/lib/landing-copy";
export default function Home() {
  return (
    <>
      <section className="section grid gap-14 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow">YOUR TEAM KNOWS A LOT. KEEP IT THAT WAY.</p>
          <h1>
            Your team’s BookStack.
            <span className="text-moss"> Hosting handled.</span>
          </h1>
          <p className="lede">
            Give your team a private BookStack workspace with managed hosting,
            daily backups and monthly billing. Start with 14 days free, no card
            required; continue for €39/month plus applicable VAT.
          </p>
          <p className="mt-5 text-sm leading-6 text-moss">
            <strong>
              Reviewed document intake and AI answers — coming in the next weeks
              — included in your plan.
            </strong>{" "}
            Upload a document or forward an email, review the proposed page,
            then approve it for BookStack. These features are not available
            today; timing is an estimate.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ActionButton>Start my 14-day free trial</ActionButton>
            <a
              href="https://demo.wissen.app.mintapis.com"
              className="button-secondary"
            >
              Open live demo <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-600">
            14 days free · No card required · Cancel monthly
          </p>
        </div>
        <div className="relative rounded-2xl bg-[#e8edde] p-5 sm:p-8">
          <div className="mb-5 flex items-center justify-between text-xs">
            <span className="font-semibold tracking-wider">
              YOUR KNOWLEDGE, CONNECTED
            </span>
            <span className="h-2 w-2 rounded-full bg-moss" />
          </div>
          <div className="rounded-xl border border-ink/10 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4 text-xs">
              <span className="font-semibold">Document inbox</span>
              <span className="text-slate-500">Planned workflow</span>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-3">
                <span
                  className="rounded-lg bg-paper p-3 text-xl"
                  aria-hidden="true"
                >
                  ▤
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    New starter handbook.pdf
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Uploaded by your team
                  </p>
                </div>
              </div>
              <div className="my-5 ml-5 h-6 border-l border-dashed border-moss/40" />
              <div className="rounded-lg bg-paper p-4">
                <p className="mb-2 text-xs font-semibold text-moss">
                  DRAFT SUGGESTION
                </p>
                <p className="font-semibold">
                  Your first week, all in one place
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  The people, processes and useful links every new teammate
                  needs.
                </p>
                <div className="mt-4 flex gap-2">
                  <span className="badge">People & culture</span>
                  <span className="badge">Onboarding</span>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-600">
                  Human review comes next
                </span>
                <span className="rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white">
                  Review draft →
                </span>
              </div>
            </div>
          </div>
          <p className="mt-5 text-center text-xs text-moss">
            Planned intake workflow · Human approval required.
          </p>
        </div>
      </section>
      <section className="border-y border-ink/10 py-12">
        <div className="grid gap-9 md:grid-cols-3">
          {benefits.map(([n, title, text]) => (
            <article key={n}>
              <span className="mb-4 inline-block font-mono text-xs text-moss">
                {n} /
              </span>
              <h3 className="text-xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section id="how-it-works" className="section">
        <p className="eyebrow">FROM SCATTERED TO SHARED</p>
        <h2>From sign-up to shared knowledge.</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map(([n, title, text]) => (
            <div key={n} className="border-t border-moss/30 pt-6">
              <span className="badge">Step {n}</span>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="border-y border-ink/10">
        <Pricing />
      </div>
      <section className="section grid gap-10 md:grid-cols-[1fr_1.6fr]">
        <div>
          <p className="eyebrow">A FEW GOOD QUESTIONS</p>
          <h2>Before you move in.</h2>
        </div>
        <div>
          {faqs.map(([q, a]) => (
            <details key={q} className="group border-b border-ink/15 py-5">
              <summary className="cursor-pointer text-base font-medium">
                {q}
              </summary>
              <p className="mt-4 text-sm leading-7 text-slate-600">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
