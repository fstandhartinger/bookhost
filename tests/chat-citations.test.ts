import { afterEach, describe, expect, it, vi } from "vitest";
import { renumberCitations } from "@/lib/chat/citations";
import { extractiveAnswer } from "@/lib/chat/synthesize";
import { NO_ANSWER, parseChatAnswer } from "@/lib/chat/answer";
import { askWiki } from "@/lib/chat/ask";
import { retrieve, type Passage } from "@/lib/chat/retrieval";

vi.mock("@/lib/chat/retrieval", async (original) => ({
  ...(await original<typeof import("@/lib/chat/retrieval")>()),
  retrieve: vi.fn(),
}));

afterEach(() => {
  vi.mocked(retrieve).mockReset();
});

function fakeClient(): { base: string; request: ReturnType<typeof vi.fn> } {
  return { base: "https://wiki.example", request: vi.fn() };
}

const passage = (over: Partial<Passage>): Passage => ({
  pageId: 1,
  pageName: "P",
  bookId: null,
  section: null,
  url: null,
  text: "",
  score: 1,
  ...over,
});

const markersOf = (answer: string) =>
  [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));

describe("renumberCitations helper", () => {
  it("renumbers valid markers by first appearance, drops invalid ones", () => {
    expect(renumberCitations("Alpha [3]. Beta [1][3]. Gamma [9].", 3)).toEqual({
      text: "Alpha [1]. Beta [2][1]. Gamma.",
      citations: [3, 1],
    });
    expect(renumberCitations("Alpha [9] Beta", 3)).toEqual({
      text: "Alpha Beta",
      citations: [],
    });
    expect(renumberCitations("A [2][2] and [1].", 2)).toEqual({
      text: "A [1][1] and [2].",
      citations: [2, 1],
    });
  });
});

describe("extractive citation renumbering", () => {
  // Five retrieved passages; only passages 2 and 5 contain a matching term.
  const sparse = [
    passage({
      pageId: 1,
      pageName: "Invoices",
      text: "Monthly invoices are generated automatically.",
    }),
    passage({
      pageId: 2,
      pageName: "Deploy",
      section: "Deploy",
      text: "Run the deploy script before every release.",
    }),
    passage({
      pageId: 3,
      pageName: "Coffee",
      text: "Coffee machine manuals are kept in the kitchen.",
    }),
    passage({
      pageId: 4,
      pageName: "Chairs",
      text: "Office chairs are ergonomic and adjustable.",
    }),
    passage({
      pageId: 5,
      pageName: "Vault",
      section: "Deploy",
      text: "The deploy token lives in the vault.",
    }),
  ];

  it("numbers markers by returned source, not retrieved position (A1)", () => {
    const extract = extractiveAnswer(sparse, ["deploy"]);
    expect(extract.citations).toEqual([2, 5]);
    expect(extract.answer).toBe(
      "Run the deploy script before every release. [1] The deploy token lives in the vault. [2]",
    );
    const sources = extract.citations.map((number) => sparse[number - 1]);
    expect(sources.map((p) => p.pageName)).toEqual(["Deploy", "Vault"]);
  });

  it("askWiki returns exactly the sources the markers index (A1)", async () => {
    vi.mocked(retrieve).mockResolvedValue(sparse);
    const result = await askWiki(fakeClient(), "how do I deploy");
    expect(result.mode).toBe("extractive");
    expect(result.refused).toBe(false);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => source.pageName)).toEqual([
      "Deploy",
      "Vault",
    ]);
    expect(markersOf(result.answer)).toEqual([1, 2]);
    expect(result.answer).toContain(
      "Run the deploy script before every release. [1]",
    );
    expect(result.answer).toContain("The deploy token lives in the vault. [2]");
  });
});

describe("every marker indexes a returned source", () => {
  it("holds across retrieval shapes (A2)", () => {
    const shapes: Passage[][] = [
      // 1 passage, direct hit.
      [
        passage({
          pageId: 1,
          pageName: "Deploy",
          text: "Run the deploy script before every release.",
        }),
      ],
      // No sentence matches: the fallback quotes the first passage.
      [
        passage({
          pageId: 1,
          pageName: "Invoices",
          text: "Monthly invoices are generated automatically.",
        }),
        passage({
          pageId: 2,
          pageName: "Coffee",
          text: "Coffee machine manuals are kept in the kitchen.",
        }),
      ],
      // 3 passages, all cited.
      [
        passage({
          pageId: 1,
          pageName: "A",
          text: "Run the deploy script before every release.",
        }),
        passage({
          pageId: 2,
          pageName: "B",
          text: "The deploy token lives in the vault.",
        }),
        passage({
          pageId: 3,
          pageName: "C",
          text: "Deploy backups happen nightly at three.",
        }),
      ],
      // 6 passages, sparse hits on 2 and 5, one passage cited twice.
      [
        passage({
          pageId: 1,
          pageName: "P1",
          text: "Office chairs are ergonomic and adjustable.",
        }),
        passage({
          pageId: 2,
          pageName: "P2",
          text: "Run the deploy script before every release. The deploy script logs each step.",
        }),
        passage({
          pageId: 3,
          pageName: "P3",
          text: "Coffee machine manuals are kept in the kitchen.",
        }),
        passage({
          pageId: 4,
          pageName: "P4",
          text: "Monthly invoices are generated automatically.",
        }),
        passage({
          pageId: 5,
          pageName: "P5",
          text: "The deploy token lives in the vault.",
        }),
        passage({
          pageId: 6,
          pageName: "P6",
          text: "Parking permits are issued at reception.",
        }),
      ],
    ];
    for (const passages of shapes) {
      const extract = extractiveAnswer(passages, ["deploy"]);
      const sources = extract.citations.map((number) => passages[number - 1]);
      const markers = markersOf(extract.answer);
      expect(markers.length).toBeGreaterThan(0);
      for (const marker of markers) {
        expect(marker).toBeGreaterThanOrEqual(1);
        expect(marker).toBeLessThanOrEqual(sources.length);
      }
      // Every returned source is referenced by at least one marker.
      expect([...new Set(markers)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: sources.length }, (_unused, index) => index + 1),
      );
    }
  });
});

describe("AI answer citation renumbering", () => {
  const passages = [
    passage({ pageId: 1, pageName: "P1", text: "one" }),
    passage({ pageId: 2, pageName: "P2", text: "two" }),
    passage({ pageId: 3, pageName: "P3", text: "three" }),
  ];

  it("renumbers markers by first appearance and drops invalid ones (A3)", () => {
    const parsed = parseChatAnswer(
      JSON.stringify({
        answer: "Alpha [3]. Beta [1][3]. Gamma [9].",
        citations: [3, 1],
        enough: true,
      }),
      passages,
    );
    expect(parsed.refused).toBe(false);
    expect(parsed.answer).toBe("Alpha [1]. Beta [2][1]. Gamma.");
    expect(parsed.sources.map((source) => source.pageName)).toEqual([
      "P3",
      "P1",
    ]);
  });

  it("keeps cited passages the text did not mark (A3)", () => {
    const parsed = parseChatAnswer(
      JSON.stringify({ answer: "Alpha [2].", citations: [2, 3], enough: true }),
      passages,
    );
    expect(parsed.refused).toBe(false);
    expect(parsed.answer).toBe("Alpha [1].");
    expect(parsed.sources.map((source) => source.pageName)).toEqual([
      "P2",
      "P3",
    ]);
  });

  it("refuses when no marker and no citation entry is valid (A3)", () => {
    const parsed = parseChatAnswer(
      JSON.stringify({
        answer: "Maybe [7]. Or [9].",
        citations: [7, 9],
        enough: true,
      }),
      passages,
    );
    expect(parsed.refused).toBe(true);
    expect(parsed.answer).toBe(NO_ANSWER);
    expect(parsed.sources).toEqual([]);
  });
});
