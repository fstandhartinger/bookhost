import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { ActionButton } from "@/components/action-button";
import { clientConfigs } from "@/lib/agent-docs";
import {
  AI_DETAILS,
  AI_FEATURES,
  AI_LIMITS,
  AI_PLANNED_NOTE,
  AI_STATUS_LABEL,
  type AiStatus,
} from "@/lib/ai-features";
import { PUBLIC_BASE_URL } from "@/lib/config";

const title = "AI for your BookStack wiki: search with sources, MCP agents, drafts with approval";
const description =
  "BookHost adds AI to hosted BookStack: answers that name their source pages, an MCP endpoint for Claude Code, Cursor, VS Code and Codex, and AI drafts an owner approves. EU processing, included in €39/month.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/ai" },
  openGraph: {
    title: `${title} · BookHost`,
    description,
    url: "/ai",
    type: "website",
    // A page-level openGraph block replaces the root one, so the shared card
    // image has to be repeated here or the link preview loses it.
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: PUBLIC_BASE_URL },
    {
      "@type": "ListItem",
      position: 2,
      name: "AI features",
      item: `${PUBLIC_BASE_URL}/ai`,
    },
  ],
};

const STATUS_CLASS: Record<AiStatus, string> = {
  available: "bg-moss/10 text-moss",
  beta: "bg-amber-100 text-amber-900",
  planned: "bg-ink/5 text-muted",
};

function Status({ status }: { status: AiStatus }) {
  return (
    <span
      className={`w-fit whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
    >
      {AI_STATUS_LABEL[status]}
    </span>
  );
}

function Shot({
  src,
  alt,
  width,
  height,
  caption,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
}) {
  return (
    <figure className="mt-8">
      <a href={src} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-2xl border border-ink/10 bg-surface shadow-sm">
        <Image src={src} alt={alt} width={width} height={height} className="h-auto w-full" sizes="(min-width: 800px) 768px, calc(100vw - 48px)" />
      </a>
      <figcaption className="mt-3 text-xs leading-5 text-faint">{caption}</figcaption>
    </figure>
  );
}

// A real Claude Code run against the showcase workspace on 12 October 2026
// (fictional sample content). Keep it verbatim; do not polish the answer.
const CLAUDE_CODE_RUN = `$ claude "Using only the bookhost MCP server: list the books in our wiki,
  then search for 'onboarding' and tell me the top page result and its URL."

Books:
- Northwind Client Projects
- Northwind Studio Handbook
- Team handbook

Top "onboarding" page result: First week at Northwind
https://showcase-northwind.bookhost.co/books/northwind-studio-handbook/page/first-week-at-northwind`;

export default function AiPage() {
  const claudeCode = clientConfigs().find((c) => c.id === "claude-code");
  return (
    <>
      <JsonLd data={breadcrumb} />
      <article className="section mx-auto max-w-3xl">
        <p className="eyebrow">AI features · included in every workspace</p>
        <h1>AI for your team wiki that shows its sources and waits for your approval.</h1>
        <p className="lede">
          BookHost runs your private BookStack wiki and adds three AI features
          on top: answers that name the page they came from, an MCP endpoint
          for the AI agents your team already uses, and AI drafts that only
          become pages after an owner or admin approves them. All three are
          included in the €39/month plan.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ActionButton className="button w-full sm:w-auto">
            Start 14-day free trial
          </ActionButton>
          <Link href="/agents" className="button-secondary w-full sm:w-auto">
            MCP setup guide
          </Link>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {AI_FEATURES.map((feature) => (
            <a key={feature.id} href={`#${feature.id}`} className="card flex flex-col transition hover:border-moss/40">
              <Status status={feature.status} />
              <span className="mt-4 font-semibold">{feature.title}</span>
              <span className="mt-2 text-sm leading-6 text-muted">{feature.summary}</span>
            </a>
          ))}
        </div>

        <div className="prose-guide mt-16">
          <h2 id="search" className="scroll-mt-24">AI search with sources</h2>
          <p>
            Ask a question in your own words. BookHost finds the matching
            passages in your workspace, writes a short answer only from those
            passages and lists every page and section it used, with a link. When
            nothing in the wiki fits, it says so instead of guessing.
          </p>
          <ul>
            <li>Available to workspace owners and admins, in the BookHost dashboard under <strong>Ask your wiki</strong>.</li>
            <li>
              Matches by words out of the box. <strong>Matching by meaning</strong>{" "}
              (beta) finds pages even when the question uses different words; an
              owner or admin turns it on with one click for workspaces without
              personal data, and turning it off deletes the index.
            </li>
            <li>
              Answers for every member, limited to what that member may read in
              BookStack, are planned. Until then, asking is restricted to owners
              and admins, who can already read every page.
            </li>
          </ul>
        </div>
        <Shot
          src="/screens/ai-answer-sources.webp"
          alt="An AI answer about a designer's first week, with numbered citations and a Sources list naming the page First week at Northwind and its sections Day one and By the end of the week"
          width={1656}
          height={740}
          caption="Real answer from our showcase workspace (fictional sample content), 12 October 2026. Each [n] links to the page and section it came from."
        />

        <div className="prose-guide mt-16">
          <h2 id="agents" className="scroll-mt-24">Connect your AI agents (MCP)</h2>
          <p>
            Every workspace has its own MCP server at{" "}
            <code>https://&lt;your-workspace&gt;.bookhost.co/mcp</code>. Claude
            Code, Cursor, VS Code (GitHub Copilot agent mode) and the Codex CLI
            connect directly; Claude Desktop connects through the open-source{" "}
            <code>mcp-remote</code> bridge. Agents can search, read pages and
            attachments and, if you allow it, propose or make edits.
          </p>
          <ul>
            <li>
              <strong>Its own BookStack user.</strong> Owners and admins create
              an agent in the dashboard and pick its BookStack role; your
              existing book, chapter and page permissions decide what it sees.
            </li>
            <li>
              <strong>Propose only by default.</strong> Agent edits arrive in the
              review queue, marked as agent proposals. Nothing changes in the
              wiki until an owner or admin approves. You can switch a workspace
              to read-only or allow direct edits, which then show up in the
              revision history under the agent&rsquo;s name.
            </li>
            <li>
              <strong>Kill switch and activity log.</strong> One button revokes
              every agent token; the log records tool, target and result, never
              page content or search terms.
            </li>
            <li>
              <strong>No extra AI processor.</strong> For this feature BookHost
              sends your pages only to the agent you connect, not to any model
              of ours.
            </li>
          </ul>
          <h3>Two-minute setup with Claude Code</h3>
          <ol>
            <li>Dashboard → <strong>Agents</strong> → create an agent and copy its token (shown once).</li>
            <li>Add the server:</li>
          </ol>
          {claudeCode?.snippet && (
            <pre className="overflow-x-auto rounded-xl bg-ink p-4 text-xs leading-5 text-paper">
              <code>{claudeCode.snippet}</code>
            </pre>
          )}
          <p>
            Then ask: &ldquo;List the books in our wiki.&rdquo; Configurations
            for Cursor, VS Code, Codex and Claude Desktop are on the{" "}
            <Link href="/agents#clients">agent setup guide</Link>. claude.ai and
            ChatGPT web connectors need OAuth sign-in, which is planned.
          </p>
          <p>A real run against our showcase workspace:</p>
          <pre className="overflow-x-auto rounded-xl border border-ink/10 bg-surface p-4 text-xs leading-5">
            <code>{CLAUDE_CODE_RUN}</code>
          </pre>
        </div>
        <Shot
          src="/screens/agent-proposal-review.webp"
          alt="Review agent proposal card: proposed by an AI agent named Northwind Studio Guide, appending one line to the page First week at Northwind, with Approve and apply and Reject buttons"
          width={1080}
          height={1086}
          caption="An edit proposed by the Codex CLI over MCP on 12 October 2026, waiting in the review queue. The page stays unchanged until someone approves."
        />
        <Shot
          src="/screens/agent-write-mode.webp"
          alt="Write mode setting with three options: Off, Propose only (default, selected) and Direct"
          width={1656}
          height={786}
          caption="The per-workspace write mode in the BookHost dashboard."
        />

        <div className="prose-guide mt-16">
          <h2 id="drafts" className="scroll-mt-24">AI drafts with approval</h2>
          <p>
            Upload a PDF, DOCX, Markdown or TXT file and choose a destination
            book. BookHost drafts a wiki page from it with a summary, tags and a
            reviewer checklist. Your team edits the draft; only an owner or
            admin can publish it to BookStack, where the book&rsquo;s
            permissions apply. AI output can contain mistakes, which is exactly
            why nothing is published without a person.
          </p>
          <p>
            Sending documents by email is planned and not available yet.
          </p>
        </div>
        <Shot
          src="/screens/intake-review.webp"
          alt="Review screen of an AI draft for a fictional vacation policy, with editable title, tags and summary"
          width={1280}
          height={800}
          caption="An AI draft from our demo workspace in review (fictional sample content)."
        />

        <div className="prose-guide mt-16">
          <h2 id="data" className="scroll-mt-24">Where your data goes</h2>
          <ul>
            <li>
              Your wiki, its database and backups run on Hetzner infrastructure
              in Germany or Finland.
            </li>
            <li>
              AI search, AI drafts and matching by meaning use{" "}
              <strong>TensorX Limited (Dublin, Ireland)</strong>; its documented
              GPU infrastructure is in Dublin and Helsinki, and its data
              processing agreement provides zero retention of prompts and
              completions. No other AI provider and no free-model fallback is
              used.
            </li>
            <li>
              Only what a feature needs is sent: the extracted text of an
              uploaded document, or a question and the passages it is answered
              from. Matching by meaning, when switched on, sends page text to compute search
              vectors (refreshed hourly), which are stored in our own EU database.
            </li>
            <li>
              Nothing goes to TensorX unless someone in your workspace uses one
              of these features. Agent access over MCP involves no AI provider
              of ours at all.
            </li>
            <li>
              You stay the controller. Details are in our{" "}
              <Link href="/legal/datenschutz">privacy notice</Link> and{" "}
              <Link href="/legal/avv">data processing agreement</Link> (annex 3
              lists TensorX).
            </li>
          </ul>

          <h2 id="limits" className="scroll-mt-24">Limits</h2>
          <ul>
            {AI_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <p>
            AI is included in the <Link href="/pricing">€39/month plan</Link>;
            there is no separate AI add-on.
          </p>

          <h2 id="status" className="scroll-mt-24">Beta and planned</h2>
        </div>
        <ul className="mt-6 divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-surface">
          {AI_DETAILS.map((item) => (
            <li key={item.title} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:gap-4">
              <Status status={item.status} />
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-5 text-faint">{AI_PLANNED_NOTE}</p>

        <div className="mt-16 rounded-2xl border border-ink/10 bg-sunken p-6 text-center">
          <p className="text-lg font-semibold">Try it on your own wiki.</p>
          <p className="mt-2 text-sm text-muted">
            14 days free, no card. €39/month plus VAT afterwards, AI included.
          </p>
          <div className="mt-5 flex justify-center">
            <ActionButton className="button">Start 14-day free trial</ActionButton>
          </div>
          <p className="mt-4 text-xs text-faint">
            Read more: <Link className="underline" href="/blog/ai-features-for-bookstack">AI in BookHost: what works today</Link>
          </p>
        </div>
      </article>
    </>
  );
}
