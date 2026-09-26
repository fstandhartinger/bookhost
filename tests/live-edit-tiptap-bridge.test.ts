import { describe, expect, it } from "vitest";
import { seedYdocFromHtml, htmlFromYdoc } from "@/lib/live-edit/tiptap-bridge";

// What actually round-trips through the app's real Tiptap extension set
// (lib/live-edit/extensions.ts, the same list the client editor uses) —
// this is the evidence behind REPORT.md's fidelity table, not a guess.
function roundTrip(html: string) {
  return htmlFromYdoc(seedYdocFromHtml(html));
}

describe("BookStack HTML <-> Yjs round trip (content fidelity)", () => {
  it("preserves headings, paragraphs and basic marks", () => {
    const out = roundTrip(
      "<h2>Title</h2><p>Some <strong>bold</strong> and <em>italic</em> and <u>underlined</u> text.</p>",
    );
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/<em>italic<\/em>/);
    expect(out).toMatch(/<u>underlined<\/u>/);
  });

  it("preserves links, lists, blockquotes and horizontal rules", () => {
    const out = roundTrip(
      '<p><a href="https://example.com">link</a></p><ul><li>one</li><li>two</li></ul><ol><li>a</li></ol><blockquote><p>quoted</p></blockquote><hr>',
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("<ul>");
    expect(out).toContain("<ol>");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<hr");
  });

  it("preserves basic tables", () => {
    const out = roundTrip(
      "<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>",
    );
    expect(out).toContain("<table>");
    expect(out).toMatch(/<td[^>]*>\s*<p>a<\/p>\s*<\/td>/);
    expect(out).toMatch(/<td[^>]*>\s*<p>d<\/p>\s*<\/td>/);
  });

  it("preserves code blocks with a language", () => {
    const out = roundTrip(
      '<pre><code class="language-js">const x = 1;</code></pre>',
    );
    expect(out).toContain("const x = 1;");
    expect(out).toMatch(/language-js/);
  });

  it("preserves images", () => {
    const out = roundTrip('<p><img src="https://example.com/a.png" alt="a"></p>');
    expect(out).toContain('src="https://example.com/a.png"');
  });

  it("downgrades a BookStack callout to a plain paragraph (known phase-1 gap)", () => {
    // Documents the exact loss the fidelity check in lib/live-edit/fidelity.ts
    // exists to prevent: without that guard, this is what would silently ship.
    const out = roundTrip('<p class="callout success">Careful!</p>');
    expect(out).not.toContain("callout");
    expect(out).toContain("Careful!");
  });

  it("never emits a script tag or javascript: link even if fed one", () => {
    const out = roundTrip(
      '<p><script>alert(1)</script><a href="javascript:alert(1)">x</a></p>',
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/javascript:/i);
  });
});
