import { describe, expect, it } from "vitest";
import {
  checkFaithfulness,
  numericFacts,
  scoreDraft,
} from "../eval/faithfulness.mjs";
import { cleanHtml, parseDraft } from "../lib/intake/content";

describe("lexical fact fidelity", () => {
  const draft = (html: string) => ({ title: "Guide", html });
  it("flags new dates, quantities, percentages and names", () => {
    const result = checkFaithfulness(
      "The team at Fernwharf recorded 30 on 2026-08-21.",
      draft("<p>The team at Inventicorp recorded 30% on 2026-08-22.</p>"),
      { language: "en" },
    );
    expect(result.unsupportedNumbers).toEqual(["30%", "2026-08-22"]);
    expect(result.unsupportedNames).toContain("Inventicorp");
    expect(result.passed).toBe(false);
  });
  it("preserves exact times, decimals and signed figures", () => {
    expect(numericFacts("09:30, 3.50, -12 and 2026-08-21")).toEqual([
      "09:30",
      "3.50",
      "-12",
      "2026-08-21",
    ]);
    expect(
      checkFaithfulness("09:30 3.50 -12", draft("<p>9:30 3.5 12</p>"))
        .unsupportedNumbers,
    ).toEqual(["9:30", "3.5", "12"]);
  });
  it("does not read HTML attributes or tag names as facts", () => {
    expect(
      checkFaithfulness(
        "30 days at Fernwharf",
        draft('<h2>Summary</h2><p data-x="999">30 days at Fernwharf</p>'),
        { language: "en" },
      ).passed,
    ).toBe(true);
  });
  it("decodes numeric HTML entities", () => {
    expect(checkFaithfulness("30", draft("<p>&#51;&#48;</p>")).passed).toBe(
      true,
    );
  });
  it("flags explicitly forbidden claims even without numbers", () => {
    expect(
      checkFaithfulness("Draft", draft("<p>Guaranteed recovery</p>"), {
        forbiddenHallucinations: ["guaranteed recovery"],
      }).forbiddenFacts,
    ).toEqual(["guaranteed recovery"]);
  });
  it("does not mistake ordinary German nouns for proper names", () => {
    expect(
      checkFaithfulness(
        "Frist 30 Tage",
        draft(
          "<p>Die zuständige Person prüft die Unterlagen nach 30 Tagen.</p>",
        ),
        { language: "de" },
      ).passed,
    ).toBe(true);
  });
  it("rejects a table whose values moved between rows", () => {
    const expected = {
      titleMaxLength: 80,
      headingCount: { min: 0, max: 5 },
      requiredTerms: [],
      preserveTable: true,
      language: "en",
      properNames: [],
      forbiddenHallucinations: [],
    };
    const source =
      "| Category | Days |\n| --- | --- |\n| draft | 30 |\n| review | 90 |";
    const result = scoreDraft(
      source,
      {
        title: "Guide",
        html: "<table><tr><th>Category</th><th>Days</th></tr><tr><td>draft</td><td>90</td></tr><tr><td>review</td><td>30</td></tr></table>",
      },
      expected,
    );
    expect(result.checks.table).toBe(false);
  });
});

describe("draft cleanup", () => {
  it("preserves table hierarchy and cell content while stripping active attributes", () => {
    expect(
      cleanHtml(
        '<table onclick="bad()"><thead><tr><th>Category</th><th>Days</th></tr></thead><tbody><tr><td>draft</td><td style="color:red">30</td></tr></tbody></table><script>bad()</script>',
      ),
    ).toBe(
      "<table><thead><tr><th>Category</th><th>Days</th></tr></thead><tbody><tr><td>draft</td><td>30</td></tr></tbody></table>",
    );
  });
  it("removes empty sections and nested empty elements without removing populated subsections", () => {
    expect(
      cleanHtml(
        "<h2>Empty</h2><p> &nbsp;<br></p><ul><li></li></ul><h2>Parent</h2><h3>Child</h3><p>Keep</p><h3>Blank</h3><h2>Last</h2>",
      ),
    ).toBe("<h2>Parent</h2><h3>Child</h3><p>Keep</p>");
  });
  it("accepts German review sections and limits titles to 80 characters", () => {
    const value = {
      title: "Leitfaden",
      html: "<h2>Zusammenfassung</h2><p>Entwurf</p><h2>Was ein Reviewer prüfen sollte</h2><ul><li>Frist</li><li>Zuständigkeit</li><li>Status</li></ul>",
      tags: ["Frist", "Prüfung", "Entwurf"],
    };
    expect(parseDraft(JSON.stringify(value))).toEqual(value);
    expect(() =>
      parseDraft(JSON.stringify({ ...value, title: "x".repeat(81) })),
    ).toThrow();
  });
});

it("checks numbers in tags as well as page content", () => {
  expect(
    checkFaithfulness("Draft", {
      title: "Draft",
      html: "<p>Draft</p>",
      tags: ["2027"],
    }).unsupportedNumbers,
  ).toEqual(["2027"]);
});

it("does not mistake formatted field labels for new proper names", () => {
  expect(
    checkFaithfulness(
      "A sample is pending",
      {
        title: "Guide",
        html: "<ul><li><strong>Table Integrity:</strong> A sample is pending.</li></ul>",
      },
      { language: "en" },
    ).unsupportedNames,
  ).toEqual([]);
});

it("rejects more than twelve evaluation requests before calling a provider", async () => {
  const { execFileSync } = await import("node:child_process");
  expect(() =>
    execFileSync(process.execPath, ["eval/run.mjs"], {
      env: {
        ...process.env,
        CHUTES_API_KEY: "unit-test",
        INTAKE_MODELS: "a,b,c",
      },
      stdio: "pipe",
    }),
  ).toThrow(/Maximum 12 calls/);
});

it("keeps six complete fictional evaluation cases within the requested word bounds", async () => {
  const { readFile } = await import("node:fs/promises");
  const cases = JSON.parse(await readFile("eval/expectations.json", "utf8"));
  expect(cases).toHaveLength(6);
  for (const item of cases) {
    const words = (await readFile(`eval/${item.file}`, "utf8"))
      .trim()
      .split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(300);
    expect(words).toBeLessThanOrEqual(1500);
    expect(item.reviewerShouldCheck.length).toBeGreaterThanOrEqual(3);
    expect(item.titleMaxLength).toBe(80);
    expect(item.forbiddenHallucinations.length).toBeGreaterThan(0);
  }
});

it("routes clear English and German sources without foreign-language prompt examples", async () => {
  const { sourceLocale } = await import("../lib/intake/prompt");
  const { buildPrompt } = await import("../lib/intake/content");
  const en =
    "The team and the reviewer are ready for the work. This is the source with the details.";
  const de =
    "Die Gruppe und die Person werden die Unterlagen für den Ablauf mit der Werkstatt prüfen. Eine Frist ist nicht bestätigt.";
  expect(sourceLocale(en)).toBe("en");
  expect(sourceLocale(de)).toBe("de");
  expect(sourceLocale("Mixed notes")).toBe("en");
  expect(buildPrompt(en)[0].content).not.toContain("Zusammenfassung");
  expect(buildPrompt(de)[0].content).not.toContain("<h2>Summary</h2>");
  const value = {
    title: "Entwurf",
    html: "<h2>Zusammenfassung</h2><p>Text</p><h2>Was ein Reviewer prüfen sollte</h2><ul><li>Frist</li><li>Zuständigkeit</li><li>Status</li></ul>",
    tags: ["eins", "zwei", "drei"],
  };
  expect(() => parseDraft(JSON.stringify(value), en)).toThrow(
    "source language",
  );
  expect(parseDraft(JSON.stringify(value), de)).toEqual(value);
});

it("removes empty sections with emphasized headings without swallowing populated content", () => {
  expect(
    cleanHtml(
      "<h2><strong>Empty</strong></h2><p></p><h2>Keep</h2><p>Content</p><h3><em>Empty child</em></h3>",
    ),
  ).toBe("<h2>Keep</h2><p>Content</p>");
});
