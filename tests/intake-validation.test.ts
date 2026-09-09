import { afterEach, expect, it, vi } from "vitest";
import { buildPrompt, parseDraft } from "@/lib/intake/content";
import { sourceLocale, languageEvidence } from "@/lib/intake/prompt";
import { generateDraft } from "@/lib/intake/draft";
const source = "The team must check the device and document the damage.";
const valid = {
  title: "Device inspection",
  html: "<h2>Summary</h2><p>The team must check the device.</p><h2>Procedure</h2><p>Document damage.</p><h2>Things a reviewer should check</h2><ul><li>Check the device.</li><li>Verify the damage.</li><li>Inspect accessories.</li></ul>",
  tags: ["device", "damage", "inspection"],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each([
  ["Gerät ausschalten. Schäden dokumentieren. Zubehör prüfen.", "de"],
  ["Switch off the device. Document damage. Inspect accessories.", "en"],
  ["Die Frist gilt", "de"],
  ["The deadline applies", "en"],
  ["# Zusammenfassung\nThe team is ready. Die Gruppe ist bereit.", "de"],
  ["X\nDie Frist ist offen\nThe deadline is open", "en"],
])("routes short/mixed input %s", (text, locale) => {
  expect(sourceLocale(text)).toBe(locale);
});
it("requires three words for whole-document evidence and uses localized headings", () => {
  expect(languageEvidence("die Frist")).toBeUndefined();
  expect(
    buildPrompt("Gerät ausschalten. Schäden dokumentieren. Zubehör prüfen.")[0]
      .content,
  ).toContain("<h2>Was ein Reviewer prüfen sollte</h2>");
});
it.each([
  valid.html.replace("<h2>Procedure</h2>", "<h2>Die nächsten Aufgaben</h2>"),
  valid.html.replace(
    "The team must check the device.",
    "Die Gruppe muss die Unterlagen prüfen.",
  ),
  "<p>Preface</p>" + valid.html,
  valid.html.replace(
    "<p>The team must check the device.</p>",
    "<ul><li>Check device</li></ul>",
  ),
  valid.html.replace("<li>Inspect accessories.</li>", ""),
  valid.html.replace(
    "<li>Inspect accessories.</li>",
    "<li>Check the device.</li>",
  ),
  valid.html + "<h2>Appendix</h2><p>After review</p>",
])("rejects foreign language and malformed sections", (html) => {
  expect(() =>
    parseDraft(JSON.stringify({ ...valid, html }), source),
  ).toThrow();
});
it.each([
  { title: "Die nächsten Aufgaben" },
  { tags: ["Zusammenfassung", "Prüfung", "Entwurf"] },
])("checks title and tags too", (patch) => {
  expect(() =>
    parseDraft(JSON.stringify({ ...valid, ...patch }), source),
  ).toThrow("source language");
});
it("keeps tables as ordered matrices, rejecting deletions, reordering and additions", () => {
  const input =
    source +
    "\n| Category | Days |\n| --- | --- |\n| draft | 30 |\n| review | 90 |";
  const header = "<tr><th>Category</th><th>Days</th></tr>";
  const a = "<tr><td>draft</td><td>30</td></tr>",
    b = "<tr><td>review</td><td>90</td></tr>";
  const render = (rows: string) =>
    JSON.stringify({
      ...valid,
      html: valid.html.replace(
        "<h2>Procedure</h2>",
        `<table>${rows}</table><h2>Procedure</h2>`,
      ),
    });
  expect(parseDraft(render(header + a + b), input)).toBeTruthy();
  for (const rows of [header + b + a, header + a, header + a + b + a])
    expect(() => parseDraft(render(rows), input)).toThrow("table");
});
it("corrects once on the same model and refuses a second invalid response without fallback", async () => {
  vi.stubEnv("CHUTES_API_KEY", "unit-test");
  vi.stubEnv("INTAKE_MODELS", "default,fallback");
  const invalid = {
    ...valid,
    html: valid.html.replace("<li>Inspect accessories.</li>", ""),
  };
  const response = (value: unknown) =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(value) } }],
    });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(invalid))
    .mockResolvedValueOnce(response(valid));
  vi.stubGlobal("fetch", fetcher);
  expect(await generateDraft(source)).toEqual(valid);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const request = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(request.model).toBe("default");
  expect(request.messages.at(-1).content).toContain("failed validation");
  fetcher
    .mockReset()
    .mockImplementation(() => Promise.resolve(response(invalid)));
  await expect(generateDraft(source)).rejects.toThrow("Could not create");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
