---
title: "AI in BookHost: search with sources, MCP agents and drafts you approve"
description: "Three AI features are now available in every BookHost workspace and included in the €39 plan: answers that name their source pages, an MCP endpoint for Claude Code, Cursor, VS Code and Codex, and AI drafts an owner approves."
date: "2026-10-12"
author: "Florian Standhartinger"
tags: ["BookStack", "AI", "MCP"]
---

A team wiki only helps if people trust what is in it. That is the rule we followed when we added AI to BookHost: every AI answer has to show where it came from, and nothing an AI writes reaches your wiki without a person approving it. Three features that follow this rule are now **available in every workspace and included in the €39/month plan**. The full overview, with limits and data handling, is on our [AI page](https://bookhost.co/ai).

## 1. AI search with sources

Workspace owners and admins can ask the wiki a question in their own words. BookHost finds the matching passages, writes a short answer only from them and lists each page and section it used, with a link. When nothing fits, it says so instead of inventing an answer.

Here is a real example from our showcase workspace (fictional content). The question was "What should a new designer do in their first week?". The answer covered day one and the end of the week, and named two sources: *First week at Northwind › Day one* and *First week at Northwind › By the end of the week*.

Out of the box, search matches by words. An optional **matching by meaning** mode (beta) also finds pages whose wording differs from the question. An owner or admin turns it on per workspace, and turning it off deletes the index.

What it does not do yet: answer ordinary members within their own BookStack permissions. The answers are drawn from every page the workspace can read, so for now only owners and admins, who can already read everything, can ask. Member-scoped answers are planned.

## 2. Connect your AI agents over MCP

More and more documentation work happens in coding and chat agents. Every BookHost workspace has its own [Model Context Protocol](https://modelcontextprotocol.io/) server at `https://<your-workspace>.bookhost.co/mcp`. Claude Code, Cursor, VS Code (GitHub Copilot agent mode) and the Codex CLI connect to it directly. Claude Desktop connects through the `mcp-remote` bridge.

We designed it so you can switch it on without a security review meeting:

- **Each agent is its own BookStack user.** You choose its role, and your existing permissions decide what it can read and change.
- **Propose only is the default.** When an agent edits a page, the change goes to the review queue as an agent proposal. Nothing changes until an owner or admin approves it. You can set a workspace to read-only or allow direct edits; direct edits appear in the page history under the agent's name.
- **Kill switch, rate limits, activity log.** One button revokes every agent token. Each token has request and write limits. The log records which tool was used, never page content.

We tested it end to end on 12 October 2026. Claude Code listed the books and found the onboarding page. The Codex CLI appended a line to a page, and the change appeared in the review queue as a proposal instead of on the page. Setup takes about two minutes: create an agent in the dashboard, copy its token, add one command or config block to your client. The [agent setup guide](https://bookhost.co/agents) has the exact configuration for each client.

claude.ai and ChatGPT web connectors require OAuth sign-in. That is planned and not available yet.

## 3. AI drafts with approval

Upload a PDF, DOCX, Markdown or TXT file and pick a book. BookHost drafts a wiki page with a summary, tags and a reviewer checklist. Your team edits it, and an owner or admin publishes it to BookStack. AI drafts can contain mistakes, which is why a person always decides.

## Where the data goes

The wiki, its database and backups run on Hetzner infrastructure in Germany or Finland. AI search, drafts and matching by meaning use one AI provider: TensorX in Dublin, Ireland, with documented GPU infrastructure in Dublin and Helsinki and zero retention of prompts and completions under its data processing agreement. There is no other provider and no free-model fallback. Only what a feature needs is sent, and only when someone uses it. Agent access over MCP involves no AI provider of ours at all, because your content goes only to the agent you connect. TensorX is listed in annex 3 of our [data processing agreement](https://bookhost.co/legal/avv).

## What is next

These items are planned and have no committed date: answers for every member within their own permissions, sending documents by email, OAuth for web connectors and finer per-agent scopes. Matching by meaning and our real-time Live Edit overlay stay in beta for now.

You can try all of it for 14 days without a card. [Start a free trial](https://bookhost.co/pricing) or read the [AI overview](https://bookhost.co/ai).
