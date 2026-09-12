import type { Passage } from "./retrieval";

export type ExtractiveAnswer = {
  answer: string;
  citations: number[];
};

const MAX_SENTENCES = 5;
const MAX_WORDS = 120;
const MIN_SENTENCE_LENGTH = 12;

/** Split a collapsed passage into readable sentence units. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH);
}

function sentencesOf(text: string): string[] {
  return splitSentences(text.replace(/^…+/, "").trim());
}

function score(sentence: string, heading: string | null, terms: string[]) {
  const body = sentence.toLowerCase();
  const head = (heading || "").toLowerCase();
  let value = 0;
  for (const term of terms) {
    if (body.includes(term)) value += 2;
    if (head.includes(term)) value += 1;
  }
  return value;
}

function clean(value: string) {
  return value.replace(/^…+/, "").replace(/\s+/g, " ").trim();
}

function addCitation(sentence: string, citation: number) {
  return `${clean(sentence)} [${citation}]`;
}

/**
 * Assemble an answer from the best-matching sentences of the retrieved
 * passages. Every sentence carries the number of the passage it was taken
 * from, so the answer is nothing but quoted, traceable wiki text. No model is
 * involved and nothing leaves BookHost.
 */
export function extractiveAnswer(
  passages: Passage[],
  terms: string[],
): ExtractiveAnswer {
  if (!passages.length) return { answer: "", citations: [] };
  const seen = new Set<string>();
  const candidates: {
    passage: number;
    order: number;
    sentence: string;
    score: number;
  }[] = [];
  passages.forEach((passage, passageIndex) => {
    sentencesOf(passage.text).forEach((sentence, order) => {
      const sentenceScore = score(sentence, passage.section, terms);
      if (sentenceScore <= 0) return;
      const key = clean(sentence).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push({
        passage: passageIndex,
        order,
        sentence,
        score: sentenceScore,
      });
    });
  });
  candidates.sort(
    (a, b) => b.score - a.score || a.passage - b.passage || a.order - b.order,
  );
  const chosen = candidates
    .slice(0, MAX_SENTENCES)
    .sort((a, b) => a.passage - b.passage || a.order - b.order);
  let words = 0;
  const parts: string[] = [];
  const citations: number[] = [];
  for (const item of chosen) {
    const count = clean(item.sentence).split(/\s+/).filter(Boolean).length;
    if (parts.length && words + count > MAX_WORDS) break;
    words += count;
    parts.push(addCitation(item.sentence, item.passage + 1));
    if (!citations.includes(item.passage + 1)) citations.push(item.passage + 1);
  }
  if (!parts.length)
    return { answer: addCitation(passages[0].text, 1), citations: [1] };
  return { answer: parts.join(" "), citations };
}
