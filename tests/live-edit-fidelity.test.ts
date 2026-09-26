import { describe, expect, it } from "vitest";
import { fidelityBlockers } from "@/lib/live-edit/fidelity";

describe("live edit content fidelity blockers", () => {
  it("allows plain wysiwyg content", () => {
    expect(
      fidelityBlockers("<p>Hello <strong>world</strong></p>", "wysiwyg"),
    ).toEqual([]);
  });

  it("blocks markdown-editor pages", () => {
    const blocks = fidelityBlockers("<p>hi</p>", "markdown");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].reason).toMatch(/Markdown editor/);
  });

  it("blocks pages with a diagrams.net drawing", () => {
    const html = '<div drawio-diagram="42"><img src="/x.png"></div>';
    const blocks = fidelityBlockers(html, "wysiwyg");
    expect(blocks.some((b) => /drawing/.test(b.reason))).toBe(true);
  });

  it("blocks pages with a page include", () => {
    for (const html of ["<p>{{@123}}</p>", "<p>{{@123#section-a}}</p>", "<p>{{@ 123}}</p>"]) {
      const blocks = fidelityBlockers(html, "wysiwyg");
      expect(blocks.some((b) => /includes content/.test(b.reason))).toBe(true);
    }
  });

  it("blocks pages with a callout box", () => {
    for (const kind of ["info", "success", "warning", "danger"]) {
      const html = `<p class="callout ${kind}">Note</p>`;
      const blocks = fidelityBlockers(html, "wysiwyg");
      expect(blocks.some((b) => /callout/.test(b.reason))).toBe(true);
    }
  });

  it("does not false-positive on unrelated content containing similar substrings", () => {
    expect(
      fidelityBlockers('<p class="my-callout-widget">Not a real callout</p>', "wysiwyg"),
    ).toEqual([]);
    expect(fidelityBlockers("<p>Price: {{ not an include }}</p>", "wysiwyg")).toEqual(
      [],
    );
  });

  it("reports every blocker present, not just the first", () => {
    const html = '<div drawio-diagram="1"></div><p>{{@1}}</p>';
    const blocks = fidelityBlockers(html, "markdown");
    expect(blocks.length).toBe(3);
  });
});
