import { parseDocument } from "htmlparser2";

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
    // <details><summary> (resources/js/wysiwyg-tinymce/plugins-details.js).
    // No Tiptap node for it; StarterKit would drop the tags and flatten the
    // collapsible section into plain paragraphs.
    test: /<details\b/i,
    reason:
      "This page contains a collapsible details block. Live Edit doesn't support those yet — edit this page in BookStack's normal editor.",
  },
  {
    // Embeds (video/iframe) aren't in our Tiptap extension list at all.
    test: /<iframe\b/i,
    reason:
      "This page contains an embedded video or iframe. Live Edit doesn't support embeds yet — edit this page in BookStack's normal editor.",
  },
];

const REASONS = {
  callout:
    "This page contains a callout box. Live Edit doesn't support callouts yet — edit this page in BookStack's normal editor.",
  taskList:
    "This page contains a task list. Live Edit doesn't support checkboxes yet — edit this page in BookStack's normal editor.",
  style:
    "This page uses custom text styling (color, alignment or size) that Live Edit can't preserve yet — edit this page in BookStack's normal editor.",
} as const;

// Parse actual HTML attributes so single quotes, unquoted values, entities and
// whitespace around equals receive the same fidelity checks. Regexes over the
// raw source can miss these forms or match examples inside unrelated text.
function tagAttributes(rawHtml: string): Array<{
  name: string;
  value: string | null;
  tagName: string;
}> {
  const attributes: Array<{ name: string; value: string | null; tagName: string }> = [];
  type ParsedNode = {
    name?: string;
    attribs?: Record<string, string>;
    children?: ParsedNode[];
  };
  const document = parseDocument(rawHtml, { decodeEntities: true }) as ParsedNode;
  const stack = [...(document.children || [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.name) {
      for (const [name, value] of Object.entries(node.attribs || {})) {
        attributes.push({
          name: name.toLowerCase(),
          value,
          tagName: node.name.toLowerCase(),
        });
      }
    }
    if (node.children?.length) {
      stack.push(...node.children);
    }
  }
  return attributes;
}

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

  const attributes = tagAttributes(rawHtml);
  const classNames = attributes
    .filter((attribute) => attribute.name === "class")
    .map((attribute) => attribute.value || "");
  if (
    classNames.some((value) =>
      /(?:^|\s)callout\s+(?:info|success|warning|danger)(?:\s|$)/i.test(value),
    )
  )
    blocks.push({ reason: REASONS.callout });
  if (
    attributes.some(
      (attribute) =>
        attribute.tagName === "input" &&
        attribute.name === "type" &&
        attribute.value?.toLowerCase() === "checkbox",
    )
  )
    blocks.push({ reason: REASONS.taskList });
  if (
    attributes.some(
      (attribute) =>
        attribute.name === "style" && Boolean(attribute.value?.trim()),
    )
  )
    blocks.push({ reason: REASONS.style });
  return blocks;
}
