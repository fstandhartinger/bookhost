import sanitize from "sanitize-html";
export function cleanHtml(html: string) {
  return sanitize(html, {
    allowedTags: [
      "h2",
      "h3",
      "p",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "strong",
      "em",
      "br",
      "blockquote",
      "code",
      "pre",
    ],
    allowedAttributes: {},
  });
}
