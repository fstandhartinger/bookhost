import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import {
  AGENT_DOCS_CHECKED,
  AGENT_TOOLS,
  WRITE_MODE_TEXT,
  clientConfigs,
  inspectorCommand,
  type ClientConfig,
} from "@/lib/agent-docs";
import { PUBLIC_BASE_URL } from "@/lib/config";

const title = "Connect AI agents to your BookHost wiki (MCP)";
const description =
  "Connect Claude Code, Cursor, VS Code or Codex to your BookStack wiki over MCP. Agents use their own BookStack user and permissions; edits wait for approval by default.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/agents" },
  openGraph: {
    title: `${title} · BookHost`,
    description,
    url: "/agents",
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

const STATUS_LABEL: Record<ClientConfig["status"], string> = {
  supported: "Supported",
  bridge: "Via bridge",
  "not-yet": "Not yet — needs OAuth",
};

const checked = new Date(`${AGENT_DOCS_CHECKED}T00:00:00Z`).toLocaleDateString(
  "en-GB",
  { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
);

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: PUBLIC_BASE_URL },
    {
      "@type": "ListItem",
      position: 2,
      name: title,
      item: `${PUBLIC_BASE_URL}/agents`,
    },
  ],
};

export default function AgentsDocsPage() {
  const clients = clientConfigs();
  return (
    <>
      <JsonLd data={breadcrumb} />
      <article className="section mx-auto max-w-3xl">
        <p className="eyebrow">AGENT ACCESS · MCP · BETA</p>
        <h1>{title}</h1>
        <p className="lede">
          Every BookHost workspace has its own MCP server. Coding and chat
          agents such as Claude Code, Cursor, VS Code and Codex can search and
          read your BookStack wiki through it and, if you allow it, propose or
          make changes. Each agent works as its own BookStack user, so your
          existing permissions decide what it sees.
        </p>
        <p className="mt-5 text-sm text-muted">
          Beta. Client instructions checked against each client&rsquo;s own
          documentation on <time dateTime={AGENT_DOCS_CHECKED}>{checked}</time>.
        </p>

        <div className="prose-guide mt-12">
          <h2 id="what">What it is</h2>
          <p>
            A team wiki is where people write down how things work. Agents are
            now doing part of that work too: answering questions from the
            documentation, drafting runbooks after a change, keeping a page in
            step with the code. Agent access makes your BookStack workspace a
            shared place for both, with humans in control of what gets
            published.
          </p>
          <ul>
            <li>
              <strong>Endpoint:</strong>{" "}
              <code>https://&lt;your-workspace&gt;.bookhost.co/mcp</code> (Model
              Context Protocol, Streamable HTTP).
            </li>
            <li>
              <strong>Authentication:</strong>{" "}
              <code>
                Authorization: Bearer &lt;token id&gt;:&lt;token secret&gt;
              </code>{" "}
              — a BookStack API token of a user in that workspace.
            </li>
            <li>
              <strong>Identity:</strong> every call runs as that BookStack user.
              BookStack&rsquo;s roles and book, chapter and page permissions
              apply exactly as they do for a person.
            </li>
            <li>
              <strong>Writes:</strong> by default, agent edits become proposals
              that an owner or admin approves in the review queue.
            </li>
          </ul>

          <h2 id="setup">Two-minute setup</h2>
          <ol>
            <li>
              <strong>Create an agent user.</strong> In the BookHost dashboard,
              open <strong>Agents</strong> (owners and admins only), create an
              agent, give it a name and pick the BookStack role that should
              limit what it can read and change. BookHost creates a dedicated
              BookStack user with API access and shows its token once. Copy it
              now; you can revoke it at any time.
            </li>
            <li>
              <strong>Add the server to your client.</strong> Copy the
              configuration for your client below and replace{" "}
              <code>your-team</code> with your workspace address. Keep the token
              in an environment variable or your client&rsquo;s secret store,
              not in a file you commit.
            </li>
            <li>
              <strong>Try it.</strong> Ask the agent: &ldquo;List the books in
              our wiki.&rdquo; It should answer with the books its BookStack
              user can see.
            </li>
          </ol>
          <p>
            You can also use an API token of an existing BookStack user, as long
            as that user&rsquo;s role has the <strong>Access system API</strong>{" "}
            permission. A dedicated agent user is easier to audit and to switch
            off.
          </p>

          <h2 id="clients">Client configuration</h2>
          <p>
            The examples use <code>https://your-team.bookhost.co/mcp</code>.
            Your dashboard shows the same snippets with your own address.
          </p>
          {clients.map((client) => (
            <section key={client.id} aria-labelledby={`client-${client.id}`}>
              <h3 id={`client-${client.id}`}>
                {client.name}{" "}
                <span className="badge align-middle">
                  {STATUS_LABEL[client.status]}
                </span>
              </h3>
              <p>{client.summary}</p>
              {client.snippet && (
                <pre>
                  <code>{client.snippet}</code>
                </pre>
              )}
              <p className="text-sm">
                Documentation:{" "}
                {client.docs.map((doc, i) => (
                  <span key={doc.href}>
                    {i > 0 && " · "}
                    <a href={doc.href} rel="noopener">
                      {doc.label}
                    </a>
                  </span>
                ))}
              </p>
            </section>
          ))}
          <h3 id="inspector">Test without an AI client</h3>
          <p>The official MCP Inspector lists the tools your token can use:</p>
          <pre>
            <code>{inspectorCommand()}</code>
          </pre>

          <h2 id="tools">Tools</h2>
          <p>
            Read tools are always available. Write tools appear only when the
            workspace allows writes (see write modes below).
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">Access</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                {AGENT_TOOLS.map((tool) => (
                  <tr key={tool.name}>
                    <td>
                      <code>{tool.name}</code>
                    </td>
                    <td>{tool.access === "read" ? "Read" : "Write"}</td>
                    <td>{tool.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 id="write-modes">Write modes</h2>
          <p>
            An owner or admin sets one write mode per workspace in the
            dashboard. It applies to every agent of that workspace.
          </p>
          <ul>
            {Object.entries(WRITE_MODE_TEXT).map(([key, mode]) => (
              <li key={key}>
                <strong>{mode.label}:</strong> {mode.text}
              </li>
            ))}
          </ul>
          <p>
            In every mode, BookStack permissions still apply: an agent whose
            role cannot edit a book cannot propose or make changes there either.
          </p>

          <h2 id="security">Security and privacy</h2>
          <ul>
            <li>
              <strong>Permissions are inherited.</strong> The agent sees and
              changes exactly what its BookStack user may. Give it a role with
              access only to the books it needs. Admin and guest roles cannot be
              assigned to dashboard-created agents.
            </li>
            <li>
              <strong>One token, one workspace.</strong> The workspace is chosen
              by the address you connect to, and a token only works on the
              workspace it belongs to.
            </li>
            <li>
              <strong>Page content is data, not instructions.</strong> A wiki
              page can contain text written to manipulate an AI (prompt
              injection). The server marks page content as untrusted, but your
              agent decides what to do with it. Review what an agent does with
              wiki content before you let it act on other systems, and keep the
              default review queue for writes.
            </li>
            <li>
              <strong>Rate limits per token:</strong> 120 requests per minute,
              1,500 per hour and 60 writes per hour.
            </li>
            <li>
              <strong>Metadata-only activity log.</strong> Owners and admins see
              which agent called which tool, on which page id, with what result
              and how long it took. The log never contains page content, search
              terms or tokens. Entries are deleted after 90 days.
            </li>
            <li>
              <strong>Kill switch.</strong> Revoke a single agent token, or
              switch agent access off for the whole workspace. Both take effect
              on the next request.
            </li>
            <li>
              <strong>No AI processing by BookHost.</strong> For this feature,
              BookHost does not send your page content to any AI model. Content
              goes only to the MCP client you connect. That client and the AI
              provider behind it are your choice, and you are responsible for
              that transfer under your own agreements with them.
            </li>
            <li>
              <strong>Hosting unchanged.</strong> Your wiki, its database and
              backups stay on Hetzner infrastructure in Germany or Finland.
            </li>
          </ul>
          <p>
            The binding German texts are in the{" "}
            <Link href="/legal/datenschutz">privacy policy</Link> and the{" "}
            <Link href="/legal/avv">data processing agreement</Link>.
          </p>

          <h2 id="llms-txt">llms.txt</h2>
          <p>
            <a href="https://llmstxt.org" rel="noopener">
              llms.txt
            </a>{" "}
            is a plain-text map of a site for language models. There are two:
          </p>
          <ul>
            <li>
              <a href="/llms.txt">bookhost.co/llms.txt</a> describes BookHost
              itself, and <a href="/llms-full.txt">/llms-full.txt</a> contains
              this documentation in full.
            </li>
            <li>
              <code>https://&lt;your-workspace&gt;.bookhost.co/llms.txt</code>{" "}
              lists the MCP endpoint, how to authenticate and a link to this
              page. It lists books and pages only if your workspace allows
              logged-out (guest) access, and then only what a logged-out visitor
              can already see.
            </li>
          </ul>

          <h2 id="troubleshooting">Troubleshooting</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Symptom</th>
                  <th scope="col">Likely cause</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>401 Unauthorized</td>
                  <td>
                    The token is missing, mistyped, deleted in BookStack or
                    belongs to another workspace, or the user&rsquo;s role lacks{" "}
                    <strong>Access system API</strong>. The header must be{" "}
                    <code>Bearer &lt;token id&gt;:&lt;token secret&gt;</code>{" "}
                    (Codex adds &ldquo;Bearer&rdquo; itself).
                  </td>
                </tr>
                <tr>
                  <td>403 Forbidden</td>
                  <td>
                    Agent access is switched off for the workspace, or this
                    agent token was revoked in the dashboard.
                  </td>
                </tr>
                <tr>
                  <td>429 Too Many Requests</td>
                  <td>
                    A rate limit was reached. Wait for the time given in{" "}
                    <code>Retry-After</code>.
                  </td>
                </tr>
                <tr>
                  <td>503 Service Unavailable</td>
                  <td>
                    The workspace is not running, for example after the trial or
                    subscription ended.
                  </td>
                </tr>
                <tr>
                  <td>Write tools missing</td>
                  <td>
                    The write mode is Off. <code>add_comment</code> appears only
                    in Direct mode.
                  </td>
                </tr>
                <tr>
                  <td>A book or page is missing</td>
                  <td>
                    The agent&rsquo;s BookStack role cannot see it. Adjust the
                    role or the book permissions in BookStack.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 id="not-yet">Not available yet</h2>
          <p>
            These are plans, not features. There is no committed release date.
          </p>
          <ul>
            <li>
              OAuth 2.1 sign-in, which claude.ai web connectors and ChatGPT
              connectors require. Until then those two cannot connect.
            </li>
            <li>A listing in the MCP registry.</li>
            <li>
              Per-agent scopes beyond BookStack roles, such as limiting one
              agent to certain tools.
            </li>
            <li>Events or webhooks that notify agents about wiki changes.</li>
          </ul>
          <p>
            Background and a comparison with self-hosted options are in our
            guide{" "}
            <Link href="/bookstack-mcp">
              Give Claude, Cursor and ChatGPT access to your team wiki
            </Link>
            .
          </p>
        </div>

        <section className="cta-panel mt-16" aria-labelledby="agents-cta">
          <h2 id="agents-cta">Try it on your own workspace</h2>
          <p className="mt-4 text-muted">
            Agent access is included in the Team plan. Start a 14-day trial
            without a card, then open Agents in the dashboard.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="button" href="/pricing">
              Start free trial
            </Link>
            <Link className="button-secondary" href="/app/agents">
              Open Agents in the dashboard
            </Link>
          </div>
        </section>
      </article>
    </>
  );
}
