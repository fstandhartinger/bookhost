import { DRAFT_COPY } from "@/lib/quotas";
import { JsonLd } from "@/components/json-ld";
import { homeStructuredData } from "@/lib/structured-data";
import { PaymentNote } from "@/components/payment-note";
import Image from "next/image";
import { ActionButton } from "@/components/action-button";
import { Pricing } from "@/components/pricing";
import { faqs, benefits, steps } from "@/lib/landing-copy";
import { DEMO_URL } from "@/lib/config";
import Link from "next/link";
export default function Home() {
  return (
    <>
      <JsonLd data={homeStructuredData()} />
      <section className="section grid gap-14 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow">YOUR TEAM KNOWS A LOT. KEEP IT THAT WAY.</p>
          <h1>
            Your team’s BookStack.
            <span className="text-moss"> Hosting handled.</span>
          </h1>
          <p className="lede">
            Give your team a private BookStack workspace with managed hosting,
            daily backups we restore-test on a schedule, and reviewed document
            intake, available now in beta.
            Start with 14 days free, no card required; continue for €39/month
            plus applicable VAT.
          </p>
          <p className="mt-5 text-sm leading-6 text-moss">
            <strong>Document intake (beta) available now.</strong> Upload a
            document, review the draft with its summary, tags and reviewer
            checklist, then approve it as an owner or admin for BookStack.{" "}
            {DRAFT_COPY}
          </p>
          {/* People arriving from the BookStack installation docs already run
              their own instance; their first question is whether they can bring
              it. The answer used to be the nineteenth link on this page. */}
          <p className="mt-5 text-sm leading-6">
            Already running BookStack yourself?{" "}
            <a href="/migrate" className="underline">
              See what moving an existing instance involves
            </a>
            .
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ActionButton>Start my 14-day free trial</ActionButton>
            <div>
              <a href={DEMO_URL} className="button-secondary">
                Open live demo <span aria-hidden="true">↗</span>
              </a>
              <p className="mt-2 text-center text-xs text-slate-600">
                Read-only demo workspace (the demo runs on our workspace domain
                demo.bookhost.co)
              </p>
            </div>
          </div>
          <PaymentNote />
          <p className="mt-4 text-xs text-slate-600">
            14 days free · No card required · Cancel monthly
          </p>
        </div>
        <div className="rounded-2xl bg-[#e8edde] p-5 sm:p-8">
          <p className="eyebrow">YOUR DOCUMENT. YOUR REVIEW. YOUR WIKI.</p>
          <a
            href="/screens/intake-review.webp"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Enlarge review screenshot (opens in a new tab)"
            className="block overflow-hidden rounded-xl border border-ink/10 bg-white shadow-sm"
          >
            <Image
              src="/screens/intake-review.webp"
              alt="Real document intake review showing a vacation policy draft, tags and page preview"
              width={1280}
              height={800}
              priority
              sizes="(min-width: 1024px) 480px, 90vw"
            />
          </a>
          <p className="mt-5 text-center text-xs text-moss">
            A real beta draft · Human approval required · Click to enlarge
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
              {title === "Backups with a way back" && (
                <div className="flex flex-wrap gap-x-4">
                  <Link
                    className="mt-3 inline-block text-sm underline"
                    href="/blog/how-we-test-every-bookstack-backup-restore"
                  >
                    How we test restores
                  </Link>
                  <Link
                    className="mt-3 inline-block text-sm underline"
                    href="/reliability"
                  >
                    Backups, recovery and current limits
                  </Link>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      <section id="how-it-works" className="section">
        <p className="eyebrow">FROM SCATTERED TO SHARED</p>
        <h2>From sign-up to shared knowledge.</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-4">
          {steps.map(([n, title, text]) => (
            <div key={n} className="border-t border-moss/30 pt-6">
              <span className="badge">Step {n}</span>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>
      <section
        id="see-it-work"
        className="section mx-auto max-w-[1100px] border-t border-ink/10"
      >
        <p className="eyebrow">DOCUMENT INTAKE · AVAILABLE NOW IN BETA</p>
        <h2>See it work.</h2>
        <p className="lede max-w-2xl">
          A real upload, AI draft and published page from our demo workspace.
          This vacation policy is fictional sample content.
        </p>
        <p className="mt-5 text-sm leading-6 text-slate-600">
          Only workspace owners/admins can publish; members can upload and
          review. Drafts are shared with your BookHost dashboard team; BookStack
          page permissions apply after publication.
        </p>
        <div className="mt-10 space-y-12">
          {[
            [
              "intake-upload",
              "1. Upload your source",
              "Choose a document and a destination book. PDF, DOCX, Markdown and TXT are supported.",
              "Document intake upload form with vacation-policy.md selected and a destination book",
            ],
            [
              "intake-review",
              "2. Review the suggestion",
              "Check the summary, tags and reviewer checklist. Edit the draft before an owner or admin approves it.",
              "Real vacation policy draft with editable title, tags and summary in the review interface",
            ],
            [
              "bookstack-page",
              "3. Read it in BookStack",
              "Approval creates a normal BookStack page, visible according to its destination book’s permissions.",
              "Published Vacation policy demo page in BookStack with its summary and review checklist",
            ],
          ].map(([file, title, description, alt]) => (
            <figure key={file} className="flex flex-col gap-4">
              <figcaption className="order-2">
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {description} Click the image to enlarge it in a new tab.
                </p>
              </figcaption>
              <a
                href={`/screens/${file}.webp`}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-xl border border-ink/10 bg-white shadow-sm"
                aria-label={`View full screenshot: ${title}`}
              >
                <Image
                  src={`/screens/${file}.webp`}
                  alt={alt}
                  width={1280}
                  height={800}
                  loading="lazy"
                  className="h-auto w-full"
                  sizes="(min-width: 1152px) 1100px, calc(100vw - 48px)"
                />
              </a>
            </figure>
          ))}
        </div>
      </section>
      <section className="mb-16 rounded-2xl bg-[#e8edde] p-8">
        <p className="eyebrow">ROADMAP · PLANNED</p>
        <h2>Email intake and permission-aware answers.</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
          These features are not available today. We plan to add email
          submission and answers based only on sources the requesting person can
          access. There is no committed release date. The document upload and
          review beta is available now.
        </p>
      </section>
      <div className="border-y border-ink/10">
        <Pricing />
      </div>
      <section
        id="faq"
        className="section grid gap-10 md:grid-cols-[1fr_1.6fr]"
      >
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
