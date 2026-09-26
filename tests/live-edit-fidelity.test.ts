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

  it("blocks pages with a details/summary collapsible section", () => {
    const html = "<details><summary>More</summary><p>hidden</p></details>";
    expect(fidelityBlockers(html, "wysiwyg").some((b) => /collapsible/.test(b.reason))).toBe(true);
  });

  it("blocks pages with a task list checkbox", () => {
    const html = '<ul><li><input type="checkbox" disabled> todo</li></ul>';
    expect(fidelityBlockers(html, "wysiwyg").some((b) => /task list/.test(b.reason))).toBe(true);
  });

  it("blocks equivalent HTML attributes regardless of quoting or spacing", () => {
    for (const html of [
      "<input type='checkbox'>",
      "<input TYPE = checkbox>",
      "<p style='color:red'>styled</p>",
      "<span STYLE = color:red>styled</span>",
      "<p class='callout warning'>Note</p>",
      "<p class = 'callout info'>Note</p>",
    ]) {
      const blockers = fidelityBlockers(html, "wysiwyg");
      expect(blockers.length, html).toBeGreaterThan(0);
    }
  });

  it("blocks pages with an embedded iframe", () => {
    const html = '<iframe src="https://example.com"></iframe>';
    expect(fidelityBlockers(html, "wysiwyg").some((b) => /embed/.test(b.reason))).toBe(true);
  });

  it("blocks pages with inline text styling", () => {
    for (const html of [
      '<p style="color: red">warning</p>',
      '<p style="text-align: center">centered</p>',
      '<span style="font-size: 18px">big</span>',
    ]) {
      expect(fidelityBlockers(html, "wysiwyg").some((b) => /custom text styling/.test(b.reason))).toBe(true);
    }
  });

  it("does not false-positive on unrelated content containing similar substrings", () => {
    expect(
      fidelityBlockers('<p class="my-callout-widget">Not a real callout</p>', "wysiwyg"),
    ).toEqual([]);
    expect(fidelityBlockers("<p>Price: {{ not an include }}</p>", "wysiwyg")).toEqual(
      [],
    );
    expect(fidelityBlockers('<p data-style="fancy">no real style attr</p>', "wysiwyg")).toEqual(
      [],
    );
  });

  it("reports every blocker present, not just the first", () => {
    const html = '<div drawio-diagram="1"></div><p>{{@1}}</p>';
    const blocks = fidelityBlockers(html, "markdown");
    expect(blocks.length).toBe(3);
  });
});
