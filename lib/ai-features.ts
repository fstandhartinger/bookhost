// One source of truth for what the AI features can do today. The homepage
// cards, /ai and llms.txt read from here so a status change is one edit.
// Only "available" may be described as working; keep this list honest.
import { QUOTAS } from "./quotas";

export type AiStatus = "available" | "beta" | "planned";

export const AI_STATUS_LABEL: Record<AiStatus, string> = {
  available: "Available",
  beta: "Beta",
  planned: "Planned",
};

export type AiFeature = {
  id: string;
  title: string;
  status: AiStatus;
  summary: string;
  href: string;
};

export const AI_FEATURES: AiFeature[] = [
  {
    id: "search",
    title: "AI search with sources",
    status: "available",
    summary:
      "Ask your wiki a question in plain language. The answer is written only from your own pages and names the page and section it came from; if nothing fits, it says so instead of guessing.",
    href: "/ai#search",
  },
  {
    id: "agents",
    title: "Connect your AI agents (MCP)",
    status: "available",
    summary:
      "Every workspace has its own MCP endpoint for Claude Code, Cursor, VS Code, Codex and Claude Desktop. Each agent is its own BookStack user, so your roles decide what it sees.",
    href: "/ai#agents",
  },
  {
    id: "drafts",
    title: "AI drafts with approval",
    status: "available",
    summary:
      "Upload a PDF, DOCX, Markdown or TXT file and get a page draft with summary, tags and a reviewer checklist. Nothing is published until an owner or admin approves it.",
    href: "/ai#drafts",
  },
];

/** Smaller pieces whose status differs from the three headline features. */
export const AI_DETAILS: { title: string; status: AiStatus; text: string }[] = [
  {
    title: "Matching by meaning",
    status: "beta",
    text: "Semantic search that finds a page even when the question shares no word with it. Off until an owner or admin turns it on for the workspace with one click; turning it off deletes the index.",
  },
  {
    title: "Live Edit",
    status: "beta",
    text: "Real-time collaborative editing overlay for BookStack pages (no AI involved). Off by default per workspace.",
  },
  {
    title: "Answers for every member, scoped to their own permissions",
    status: "planned",
    text: "Today only owners and admins can ask the wiki, because answers are drawn from every page the workspace can read.",
  },
  {
    title: "Documents by email",
    status: "planned",
    text: "Forwarding a document to a workspace address instead of uploading it.",
  },
  {
    title: "OAuth sign-in for claude.ai and ChatGPT connectors",
    status: "planned",
    text: "Web connectors need OAuth; until then use Claude Code, Claude Desktop, Cursor, VS Code or Codex.",
  },
  {
    title: "Per-agent scopes beyond BookStack roles",
    status: "planned",
    text: "Today an agent is limited by its BookStack role and the workspace write mode.",
  },
];

export const AI_PLANNED_NOTE =
  "Planned items have no committed release date and are not available today.";

export const AI_LIMITS = [
  `${QUOTAS.trialChatQuestions} AI answers during the trial, ${QUOTAS.monthlyChatQuestions} per calendar month (UTC) on Team, shared by the workspace. Questions that fail are not counted.`,
  `${QUOTAS.trialDrafts} AI drafts during the trial, ${QUOTAS.monthlyDrafts} per calendar month (UTC) on Team.`,
  "Up to 20 questions per person per minute and 200 per workspace per hour.",
  "Agent tokens: 120 requests per minute, 1,500 per hour and 60 writes per hour each; up to 20 active agents per workspace.",
  "Uploads up to 10 MB and 60,000 extracted characters; scanned PDFs need OCR first.",
];
