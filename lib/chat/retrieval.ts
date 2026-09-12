export type WikiClient = {
  base: string;
  request: <T>(
    path: string,
    body?: unknown,
    method?: "DELETE" | "PUT",
  ) => Promise<T>;
};

export type Passage = {
  pageId: number;
  pageName: string;
  bookId: number | null;
  section: string | null;
  url: string | null;
  text: string;
  score: number;
};

type SearchResult = {
  id: number;
  name: string;
  type: string;
  url?: string;
  book_id?: number;
  preview_html?: string | { content?: string };
};
type SearchResponse = { data?: SearchResult[]; total?: number };
type PageResponse = {
  id: number;
  name: string;
  html?: string;
  book_id?: number;
  chapter_id?: number | null;
};

const STOP = new Set(
  "the and for with not this that these those are was were is be been being from into onto your you our their its it's a an to of in on at by or as if then than so about what which who whom whose when where why how can could should would do does did has have had will shall may might must over under between during before after above below up down out off again once here there all any both each few more most other some such no nor only own same too very".split(
    " ",
  ),
);

/** Search terms are data, never BookStack query syntax: keep letters/digits only. */
export function queryTerms(question: string, maximum = 12) {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []) {
    if (STOP.has(word) || seen.has(word)) continue;
    seen.add(word);
    terms.push(word.slice(0, 40));
    if (terms.length >= maximum) break;
  }
  return terms;
}

function decode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;/gi, "'");
}

export function htmlToSections(html: string) {
  let value = html.replace(
    /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_match, _level, title: string) => `\n@@H@@${title}@@H@@\n`,
  );
  value = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|tr|div|blockquote|pre|td|th|h[1-4])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  value = decode(value);
  const sections: { heading: string | null; text: string }[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  for (const raw of value.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const match = line.match(/^@@H@@([\s\S]*?)@@H@@$/);
    if (match) {
      if (buffer.length || heading !== null)
        sections.push({ heading, text: buffer.join(" ").trim() });
      heading = match[1].replace(/<[^>]+>/g, "").trim() || null;
      buffer = [];
    } else buffer.push(line);
  }
  if (buffer.length) sections.push({ heading, text: buffer.join(" ").trim() });
  return sections.filter((section) => section.text);
}

export function scoreSection(heading: string | null, text: string, terms: string[]) {
  const body = text.toLowerCase();
  const head = (heading || "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    const occurrences = body.split(term).length - 1;
    score += Math.min(occurrences, 3);
    if (head.includes(term)) score += 3;
  }
  return score;
}

function excerpt(text: string, terms: string[], maximum = 1200) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - 200);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, start + maximum) +
    (start + maximum < text.length ? "…" : "")
  );
}

function previewOf(result: SearchResult) {
  const preview = result.preview_html;
  if (typeof preview === "string") return preview;
  return preview?.content || "";
}

/**
 * Retrieval uses BookStack's own full-text index. Embeddings are a later step;
 * this slice answers from the same pages a workspace API token can already read.
 */
export async function retrieve(
  client: WikiClient,
  question: string,
  limit = 4,
): Promise<Passage[]> {
  const terms = queryTerms(question);
  if (!terms.length) return [];
  const search = await client.request<SearchResponse>(
    `search?query=${encodeURIComponent(`${terms.join(" ")} {type:page}`)}&count=12`,
  );
  const results = (search.data || [])
    .filter((result) => result.type === "page" && Number.isSafeInteger(result.id))
    .slice(0, 6);
  if (!results.length) return [];
  const details = await Promise.allSettled(
    results.map((result) => client.request<PageResponse>(`pages/${result.id}`)),
  );
  const scored: Passage[] = [];
  results.forEach((result, index) => {
    const detail = details[index];
    const html =
      detail.status === "fulfilled" ? detail.value.html || "" : previewOf(result);
    const name =
      (detail.status === "fulfilled" && detail.value.name) || result.name || "";
    if (!html || !name) return;
    const sections = htmlToSections(html);
    const candidates = sections.length
      ? sections
      : [{ heading: null as string | null, text: html.replace(/\s+/g, " ") }];
    let best: { heading: string | null; text: string; score: number } | null = null;
    for (const section of candidates) {
      const score = scoreSection(section.heading, section.text, terms);
      if (!best || score > best.score)
        best = { heading: section.heading, text: section.text, score };
    }
    if (!best || best.score <= 0) return;
    const url =
      result.url && result.url.startsWith("/") ? result.url : null;
    scored.push({
      pageId: result.id,
      pageName: name,
      bookId:
        detail.status === "fulfilled"
          ? detail.value.book_id ?? null
          : result.book_id ?? null,
      section: best.heading,
      url,
      text: excerpt(best.text, terms),
      score: best.score - index * 0.01,
    });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function absoluteUrl(base: string, path: string | null) {
  if (!path) return null;
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}
