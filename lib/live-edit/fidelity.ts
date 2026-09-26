// What survives the BookStack HTML <-> Tiptap round trip in phase 1, and what
// doesn't. Anything in `blockers` below loses real content or semantics
// (not just cosmetic formatting), so Live Edit refuses to open the page
// rather than silently degrade it. See REPORT.md "Content fidelity" for the
// full table this encodes.
export type FidelityBlock = {
  reason: string;
};

const CHECKS: { test: RegExp; reason: string }[] = [
  {
    // BookStack's diagrams.net (draw.io) embed: `<div drawio-diagram="...">`.
    // A generic Tiptap image node would keep the rendered PNG but permanently
    // lose the editable diagram source.
    test: /\bdrawio-diagram\b/i,
    reason:
      "This page contains a drawing (diagrams.net). Live Edit can't preserve editable drawings yet — edit this page in BookStack's normal editor.",
  },
  {
    // Page includes/transclusion: literal `{{@123}}` or `{{@123#section}}`
    // text, expanded at render time. Regex matches BookStack's own parser
    // (app/Entities/Tools/PageIncludeParser.php: `/{{@\s?([0-9].*?)}}/`).
    test: /\{\{@\s?[0-9].*?\}\}/,
    reason:
      "This page includes content from another page. Live Edit can't preserve page includes yet — edit this page in BookStack's normal editor.",
  },
  {
    // `<p class="callout success|info|warning|danger">`. Phase 1's Tiptap
    // extension set has no callout node, so importing this would silently
    // downgrade it to a plain paragraph and lose the callout styling.
    test: /class="[^"]*\bcallout\s+(?:info|success|warning|danger)\b[^"]*"/i,
    reason:
      "This page contains a callout box. Live Edit doesn't support callouts yet — edit this page in BookStack's normal editor.",
  },
];

export function fidelityBlockers(
  rawHtml: string,
  editorType: string,
): FidelityBlock[] {
  const blocks: FidelityBlock[] = [];
  if (editorType !== "wysiwyg")
    blocks.push({
      reason:
        "This page uses BookStack's Markdown editor. Live Edit currently only supports the visual (WYSIWYG) editor.",
    });
  for (const check of CHECKS)
    if (check.test.test(rawHtml)) blocks.push({ reason: check.reason });
  return blocks;
}
