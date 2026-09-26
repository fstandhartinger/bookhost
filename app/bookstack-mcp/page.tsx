import type { Metadata } from "next";
import Link from "next/link";
import { GuideFaq, GuidePage, GuideSources } from "@/components/guide-page";
import { JsonLd } from "@/components/json-ld";
import { clientConfigs } from "@/lib/agent-docs";
import {
  GUIDE_REVIEWED,
  guide,
  guideJsonLd,
  guideMetadata,
  relatedLinks,
  type Faq,
} from "@/lib/guides";

const slug = "bookstack-mcp";
export const metadata: Metadata = guideMetadata(slug);

const faqs: Faq[] = [
  {
    question: "Can ChatGPT or claude.ai connect to a BookHost wiki today?",
    answer:
      "Not yet. ChatGPT connectors and claude.ai web connectors expect the MCP server to offer OAuth sign-in, and BookHost currently authenticates agents with a BookStack API token. OAuth sign-in is planned, without a committed date. Claude Code, Cursor, VS Code and the Codex CLI work today, and Claude Desktop works through the open-source mcp-remote bridge.",
  },
  {
    question: "Can an agent see pages that its user is not allowed to see?",
    answer:
      "No. Every call runs as the BookStack user that owns the token, and BookStack applies that user's role and book, chapter and page permissions. Give an agent a role that only covers the books it needs.",
  },
  {
    question: "Can an agent change or delete our pages?",
    answer:
      "Only if you allow it. The default write mode is Propose only: agent edits become drafts in the review queue and change nothing until an owner or admin approves them. In Direct mode edits go straight to BookStack under the agent's own user and show up in the revision history. There is no delete tool.",
  },
  {
    question: "Does BookHost send our wiki content to an AI model for this?",
    answer:
      "No. For agent access, BookHost passes requests to your BookStack workspace and returns the result to the MCP client you connected. Which AI provider then sees the content depends on the client you choose, and that transfer is your responsibility. BookHost logs metadata only: tool, page id, result and latency.",
  },
  {
    question: "Can I do this with a self-hosted BookStack?",
    answer:
      "Yes. BookStack has a documented REST API, and you can run an MCP server that uses it yourself, for example a community project or your own code. You then look after hosting it, keeping it updated, securing the token and deciding how agent writes are reviewed.",
  },
];

const sources = [
  {
    href: "https://modelcontextprotocol.io/specification/2025-11-25",
    label: "Model Context Protocol: specification 2025-11-25",
  },
  {
    href: "https://demo.bookstackapp.com/api/docs",
    label: "BookStack: API documentation",
  },
  { href: "https://llmstxt.org", label: "llmstxt.org: the llms.txt proposal" },
  ...clientConfigs().flatMap((client) => client.docs),
];

export default function BookstackMcpPage() {
  const { title } = guide(slug);
  return (
    <>
      <JsonLd data={guideJsonLd(slug, faqs)} />
      <GuidePage
        eyebrow="GUIDE · AI AGENTS"
        title={title}
        lede="AI agents are useful when they can read what your team already wrote down, and more useful when they can help keep it current. This guide explains how the Model Context Protocol connects agents to a BookStack wiki, which clients work with BookHost today, and how to keep people in charge of what gets published."
        updated={GUIDE_REVIEWED}
        related={[
          { href: "/agents", title: "Agent access documentation and setup" },
          ...relatedLinks(slug),
        ]}
      >
        <h2>Why connect agents to a team wiki</h2>
        <p>
          A coding agent that cannot see your runbooks guesses. A chat assistant
          that cannot see your procedures answers from the public internet. Most
          teams already keep the answers in a wiki; the problem is getting them
          to the agent without copying pages into every prompt.
        </p>
        <p>The useful jobs are ordinary ones:</p>
        <ul>
          <li>Look up the deployment checklist before changing a server.</li>
          <li>
            Answer a question from the handbook, with the page it came from.
          </li>
          <li>Draft or update a page after a change, for a human to review.</li>
          <li>Find pages that contradict each other or are out of date.</li>
        </ul>
        <p>
          The same wiki then serves people and agents. We call that a
          human-agent collaboration wiki: agents read and suggest, people
          decide.
        </p>

        <h2>What MCP is</h2>
        <p>
          The Model Context Protocol (MCP) is an open protocol that lets an AI
          application call tools on an external server. The server describes its
          tools, such as &ldquo;search&rdquo; or &ldquo;read page&rdquo;, and
          the client lets the model use them. A remote MCP server is reached
          over HTTP (the &ldquo;Streamable HTTP&rdquo; transport), so nothing
          has to be installed on the agent&rsquo;s machine except the client
          itself.
        </p>
        <p>
          MCP does not decide what an agent may see. That is up to the server
          and the credentials the client sends. For a wiki, the sensible answer
          is to reuse the permissions the wiki already has.
        </p>

        <h2>What BookHost offers (beta)</h2>
        <p>
          Every BookHost workspace has its own MCP server at{" "}
          <code>https://&lt;workspace&gt;.bookhost.co/mcp</code>. Agents
          authenticate with a BookStack API token sent as{" "}
          <code>
            Authorization: Bearer &lt;token id&gt;:&lt;token secret&gt;
          </code>
          . In the dashboard, owners and admins create a dedicated agent user
          with a BookStack role of their choice; the token is shown once and can
          be revoked at any time.
        </p>
        <p>
          The server offers read tools (search, shelves, books, pages,
          revisions, attachments) and, depending on the write mode, tools to
          create, update and append to pages or send a change for review. The
          full list and the configuration for each client are on the{" "}
          <Link href="/agents">agent access page</Link>.
        </p>

        <h3>Which clients work today</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Claude Code</td>
              <td>Supported: one command with the token in a header.</td>
            </tr>
            <tr>
              <td>Cursor</td>
              <td>Supported through its mcp.json file.</td>
            </tr>
            <tr>
              <td>VS Code (GitHub Copilot agent mode)</td>
              <td>Supported through .vscode/mcp.json.</td>
            </tr>
            <tr>
              <td>OpenAI Codex CLI</td>
              <td>
                Supported with a bearer token from an environment variable.
              </td>
            </tr>
            <tr>
              <td>Claude Desktop</td>
              <td>
                Works through the open-source mcp-remote bridge, which needs
                Node.js.
              </td>
            </tr>
            <tr>
              <td>claude.ai web connectors</td>
              <td>
                Not available yet. They sign in with OAuth, which BookHost does
                not offer yet.
              </td>
            </tr>
            <tr>
              <td>ChatGPT connectors</td>
              <td>
                Not available yet. They support OAuth or no authentication, not
                a fixed API token.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          To say it plainly: despite the title of this guide, ChatGPT and the
          claude.ai website cannot connect to a BookHost wiki today. OAuth
          sign-in is planned, without a committed release date. If you use
          OpenAI or Anthropic models, the Codex CLI and Claude Code or Claude
          Desktop are the working routes for now.
        </p>

        <h2>The security model</h2>
        <ul>
          <li>
            <strong>The agent is a BookStack user.</strong> Every call runs as
            the user that owns the token, with that user&rsquo;s role and
            permissions. Admin and guest roles cannot be given to agents created
            in the dashboard.
          </li>
          <li>
            <strong>A token works on one workspace.</strong> The workspace is
            chosen by the address, never by the token.
          </li>
          <li>
            <strong>Limits and switches.</strong> 120 requests per minute, 1,500
            per hour and 60 writes per hour per token. Owners and admins can
            revoke one token or switch agent access off for the whole workspace.
          </li>
          <li>
            <strong>An activity log without content.</strong> It records the
            tool, the page id, the result and the latency, never page content,
            search terms or tokens.
          </li>
          <li>
            <strong>Page content is untrusted input.</strong> Anyone who can
            edit a page can write text aimed at an AI. The server labels page
            content as data, not instructions, but no server can guarantee how a
            model reacts. Be careful with agents that can also act on other
            systems.
          </li>
          <li>
            <strong>No AI processing by BookHost.</strong> BookHost does not
            send page content to an AI model for this feature. It goes to the
            client you connect, and from there to whichever AI provider that
            client uses, which you choose and are responsible for.
          </li>
        </ul>

        <h2>Reviewing agent edits: &ldquo;Propose only&rdquo;</h2>
        <p>
          Each workspace has one write mode: <strong>Off</strong> (read only),{" "}
          <strong>Propose only</strong> (the default) or <strong>Direct</strong>
          . In Propose only, an agent that creates or updates a page does not
          touch BookStack. Its change arrives in the same review queue as
          uploaded documents, marked as an agent proposal. An owner or admin
          reads it, edits it if needed, and approves or rejects it.
        </p>
        <p>
          Direct mode suits agents you trust for a narrow job, such as keeping a
          generated reference page current. Their edits appear in the
          page&rsquo;s revision history under the agent&rsquo;s own name, so you
          can see and roll back what they did. An agent can still send an
          individual change to review with <code>propose_change</code>.
        </p>

        <h2>The self-hosted alternative</h2>
        <p>
          If you run BookStack yourself, you do not need BookHost for this.
          BookStack has a documented REST API with token authentication, and
          there are community MCP servers for BookStack that you can run next to
          your instance, or you can write a small one yourself. Check any
          third-party server&rsquo;s code before giving it a token.
        </p>
        <p>With a self-run server, the following is your job:</p>
        <ul className="checklist">
          <li>
            Hosting the MCP server over HTTPS, or running it locally per user.
          </li>
          <li>Creating a limited BookStack role and user for the agent.</li>
          <li>Storing and rotating tokens.</li>
          <li>Rate limiting and logging without storing page content.</li>
          <li>Deciding how agent edits are reviewed before they go live.</li>
        </ul>
        <p>
          The trade-offs of running BookStack itself are in our{" "}
          <Link href="/self-hosted-vs-managed-bookstack">
            self-hosted vs managed comparison
          </Link>
          .
        </p>

        <h2>llms.txt: a map for agents</h2>
        <p>
          Besides MCP, each workspace publishes an{" "}
          <a href="https://llmstxt.org" rel="noopener">
            llms.txt
          </a>{" "}
          file at <code>https://&lt;workspace&gt;.bookhost.co/llms.txt</code>.
          It tells an agent where the MCP endpoint is and how to authenticate.
          It lists books and pages only if the workspace allows logged-out
          access, and then only what a logged-out visitor can see.
        </p>

        <GuideFaq faqs={faqs} />
        <GuideSources sources={sources} />
      </GuidePage>
    </>
  );
}
