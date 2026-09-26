import sanitizeHtml from "sanitize-html";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";

// Agent-supplied Markdown becomes HTML for proposals and for appending to
// WYSIWYG pages. Raw HTML inside Markdown is dropped by remark-rehype, and the
// result is sanitized again with a conservative allowlist.
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const VOID = new Set(["br", "hr", "img", "input"]);
const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value: string) => escapeText(value).replace(/"/g, "&quot;");

function attr(name: string, value: unknown) {
  const key = name === "className" ? "class" : name.toLowerCase();
  if (value === false || value === null || value === undefined) return "";
  if (value === true) return ` ${key}`;
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  return ` ${key}="${escapeAttr(text)}"`;
}

function toHtml(node: HastNode): string {
  if (node.type === "text") return escapeText(node.value || "");
  if (node.type === "root") return (node.children || []).map(toHtml).join("");
  if (node.type !== "element" || !node.tagName) return "";
  const attrs = Object.entries(node.properties || {})
    .map(([k, v]) => attr(k, v))
    .join("");
  if (VOID.has(node.tagName)) return `<${node.tagName}${attrs}>`;
  return `<${node.tagName}${attrs}>${(node.children || []).map(toHtml).join("")}</${node.tagName}>`;
}

export const PAGE_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "del",
    "s",
    "code",
    "pre",
    "blockquote",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "input",
    "sup",
    "sub",
  ],
  allowedAttributes: {
    a: ["href"],
    input: ["type", "checked", "disabled"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
};

export function markdownToHtml(markdown: string): string {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const tree = processor.runSync(
    processor.parse(markdown),
  ) as unknown as HastNode;
  return sanitizeHtml(toHtml(tree), PAGE_HTML_OPTIONS);
}
