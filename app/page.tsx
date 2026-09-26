import * as React from "react";
import { DRAFT_COPY } from "@/lib/quotas";
import { JsonLd } from "@/components/json-ld";
import { homeStructuredData } from "@/lib/structured-data";
import { PaymentNote } from "@/components/payment-note";
import Image from "next/image";
import { ActionButton } from "@/components/action-button";
import { Pricing } from "@/components/pricing";
import { WikiChatDemo } from "@/components/wiki-chat-demo";
import { faqs, benefits, steps } from "@/lib/landing-copy";
import { DEMO_URL } from "@/lib/config";
import Link from "next/link";

const icons: Record<string, React.ReactNode> = {
  server: (
    <path d="M4 5.5h16v5H4zM4 13.5h16v5H4zM7.5 8h.01M7.5 16h.01" />
  ),
  backup: (
    <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l2.5 2.5" />
  ),
  review: (
    <path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4M10 13l2 2 3.5-3.5" />
  ),
  globe: (
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5Z" />
  ),
  shield: (
    <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6zM9 12l2 2 4-4" />
  ),
  domain: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
};
function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-xl border border-ink/10 bg-sunken text-moss">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icons[name]}
      </svg>
    </span>
  );
}

const facts: [keyof typeof icons, string, string][] = [
  ["globe", "EU hosting", "Hetzner infrastructure in Germany or Finland"],
  ["backup", "Daily backups", "Seven-day retention and restore help"],
  ["shield", "Updates handled", "Hosting, maintenance and security updates"],
  ["domain", "Your own domain", "Or a free bookhost.co address"],
];
const benefitIcons: (keyof typeof icons)[] = ["server", "backup", "review"];

const intakeSteps = [
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
];

const comparison: [string, string, string][] = [
  ["Server and TLS certificates", "You set up and monitor them", "Included"],
  ["BookStack and security updates", "You schedule and apply them", "Included"],
  ["Daily backups", "You script and store them", "Included, seven-day retention"],
  ["Restoring a backup", "You test and run restores yourself", "Restore help through support"],
  ["Your own domain", "You configure DNS and certificates", "Add it in the dashboard"],
  ["Price", "Server cost plus your time", "€39/month plus VAT, one flat price"],
];

export default function Home() {
  return (
    <>
      <JsonLd data={homeStructuredData()} />
      {/* Hero: value, price and the two ways in, before anything else. */}
      <section className="relative pb-10 pt-14 text-center sm:pt-20 md:pt-24">
        <div
          aria-hidden="true"
          className="glow pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[560px]"
        />
        <p className="pill">
          <span className="h-1.5 w-1.5 rounded-full bg-moss" />
          Managed BookStack hosting · Hosted in the EU
        </p>
        <h1 className="mx-auto mt-7 max-w-4xl">
          Your team’s BookStack.{" "}
          <span className="text-moss">Hosting handled.</span>
        </h1>
        <p className="lede mx-auto max-w-2xl">
          A private BookStack wiki for your team, ready in about 5 minutes. We
          run the server, apply the updates and keep daily backups with restore
          help. One flat price: €39/month plus VAT.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-start">
          <ActionButton className="button w-full sm:w-auto">
            Start 14-day free trial
          </ActionButton>
          <div className="w-full sm:w-auto">
            <a href={DEMO_URL} className="button-secondary w-full sm:w-auto">
              Open live demo <span aria-hidden="true">↗</span>
            </a>
            <p className="mt-2 text-xs text-faint">
              Read-only demo workspace (demo.bookhost.co)
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm text-muted">
          14 days free · No card required · Cancel monthly
        </p>
        {/* People arriving from the BookStack installation docs already run
            their own instance; their first question is whether they can bring
            it, so the answer sits in the hero. */}
        <p className="mt-3 text-sm text-muted">
          Already running BookStack yourself?{" "}
          <Link
            href="/migrate"
            className="font-medium text-ink underline decoration-moss/40 underline-offset-4 hover:decoration-moss"
          >
            See what moving an existing instance involves
          </Link>
        </p>
        <details className="mx-auto mt-4 max-w-xl text-left text-sm text-muted">
          <summary className="cursor-pointer text-center text-xs text-faint hover:text-ink">
            What happens after I click “Start”?
          </summary>
          <PaymentNote />
        </details>
      </section>

      <figure className="relative mx-auto max-w-5xl">
        <div className="frame">
          <div className="frame-bar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span className="mx-auto rounded-md bg-surface px-3 py-0.5 text-[11px] text-faint">
              demo.bookhost.co/books/team-handbook/page/onboarding
            </span>
          </div>
          <Image
            src="/screens/demo-onboarding.webp"
            alt="The BookHost demo workspace in BookStack, showing the Onboarding page of a fictional team handbook with book navigation on the left"
            width={1600}
            height={906}
            priority
            className="h-auto w-full"
            sizes="(min-width: 1024px) 1024px, 100vw"
          />
        </div>
        <figcaption className="mt-4 text-center text-xs text-faint">
          Our live demo workspace: plain BookStack, hosted by BookHost.
          Fictional sample content.
        </figcaption>
      </figure>

      <section aria-label="What is included" className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([icon, title, text]) => (
          <div key={title} className="flex items-start gap-4 bg-paper p-6">
            <Icon name={icon} />
            <div>
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{text}</p>
            </div>
          </div>
        ))}
      </section>

      <section id="features" className="defer section scroll-mt-20">
        <div className="max-w-2xl">
          <p className="eyebrow">Why teams pick BookHost</p>
          <h2>The wiki your team already likes, without the server chores.</h2>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {benefits.map(([n, title, text], i) => (
            <article key={n} className="card flex flex-col">
              <Icon name={benefitIcons[i] ?? "server"} />
              <h3 className="mt-6 text-lg font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">{text}</p>
              {title === "Backups with a way back" && (
                <div className="mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-4">
                  <Link
                    className="inline-block py-1.5 text-sm font-medium text-ink underline decoration-moss/40 underline-offset-4 hover:decoration-moss"
                    href="/blog/how-we-test-every-bookstack-backup-restore"
                  >
                    How we test restores
                  </Link>
                  <Link
                    className="inline-block py-1.5 text-sm font-medium text-ink underline decoration-moss/40 underline-offset-4 hover:decoration-moss"
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

      <section id="how-it-works" className="defer border-t border-ink/10 py-16 md:py-24">
        <div className="max-w-2xl">
          <p className="eyebrow">From scattered to shared</p>
          <h2>From sign-up to shared knowledge.</h2>
        </div>
        <ol className="mt-12 grid gap-8 md:grid-cols-4">
          {steps.map(([n, title, text]) => (
            <li key={n} className="relative border-t border-ink/15 pt-6">
              <span className="absolute -top-px left-0 h-px w-10 bg-moss" />
              <span className="font-mono text-xs text-moss">Step {n}</span>
              <h3 className="mt-3 text-lg font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="see-it-work" className="defer border-t border-ink/10 py-16 md:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end">
          <div>
            <p className="eyebrow">Document intake · available now in beta</p>
            <h2>Turn a document into a reviewed wiki page.</h2>
            <p className="lede">
              A real upload, AI draft and published page from our demo
              workspace. This vacation policy is fictional sample content.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
            <p>
              <strong>Document intake (beta) available now.</strong> Upload a
              document, review the draft with its summary, tags and reviewer
              checklist, then approve it as an owner or admin for BookStack.{" "}
              {DRAFT_COPY}
            </p>
            {/* /reliability tells readers to keep personal data out of the beta
                until the processor agreement and transfer safeguards are
                documented. Selling the feature without that sentence invites
                someone to upload a staff handbook on day one. */}
            <p className="mt-3">
              <strong>While the beta runs, use non-personal example documents only:</strong>{" "}
              the data protection prerequisites for drafting with an external
              model are not documented yet. See{" "}
              <a className="underline underline-offset-2" href="/reliability#limits">
                what we do and do not promise
              </a>
              .
            </p>
          </div>
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-muted">
          Only workspace owners/admins can publish; members can upload and
          review. Drafts are shared with your BookHost dashboard team; BookStack
          page permissions apply after publication.
        </p>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {intakeSteps.map(([file, title, description]) => (
            <li key={file} className="border-t border-ink/15 pt-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </li>
          ))}
        </ol>
        <figure className="mx-auto mt-10 max-w-4xl">
          <a
            href="/screens/intake-review.webp"
            target="_blank"
            rel="noopener noreferrer"
            className="frame block"
            aria-label="View full screenshot: Review the suggestion (opens in a new tab)"
          >
            <Image
              src="/screens/intake-review.webp"
              alt={intakeSteps[1][3]}
              width={1280}
              height={800}
              loading="lazy"
              className="h-auto w-full"
              sizes="(min-width: 1024px) 896px, calc(100vw - 40px)"
            />
          </a>
          <figcaption className="mt-4 text-center text-xs text-faint">
            A real beta draft in review · Human approval required · Click to
            enlarge
          </figcaption>
        </figure>
      </section>

      <section className="defer relative mb-4 overflow-hidden rounded-3xl border border-ink/10 bg-sunken px-5 py-12 sm:px-10 md:py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <p className="eyebrow">Ask your wiki · available now in beta</p>
            <h2>Ask a question. Get the page it came from.</h2>
            <p className="mt-5 text-sm leading-7 text-muted">
              &ldquo;Ask your wiki&rdquo; is available now in beta to workspace
              owners and admins: it searches your own workspace, answers only
              from the pages it found, and shows the page and section behind
              every result. Its AI answers are live in beta: each question and
              the passages it answers from go to TensorX (Ireland) for a written
              answer — and the same limit applies as for intake: use the betas
              only on workspaces without personal data. Email submission and
              answers scoped to each member&rsquo;s own BookStack permissions
              are planned with no committed release date. The document upload
              and review beta is available now.
            </p>
          </div>
          <div>
            <WikiChatDemo />
            <p className="mt-3 text-xs leading-5 text-faint">
              Animation of a real answer from our internal test workspace —
              fictional sample content. Customer workspaces match by words
              unless an owner or admin turns on matching by meaning (beta);
              every answer still names its source page.
            </p>
          </div>
        </div>
        <figure className="mx-auto mt-12 flex max-w-3xl flex-col gap-4">
          <figcaption className="order-2 text-xs leading-5 text-faint">
            Real screenshot from our internal test workspace. There, matching by meaning found the bike-parking page although the question shares no word with it. Customer workspaces match by words unless an owner or admin turns on matching by meaning (beta); every answer still names its source page.
          </figcaption>
          <a
            href="/screens/wiki-chat-answer.webp"
            target="_blank"
            rel="noopener noreferrer"
            className="frame block"
            aria-label="View full screenshot: Ask your wiki answer (opens in a new tab)"
          >
            <Image
              src="/screens/wiki-chat-answer.webp"
              alt='Ask your wiki answering "Where may I leave my two-wheeler?" with the bike-parking page as its numbered source'
              width={1152}
              height={870}
              loading="lazy"
              className="h-auto w-full"
              sizes="(min-width: 800px) 768px, calc(100vw - 48px)"
            />
          </a>
        </figure>
      </section>

      <section id="agents" className="defer scroll-mt-20 border-t border-ink/10 py-16 md:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <p className="eyebrow">Agent access · beta</p>
            <h2>Human-agent collaboration wiki.</h2>
            <p className="mt-5 text-sm leading-7 text-muted">
              Connect Claude Code, Cursor, VS Code or Codex over MCP. Agents use
              their own BookStack user and permissions; their edits wait for
              your approval unless you allow direct edits.
            </p>
            <Link
              href="/agents"
              className="mt-5 inline-block text-sm font-medium text-ink underline decoration-moss/40 underline-offset-4 hover:decoration-moss"
            >
              How to connect an agent →
            </Link>
          </div>
          <ul className="checklist text-sm leading-6 text-muted">
            <li>
              One MCP endpoint per workspace; owners and admins create an agent
              user and token in the dashboard.
            </li>
            <li>
              BookStack roles decide what each agent can read and change.
            </li>
            <li>
              Default &ldquo;Propose only&rdquo;: agent edits land in the review
              queue. Direct edits appear in the revision history under the
              agent&rsquo;s name.
            </li>
            <li>
              Activity log without page content, rate limits per token, and a
              switch to turn agent access off.
            </li>
            <li>
              BookHost sends no page content to an AI model for this feature;
              content goes only to the agent you connect. Claude.ai web and
              ChatGPT connectors need OAuth sign-in, which is planned but not
              available yet.
            </li>
          </ul>
        </div>
      </section>

      <section className="defer section">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:items-start">
          <div>
            <p className="eyebrow">Self-hosted or hosted</p>
            <h2>Keep BookStack. Drop the ops work.</h2>
            <p className="mt-5 text-sm leading-7 text-muted">
              Self-hosting BookStack is a good choice if someone on your team
              enjoys running servers. If nobody does, this is the work you hand
              over.
            </p>
            <Link
              href="/self-hosted-vs-managed-bookstack"
              className="mt-5 inline-block text-sm font-medium text-ink underline decoration-moss/40 underline-offset-4 hover:decoration-moss"
            >
              Read the full self-hosted vs managed comparison →
            </Link>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-surface">
            <table className="w-full min-w-[520px] text-left text-sm">
              <caption className="sr-only">
                Self-hosted BookStack compared with BookHost
              </caption>
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-[.12em] text-faint">
                  <th scope="col" className="p-4 font-semibold">Task</th>
                  <th scope="col" className="p-4 font-semibold">Self-hosted</th>
                  <th scope="col" className="p-4 font-semibold text-moss">BookHost</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(([task, self, hosted]) => (
                  <tr key={task} className="border-b border-ink/[.07] last:border-0">
                    <th scope="row" className="p-4 font-medium">{task}</th>
                    <td className="p-4 text-muted">{self}</td>
                    <td className="p-4 font-medium">{hosted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="border-t border-ink/10">
        <Pricing />
      </div>

      <section
        id="faq"
        className="defer grid scroll-mt-20 gap-10 border-t border-ink/10 py-16 md:grid-cols-[1fr_1.6fr] md:py-24"
      >
        <div>
          <p className="eyebrow">A few good questions</p>
          <h2>Before you move in.</h2>
          <p className="mt-5 text-sm leading-6 text-muted">
            Something else? Write to{" "}
            <a
              className="text-ink underline decoration-moss/40 underline-offset-4"
              href="mailto:info@productivity-boost.com"
            >
              info@productivity-boost.com
            </a>
            .
          </p>
        </div>
        <div className="divide-y divide-slate-200 border-y border-ink/10">
          {faqs.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden="true"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ink/15 text-muted transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="relative mb-8 overflow-hidden rounded-3xl bg-ink px-6 py-14 text-center text-paper sm:px-12 md:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(50%_80%_at_50%_0%,rgb(var(--moss)/.55),transparent_70%)]"
        />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-paper">
            Give your team’s knowledge a proper home.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-paper/75">
            Your own BookStack in about 5 minutes. 14 days free, no card
            required.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className="inline-flex min-h-11 items-center rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink transition hover:bg-accent"
            >
              Start free trial
            </Link>
            <a
              href={DEMO_URL}
              className="inline-flex min-h-11 items-center rounded-full border border-paper/25 px-6 py-3 text-sm font-semibold text-paper transition hover:border-paper/60"
            >
              Open live demo <span aria-hidden="true">&nbsp;↗</span>
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
