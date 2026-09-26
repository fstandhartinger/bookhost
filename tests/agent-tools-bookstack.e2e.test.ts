import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
import { UserBookStack } from "@/lib/agents/bookstack-user";
import { TOOLS, type ToolContext } from "@/lib/agents/tools";

// Opt-in check of every tool against a real, throwaway local BookStack
// (LOCAL_BOOKSTACK_E2E=<fixture.json> with base URL LOCAL_BOOKSTACK_URL).
const FIXTURE = process.env.LOCAL_BOOKSTACK_E2E;
const BASE = process.env.LOCAL_BOOKSTACK_URL || "http://127.0.0.1:18480";
const HOST = "e2e.bookhost.co";
const local: typeof fetch = (input, init) =>
  fetch(String(input).replace(`https://${HOST}`, BASE), init);

describe.skipIf(!FIXTURE)(
  "agent tools against a real BookStack",
  { timeout: 60000 },
  () => {
    const fx = FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};
    const ctx = (token: string): ToolContext => ({
      workspace: {
        id: "t",
        team_id: "team",
        slug: "e2e",
        host: HOST,
        running: true,
      },
      client: new UserBookStack(HOST, token, local),
      mode: "direct",
      identity: { agentId: null, label: "e2e" },
      fingerprint: "000000000000",
    });
    const run = (
      name: string,
      args: Record<string, unknown>,
      token = fx.Claude.token,
    ) => TOOLS.find((t) => t.name === name)!.run(args, ctx(token));

    it("reads shelves, books, the book tree, pages, revisions, attachments and search", async () => {
      expect(
        JSON.parse((await run("list_shelves", {})).text).shelves,
      ).toBeDefined();
      const books = JSON.parse((await run("list_books", {})).text);
      expect(books.books.map((b: { name: string }) => b.name)).toContain(
        "Team handbook",
      );
      const tree = JSON.parse(
        (await run("get_book", { book_id: fx.book })).text,
      );
      expect(tree.contents.map((c: { name: string }) => c.name)).toEqual(
        expect.arrayContaining(["Onboarding", "Salary bands"]),
      );
      const page = (await run("read_page", { page_id: fx.open_page })).text;
      expect(page).toContain("Welcome aboard");
      expect(page).toContain('"revision_count"');
      const revisions = JSON.parse(
        (await run("get_page_revisions", { page_id: fx.open_page })).text,
      );
      expect(revisions.revisions_url).toMatch(/\/revisions$/);
      const attachments = JSON.parse(
        (await run("list_attachments", { page_id: fx.open_page })).text,
      );
      expect(attachments.attachments[0]).toMatchObject({
        name: "notes.txt",
        kind: "link",
      });
      const link = JSON.parse(
        (
          await run("read_attachment", {
            attachment_id: attachments.attachments[0].id,
          })
        ).text,
      );
      expect(link.link).toBe("https://example.com/notes");
      const search = JSON.parse(
        (await run("search", { query: "Onboarding", type: "page" })).text,
      );
      expect(search.results.length).toBeGreaterThan(0);
    });

    it("a Viewer agent cannot see the restricted page, even via search", async () => {
      await expect(
        run("read_page", { page_id: fx.secret_page }, fx.Reader.token),
      ).rejects.toThrow(/Not found/);
      const search = (await run("search", { query: "salary" }, fx.Reader.token))
        .text;
      expect(search).not.toContain("CONFIDENTIAL");
      const tree = (
        await run("get_book", { book_id: fx.book }, fx.Reader.token)
      ).text;
      expect(tree).not.toContain("Salary bands");
      await expect(
        run(
          "create_page",
          { book_id: fx.book, name: "Nope", markdown: "x" },
          fx.Reader.token,
        ),
      ).rejects.toThrow(/not allowed|403|Not found/);
    });

    it("direct writes land as the agent user with revision checks, appends and comments", async () => {
      const created = JSON.parse(
        (
          await run("create_page", {
            book_id: fx.book,
            name: "Agent notes",
            markdown: "First line",
            tags: [{ name: "source", value: "agent" }],
          })
        ).text,
      );
      expect(created.result).toBe("created");
      const appended = JSON.parse(
        (
          await run("append_to_page", {
            page_id: created.page_id,
            markdown: "## Added\n\nSecond line",
          })
        ).text,
      );
      expect(appended.revision_count).toBe(created.revision_count + 1);
      const content = (await run("read_page", { page_id: created.page_id }))
        .text;
      expect(content).toContain("First line");
      expect(content).toContain("Second line");
      expect(content).toContain('"updated_by": "Claude (agent)"');
      await expect(
        run("update_page", {
          page_id: created.page_id,
          markdown: "x",
          expected_revision_count: 1,
        }),
      ).rejects.toThrow(/changed since you read it/);
      const updated = JSON.parse(
        (
          await run("update_page", {
            page_id: created.page_id,
            markdown: "Rewritten",
            expected_revision_count: appended.revision_count,
          })
        ).text,
      );
      expect(updated.result).toBe("updated");
      // BookStack's default Editor role has no comment permission: the agent
      // gets exactly the refusal its BookStack user would get.
      await expect(
        run("add_comment", {
          page_id: created.page_id,
          markdown: "Looks good",
        }),
      ).rejects.toThrow(/not allowed to do this \(403\)/);
      // Appending to a WYSIWYG page keeps its HTML and adds rendered Markdown.
      const wysiwyg = JSON.parse(
        (
          await run("create_page", {
            book_id: fx.book,
            name: "HTML page",
            markdown: "x",
          })
        ).text,
      );
      await fetch(`${BASE}/api/pages/${wysiwyg.page_id}`, {
        method: "PUT",
        headers: {
          Authorization: `Token ${fx.seed}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ html: "<p>Original <strong>html</strong></p>" }),
      });
      await run("append_to_page", {
        page_id: wysiwyg.page_id,
        markdown: "- item one",
      });
      const html = (await run("read_page", { page_id: wysiwyg.page_id })).text;
      expect(html).toContain("Original **html**");
      expect(html).toContain("item one");
    });
  },
);
