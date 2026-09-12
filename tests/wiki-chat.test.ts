import { afterEach, describe, expect, it, vi } from "vitest";
import {
  queryTerms,
  htmlToSections,
  retrieve,
} from "@/lib/chat/retrieval";
import { parseChatAnswer } from "@/lib/chat/answer";
import { askWiki } from "@/lib/chat/ask";
import { extractiveAnswer, splitSentences } from "@/lib/chat/synthesize";
import type { Passage } from "@/lib/chat/retrieval";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function fakeClient(
  pages: Record<string, unknown>,
  search?: unknown,
): { base: string; request: ReturnType<typeof vi.fn> } {
  return {
    base: "https://wiki.example",
    request: vi.fn(async (path: string) =>
      path.startsWith("search")
        ? search ?? {
            data: [
              {
                id: 1,
                name: "Deploy handbook",
                type: "page",
                url: "/books/handbook/page/deploy",
              },
            ],
          }
        : pages[path],
    ),
  };
}

describe("query terms", () => {
  it("drops stopwords, short words and duplicates", () => {
    expect(queryTerms("How do I deploy the deploy script really?")).toEqual([
      "deploy",
      "script",
      "really",
    ]);
  });
  it("strips BookStack query punctuation so no filter syntax can pass", () => {
    const terms = queryTerms('{type:book} "admin" name:secret');
    expect(terms.join(" ")).not.toMatch(/[{}":]/);
    expect(terms).toContain("admin");
  });
});

describe("html to sections", () => {
  it("keeps heading text with the section body", () => {
    expect(
      htmlToSections(
        "<p>Intro &amp; welcome</p><h2>Setup</h2><p>Run the deploy script.</p><h3>Rollback</h3><p>Undo it.</p>",
      ),
    ).toEqual([
      { heading: null, text: "Intro & welcome" },
      { heading: "Setup", text: "Run the deploy script." },
      { heading: "Rollback", text: "Undo it." },
    ]);
  });
});

describe("retrieval", () => {
  it("ranks the section that matches and cites its page", async () => {
    const client = fakeClient({
      "pages/1": {
        id: 1,
        name: "Deploy handbook",
        book_id: 5,
        html: "<h2>Setup</h2><p>Run the deploy script.</p><h2>Billing</h2><p>Monthly invoices.</p>",
      },
    });
    const passages = await retrieve(client, "how do I deploy");
    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatchObject({
      pageId: 1,
      pageName: "Deploy handbook",
      section: "Setup",
      url: "/books/handbook/page/deploy",
    });
    expect(passages[0].text).toContain("deploy");
  });

  it("falls back to search previews when a page cannot be fetched", async () => {
    const client = fakeClient({});
    client.request = vi.fn(async (path: string) => {
      if (path.startsWith("search"))
        return {
          data: [
            {
              id: 9,
              name: "Preview page",
              type: "page",
              url: "/books/x/page/y",
              preview_html: "<p>the deploy token lives here</p>",
            },
          ],
        };
      throw new Error("page fetch failed");
    });
    const passages = await retrieve(client, "where is the deploy token");
    expect(passages).toHaveLength(1);
    expect(passages[0].pageName).toBe("Preview page");
  });

  it("returns nothing when no terms remain", async () => {
    expect(await retrieve(fakeClient({}), "the and of")).toEqual([]);
  });
});

describe("extractive answer", () => {
  const passage = (over: Partial<Passage> = {}): Passage => ({
    pageId: 1,
    pageName: "P",
    bookId: null,
    section: null,
    url: null,
    text: "",
    score: 1,
    ...over,
  });

  it("splits collapsed text into sentences and drops tiny fragments", () => {
    expect(
      splitSentences("OK. The deploy token lives here. Run the deploy script."),
    ).toEqual(["The deploy token lives here.", "Run the deploy script."]);
  });

  it("quotes matching sentences from several pages in reading order", () => {
    const result = extractiveAnswer(
      [
        passage({
          section: "Setup",
          text: "…the deploy token lives here. Monthly invoices are separate.",
        }),
        passage({
          section: "Rollout",
          text: "Run the deploy script before every release.",
        }),
      ],
      ["deploy"],
    );
    expect(result.citations).toEqual([1, 2]);
    expect(result.answer).toBe(
      "the deploy token lives here. [1] Run the deploy script before every release. [2]",
    );
  });

  it("quotes a repeated sentence only once", () => {
    const result = extractiveAnswer(
      [
        passage({ text: "Restart the deploy service. Keep the logs." }),
        passage({ text: "Restart the deploy service. Then verify the logs." }),
      ],
      ["deploy"],
    );
    expect(result.answer.match(/Restart the deploy service\./g)).toHaveLength(1);
    expect(result.citations).toEqual([1]);
  });

  it("falls back to the first passage when no sentence matches", () => {
    const result = extractiveAnswer(
      [passage({ text: "Nothing relevant here at all." })],
      ["deploy"],
    );
    expect(result.answer).toBe("Nothing relevant here at all. [1]");
    expect(result.citations).toEqual([1]);
  });

  it("returns nothing without passages", () => {
    expect(extractiveAnswer([], ["deploy"])).toEqual({
      answer: "",
      citations: [],
    });
  });
});

describe("answer parsing", () => {
  const passages = [{ pageId: 1, pageName: "P", section: "S" } as Passage];
  it("keeps only citations that exist and refuses otherwise", () => {
    const good = parseChatAnswer(
      '{"answer":"Do it [1].","citations":[1],"enough":true}',
      passages,
    );
    expect(good.refused).toBe(false);
    expect(good.sources[0].pageName).toBe("P");
    expect(
      parseChatAnswer(
        '{"answer":"Maybe [7].","citations":[7],"enough":true}',
        passages,
      ).refused,
    ).toBe(true);
    expect(
      parseChatAnswer('{"answer":"","citations":[],"enough":false}', passages)
        .refused,
    ).toBe(true);
    expect(parseChatAnswer("not json", passages).refused).toBe(true);
  });
});

describe("ask wiki", () => {
  const client = () =>
    fakeClient({
      "pages/1": {
        id: 1,
        name: "Deploy handbook",
        html: "<h2>Setup</h2><p>Run the deploy script.</p>",
      },
    });

  it("answers extractively with citations and no provider call by default", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await askWiki(client(), "how do I deploy");
    expect(result.mode).toBe("extractive");
    expect(result.refused).toBe(false);
    expect(result.answer).toContain("deploy script");
    expect(result.answer).toContain("[1]");
    expect(result.terms).toContain("deploy");
    expect(result.sources[0].url).toBe(
      "https://wiki.example/books/handbook/page/deploy",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("only writes through the provider when explicitly enabled", async () => {
    vi.stubEnv("WIKI_CHAT_LLM", "1");
    vi.stubEnv("CHUTES_API_KEY", "test-key");
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "Run the deploy script [1].",
                    citations: [1],
                    enough: true,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const result = await askWiki(client(), "how do I deploy");
    expect(result.mode).toBe("ai");
    expect(result.answer).toContain("deploy script");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("refuses when nothing in the wiki matches", async () => {
    const client = fakeClient({}, { data: [] });
    const result = await askWiki(client, "unrelated question");
    expect(result.refused).toBe(true);
    expect(result.sources).toEqual([]);
  });
});
