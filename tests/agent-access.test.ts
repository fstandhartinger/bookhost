import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
import { parseToken, requestHost } from "@/lib/agents/access";
import { markdownToHtml } from "@/lib/agents/markdown";
import { parseEntries } from "@/lib/agents/public-llms";
import { randomToken } from "@/lib/agents/manage";
import { toolsFor } from "@/lib/agents/tools";
import { handleMcp } from "@/lib/agents/mcp";

const req = (host: string) =>
  new Request("https://x/mcp", { headers: { host } });

describe("agent access helpers", () => {
  it("accepts only BookStack-shaped bearer tokens and never exposes the secret", () => {
    const id = "a".repeat(32);
    const secret = "b".repeat(32);
    const parsed = parseToken(`Bearer ${id}:${secret}`)!;
    expect(parsed.token).toBe(`${id}:${secret}`);
    expect(parsed.fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(parsed.fingerprint).not.toContain(secret.slice(0, 6));
    expect(parseToken(`Token ${id}:${secret}`)).not.toBeNull();
    for (const bad of [
      null,
      "",
      `Bearer ${id}`,
      `Bearer ${id}:${secret} extra`,
      `Basic ${id}:${secret}`,
      `Bearer ${id}:bad!secret-${secret}`,
    ])
      expect(parseToken(bad)).toBeNull();
  });

  it("serves agent endpoints only on workspace subdomains", () => {
    expect(requestHost(req("acme.bookhost.co"))).toBe("acme.bookhost.co");
    expect(requestHost(req("ACME.bookhost.co:443"))).toBe("acme.bookhost.co");
    expect(requestHost(req("demo.wissen.app.mintapis.com"))).toBe(
      "demo.wissen.app.mintapis.com",
    );
    for (const host of [
      "bookhost.co",
      "www.bookhost.co",
      "evil.example.com",
      "a.b.bookhost.co",
      "bookhost.co.evil.com",
    ])
      expect(requestHost(req(host))).toBeNull();
  });

  it("renders agent Markdown without raw HTML, scripts or unsafe links", () => {
    const html = markdownToHtml(
      "# Title\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://example.com)\n\n<img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).not.toMatch(/script|onerror|javascript:/i);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<table>");
  });

  it("parses only same-host book and page links from BookStack listings", () => {
    const html = `
      <a href="https://acme.bookhost.co/books/handbook" class="book entity-list-item" data-entity-type="book" data-entity-id="3"><h4 class="entity-list-item-name break-text">Hand &amp; book</h4></a>
      <a href="https://evil.example/books/x" class="book entity-list-item" data-entity-type="book" data-entity-id="4"><h4 class="entity-list-item-name">Evil</h4></a>
      <a href="https://acme.bookhost.co/settings" class="book entity-list-item" data-entity-type="book" data-entity-id="5"><h4 class="entity-list-item-name">Settings</h4></a>`;
    expect(parseEntries(html, "acme.bookhost.co")).toEqual([
      {
        type: "book",
        id: 3,
        url: "https://acme.bookhost.co/books/handbook",
        name: "Hand & book",
      },
    ]);
  });

  it("generates uniform alphanumeric BookStack token parts", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(new Set(Array.from({ length: 50 }, () => randomToken())).size).toBe(
      50,
    );
  });

  it("offers write tools by mode and comments only in direct mode", () => {
    const names = (mode: "off" | "propose" | "direct") =>
      toolsFor(mode).map((t) => t.name);
    expect(names("off")).not.toContain("create_page");
    expect(names("off")).toContain("read_page");
    expect(names("propose")).toEqual(
      expect.arrayContaining([
        "create_page",
        "update_page",
        "append_to_page",
        "propose_change",
      ]),
    );
    expect(names("propose")).not.toContain("add_comment");
    expect(names("direct")).toContain("add_comment");
  });

  it("answers GET with a human hint and 404s on non-workspace hosts", async () => {
    const res = await handleMcp(
      new Request("https://bookhost.co/mcp", {
        method: "POST",
        headers: { host: "bookhost.co" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(404);
    const options = await handleMcp(
      new Request("https://acme.bookhost.co/mcp", {
        method: "OPTIONS",
        headers: { host: "acme.bookhost.co" },
      }),
    );
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-headers")).toMatch(
      /Authorization/,
    );
  });
});
