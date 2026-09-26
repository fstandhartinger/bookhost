// Single source for the agent connection instructions shown on /agents, in
// /llms-full.txt, in the dashboard and in the MCP guide. Every client listed
// here was checked against its own current documentation on 2026-09-26;
// clients that need OAuth (claude.ai web connectors, ChatGPT) are listed as
// not yet supported rather than guessed.
export const AGENT_DOCS_CHECKED = "2026-09-26";
export const EXAMPLE_MCP_URL = "https://your-team.bookhost.co/mcp";

export type ClientConfig = {
  id: string;
  name: string;
  status: "supported" | "bridge" | "not-yet";
  summary: string;
  snippet?: string;
  language?: string;
  docs: { label: string; href: string }[];
};

export function clientConfigs(url = EXAMPLE_MCP_URL): ClientConfig[] {
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      status: "supported",
      summary:
        "One command. Put the token in an environment variable first so it does not end up in your shell history.",
      language: "bash",
      snippet: `export BOOKHOST_TOKEN="<token id>:<token secret>"
claude mcp add --transport http --scope user bookhost ${url} \\
  --header "Authorization: Bearer $BOOKHOST_TOKEN"`,
      docs: [{ label: "Claude Code: MCP", href: "https://code.claude.com/docs/en/mcp" }],
    },
    {
      id: "cursor",
      name: "Cursor",
      status: "supported",
      summary: "Add the server to ~/.cursor/mcp.json (or .cursor/mcp.json in a project). Cursor reads the token from your environment.",
      language: "json",
      snippet: `{
  "mcpServers": {
    "bookhost": {
      "url": "${url}",
      "headers": {
        "Authorization": "Bearer \${env:BOOKHOST_TOKEN}"
      }
    }
  }
}`,
      docs: [{ label: "Cursor: MCP", href: "https://cursor.com/docs/mcp" }],
    },
    {
      id: "vscode",
      name: "VS Code (GitHub Copilot agent mode)",
      status: "supported",
      summary: "Add .vscode/mcp.json. VS Code asks for the token once and stores it securely.",
      language: "json",
      snippet: `{
  "inputs": [
    {
      "type": "promptString",
      "id": "bookhost-token",
      "description": "BookHost agent token (token id:token secret)",
      "password": true
    }
  ],
  "servers": {
    "bookhost": {
      "type": "http",
      "url": "${url}",
      "headers": {
        "Authorization": "Bearer \${input:bookhost-token}"
      }
    }
  }
}`,
      docs: [{ label: "VS Code: MCP configuration", href: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration" }],
    },
    {
      id: "codex",
      name: "OpenAI Codex CLI",
      status: "supported",
      summary: "Codex adds the \"Bearer \" prefix itself, so the variable holds only <token id>:<token secret>.",
      language: "bash",
      snippet: `export BOOKHOST_TOKEN="<token id>:<token secret>"
codex mcp add bookhost --url ${url} --bearer-token-env-var BOOKHOST_TOKEN

# or in ~/.codex/config.toml:
# [mcp_servers.bookhost]
# url = "${url}"
# bearer_token_env_var = "BOOKHOST_TOKEN"`,
      docs: [{ label: "Codex: MCP", href: "https://developers.openai.com/codex/mcp" }],
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      status: "bridge",
      summary:
        "Works through the open-source mcp-remote bridge (needs Node.js). Add this to claude_desktop_config.json and restart Claude Desktop. Keep \"Authorization:${AUTH_HEADER}\" without a space, as the mcp-remote README recommends.",
      language: "json",
      snippet: `{
  "mcpServers": {
    "bookhost": {
      "command": "npx",
      "args": ["mcp-remote", "${url}", "--header", "Authorization:\${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer <token id>:<token secret>" }
    }
  }
}`,
      docs: [
        { label: "mcp-remote README", href: "https://github.com/geelen/mcp-remote" },
        { label: "Claude: custom connectors", href: "https://claude.com/docs/connectors/custom/add-unlisted" },
      ],
    },
    {
      id: "claude-web",
      name: "claude.ai custom connectors",
      status: "not-yet",
      summary:
        "claude.ai connectors sign in with OAuth; sending a fixed API token is a limited beta there. BookHost adds OAuth sign-in in a later phase. Until then use Claude Code or Claude Desktop.",
      docs: [{ label: "Claude: connector authentication", href: "https://claude.com/docs/connectors/building/authentication" }],
    },
    {
      id: "chatgpt",
      name: "ChatGPT connectors",
      status: "not-yet",
      summary:
        "ChatGPT's custom MCP connectors support OAuth or no authentication, not a fixed API token. BookHost adds OAuth sign-in in a later phase.",
      docs: [{ label: "OpenAI: developer mode", href: "https://developers.openai.com/api/docs/guides/developer-mode" }],
    },
  ];
}

export const inspectorCommand = (url = EXAMPLE_MCP_URL) =>
  `npx @modelcontextprotocol/inspector --cli ${url} --transport http \\
  --header "Authorization: Bearer $BOOKHOST_TOKEN" --method tools/list`;

export const AGENT_TOOLS: { name: string; access: "read" | "write"; summary: string }[] = [
  { name: "search", access: "read", summary: "Full-text search with BookStack filters such as [tag=value] or {type:page}." },
  { name: "list_shelves", access: "read", summary: "Shelves the agent's BookStack user can see." },
  { name: "list_books", access: "read", summary: "Books, optionally only those on one shelf." },
  { name: "get_book", access: "read", summary: "One book with its chapter and page tree." },
  { name: "read_page", access: "read", summary: "A page as Markdown or plain text, with tags, revision count, last editor and URL." },
  { name: "get_page_revisions", access: "read", summary: "Revision count, created/updated by and when, and the link to the full history." },
  { name: "list_attachments", access: "read", summary: "Files and links attached to a page." },
  { name: "read_attachment", access: "read", summary: "Text attachments up to 2 MB (binary files are not returned)." },
  { name: "create_page", access: "write", summary: "New page from Markdown — a proposal or a direct edit, depending on the write mode." },
  { name: "update_page", access: "write", summary: "Replace a page's content, with a revision check against concurrent human edits." },
  { name: "append_to_page", access: "write", summary: "Add a section to the end of a page." },
  { name: "propose_change", access: "write", summary: "Always send a change to the review queue, even when direct edits are allowed." },
  { name: "add_comment", access: "write", summary: "Comment on a page (only in Direct mode)." },
];

export const WRITE_MODE_TEXT = {
  off: { label: "Off", text: "Agents can only read." },
  propose: {
    label: "Propose only (default)",
    text: "Agent edits arrive as drafts in the document intake review queue, clearly marked as agent proposals. An owner or admin approves or rejects each one; nothing changes before that.",
  },
  direct: {
    label: "Direct",
    text: "Agent edits are written straight to BookStack as the agent's own BookStack user, so they appear in the page's revision history under that name. BookStack permissions still decide what the agent may change.",
  },
} as const;
