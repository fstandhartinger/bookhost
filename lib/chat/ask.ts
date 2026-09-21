import {
  retrieve,
  retrieveHybrid,
  absoluteUrl,
  queryTerms,
  type DbClient,
  type Passage,
  type RetrievalKind,
  type WikiClient,
} from "./retrieval";
import { answerQuestion, NO_ANSWER, type ChatSource } from "./answer";
import { extractiveAnswer } from "./synthesize";

export type AskMode = "extractive" | "ai";
export type AskResult = {
  question: string;
  answer: string;
  sources: ChatSource[];
  refused: boolean;
  mode: AskMode;
  /** Which retrieval path produced the passages. */
  retrieval: RetrievalKind;
  /** The search terms behind the result, for highlighting in the reader. */
  terms: string[];
};

export type AskOptions = {
  teamId?: string;
  database?: DbClient;
};

function toSources(passages: Passage[], base: string): ChatSource[] {
  return passages.map((passage) => ({
    pageId: passage.pageId,
    pageName: passage.pageName,
    section: passage.section,
    url: absoluteUrl(base, passage.url),
    excerpt: passage.text,
  }));
}

/** AI synthesis stays off until the provider DPA and transfer documents exist. */
export function aiEnabled() {
  return process.env.WIKI_CHAT_LLM === "1";
}

export async function askWiki(
  client: WikiClient,
  question: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const terms = queryTerms(question);
  const hybrid = options.teamId
    ? await retrieveHybrid(client, options.teamId, question, options.database)
    : null;
  const passages = hybrid ? hybrid.passages : await retrieve(client, question);
  const retrieval = hybrid?.retrieval ?? "lexical";
  if (!passages.length)
    return {
      question,
      answer: NO_ANSWER,
      sources: [],
      refused: true,
      mode: "extractive",
      retrieval,
      terms,
    };
  if (!aiEnabled()) {
    const extract = extractiveAnswer(passages, terms);
    return {
      question,
      answer: extract.answer,
      sources: toSources(
        extract.citations.map((number) => passages[number - 1]),
        client.base,
      ),
      refused: false,
      mode: "extractive",
      retrieval,
      terms,
    };
  }
  const result = await answerQuestion(question, passages);
  return {
    question,
    answer: result.answer,
    sources: result.sources.map((source) => ({
      ...source,
      url: absoluteUrl(client.base, source.url),
    })),
    refused: result.refused,
    mode: "ai",
    retrieval,
    terms,
  };
}
