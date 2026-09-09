import sanitize from "sanitize-html";
import { draftHeadings, languageEvidence, sourceLocale } from "./prompt";
const plain = (html: string) =>
  sanitize(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) =>
      String.fromCodePoint(
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n),
      ),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function tables(html: string) {
  return [...html.matchAll(/<table>[\s\S]*?<\/table>/gi)].map(([table]) =>
    [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        plain(cell[1]),
      ),
    ),
  );
}
function sourceTables(source: string): string[][][] {
  if (/<table[\s>]/i.test(source))
    return tables(
      sanitize(source, {
        allowedTags: ["table", "thead", "tbody", "tr", "th", "td"],
        allowedAttributes: {},
      }),
    );
  const result: string[][][] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1]))
      continue;
    const rows: string[][] = [];
    const cells = (s: string) =>
      s
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(/(?<!\\)\|/)
        .map((c) => plain(c.trim().replace(/\\\|/g, "|")));
    rows.push(cells(lines[i]));
    i += 2;
    while (i < lines.length && lines[i].includes("|") && lines[i].trim())
      rows.push(cells(lines[i++]));
    result.push(rows);
    i--;
  }
  return result;
}
export function validateDraft(
  draft: { title: string; html: string; tags: string[] },
  source?: string,
) {
  const { html } = draft;
  const locale =
    source === undefined
      ? html.startsWith("<h2>Zusammenfassung")
        ? "de"
        : "en"
      : sourceLocale(source);
  const required = draftHeadings(locale);
  const headings = [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/gi)].map((m) =>
    plain(m[1]),
  );
  if (headings[0] !== required.summary || headings.at(-1) !== required.review)
    throw new Error(
      "Draft review sections do not match the source language or order.",
    );
  const summary = html.match(
    /^<h2>(?:(?!<\/h2>)[\s\S])*<\/h2>\s*<p>([\s\S]*?)<\/p>/i,
  )?.[1];
  if (!summary || !plain(summary))
    throw new Error(
      "Start with the Summary heading and a nonempty summary paragraph.",
    );
  const review = html.slice(html.lastIndexOf("<h2>"));
  const list = review.match(
    /^<h2>[^]*?<\/h2>\s*<ul>([\s\S]*?)<\/ul>\s*$/i,
  )?.[1];
  const items = list
    ? [...list.matchAll(/<li>([\s\S]*?)<\/li>/gi)]
        .map((m) => plain(m[1]))
        .filter(Boolean)
    : [];
  if (new Set(items).size < 3 || (list && /<(?:ul|ol)>/i.test(list)))
    throw new Error(
      "End with a reviewer ul containing at least three distinct nonempty checks.",
    );
  // Neutral names/technical labels are allowed; positive foreign-language evidence is rejected.
  const passages = [
    ...headings,
    plain(summary),
    draft.title,
    ...draft.tags,
    ...[...html.matchAll(/<(?:p|li)>([\s\S]*?)<\/(?:p|li)>/gi)].map((m) =>
      plain(m[1]),
    ),
  ];
  if (
    passages.some((s) => {
      const detected = languageEvidence(s, 1);
      return detected && detected !== locale;
    })
  )
    throw new Error(
      "All headings, summary, prose, title and tags must match the source language.",
    );
  if (source !== undefined) {
    const expected = sourceTables(source);
    if (
      expected.length &&
      JSON.stringify(expected) !== JSON.stringify(tables(html))
    )
      throw new Error(
        "Preserve every source table, cell, row and column in order without additions.",
      );
  }
}
