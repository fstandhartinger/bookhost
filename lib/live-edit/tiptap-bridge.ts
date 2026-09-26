import * as Y from "yjs";
import { generateJSON, generateHTML } from "@tiptap/html/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import sanitizeHtml from "sanitize-html";
import { LIVE_EDIT_EXTENSIONS } from "./extensions";

const FIELD = "default";

// Seeds a fresh Y.Doc from BookStack's stored page HTML. Called once per
// document lifetime (Hocuspocus's onLoadDocument only fires for a document
// that isn't already loaded in memory).
export function seedYdocFromHtml(html: string): Y.Doc {
  const json = generateJSON(html || "<p></p>", LIVE_EDIT_EXTENSIONS);
  return TiptapTransformer.toYdoc(json, FIELD, LIVE_EDIT_EXTENSIONS);
}

// Flattens the live Y.Doc back to sanitized HTML for saving to BookStack.
export function htmlFromYdoc(doc: Y.Doc): string {
  const json = TiptapTransformer.fromYdoc(doc, FIELD);
  const html = generateHTML(json, LIVE_EDIT_EXTENSIONS);
  // Defense in depth: Tiptap's own schema already constrains output, but
  // every other BookHost path that writes HTML into BookStack sanitizes it
  // (see lib/intake's allowlist) before it becomes a real page revision.
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr",
      "table", "thead", "tbody", "tr", "th", "td",
      "img", "pre", "code", "span",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      code: ["class"],
      span: ["class"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  });
}
