/** Conservative lexical checks, not a semantic proof. See eval/README.md. */
export function plainText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n),
      ),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export function numericFacts(text) {
  // Keep dates, times, decimals, signs and units intact: 30 is not evidence for 30%.
  return [
    ...new Set(
      text.match(/(?<![\p{L}\d])[-+]?\d+(?:[-/:.,]\d+)*(?:\s?%|\s?€)?/gu) || [],
    ),
  ];
}
export function checkFaithfulness(source, draft, expectations = {}) {
  const text = plainText(
    `${draft.title || ""} ${draft.html || ""} ${(draft.tags || []).join(" ")}`,
  );
  const sourceNumbers = new Set(numericFacts(source));
  const unsupportedNumbers = numericFacts(text).filter(
    (n) => !sourceNumbers.has(n),
  );
  const sourceWords = new Set(
    (source.match(/[\p{L}\p{N}_-]+/gu) || []).map((word) => word.toLowerCase()),
  );
  // Candidates: acronyms, internal capitals, explicitly named entities and
  // sentence-medial capitals in English. German nouns cannot be treated as names.
  const prose = plainText(
    (draft.html || "")
      .replace(/<h[23]\b[^>]*>[\s\S]*?<\/h[23]>/gi, ". ")
      .replace(/<(?:p|li|tr|blockquote)\b[^>]*>/gi, ". ")
      .replace(/<strong>[^<]*:<\/strong>/gi, ". "),
  );
  const candidates = new Set(
    expectations.properNames?.filter((name) => text.includes(name)) || [],
  );
  for (const word of text.match(
    /\b(?:[A-Z]{2,}[A-Z_\d-]*|[A-Z][a-z]+[A-Z][A-Za-z]*)\b/g,
  ) || [])
    candidates.add(word);
  for (const match of prose.matchAll(
    /(?:named|called|by|at|von|namens)\s+([A-ZÄÖÜ][\p{L}-]+)/gu,
  ))
    candidates.add(match[1]);
  if (expectations.language !== "de") {
    for (const match of prose.matchAll(/(?<=[\p{L}\d,] )([A-Z][\p{L}-]+)/gu))
      candidates.add(match[1]);
  }
  const generic = new Set([
    "The",
    "This",
    "These",
    "A",
    "An",
    "If",
    "No",
    "Not",
    "Do",
    "It",
    "In",
    "On",
    "For",
    "Before",
    "After",
    "Confirm",
    "Check",
    "Verify",
    "Review",
    "Ensure",
    "Decision",
    "Summary",
    "Things",
    "Schritt",
  ]);
  const unsupportedNames = [...candidates].filter(
    (name) =>
      !sourceWords.has(name.toLowerCase()) &&
      !source.includes(name) &&
      !generic.has(name),
  );
  const forbiddenFacts = (expectations.forbiddenHallucinations || []).filter(
    (fact) => text.toLowerCase().includes(fact.toLowerCase()),
  );
  return {
    unsupportedNumbers,
    unsupportedNames,
    forbiddenFacts,
    passed:
      !unsupportedNumbers.length &&
      !unsupportedNames.length &&
      !forbiddenFacts.length,
  };
}
export function scoreDraft(source, draft, expected) {
  const text = plainText(draft.html);
  const headings = [
    ...draft.html.matchAll(/<h[23]\b[^>]*>(.*?)<\/h[23]>/g),
  ].map((m) => plainText(m[1]));
  const missingTerms = expected.requiredTerms.filter(
    (term) => !text.toLowerCase().includes(term.toLowerCase()),
  );
  const faithfulness = checkFaithfulness(source, draft, expected);
  const review =
    draft.html.split(
      /<h2>\s*(?:Things a reviewer should check|Was ein Reviewer prüfen sollte)\s*<\/h2>/i,
    )[1] || "";
  const reviewerItems = (review.match(/<li\b/g) || []).length;
  const sourceRows = source
    .split("\n")
    .filter((line) => /^\|/.test(line) && !/^\|[\s|:-]+$/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((s) => s.trim()),
    );
  const outputRows = [
    ...draft.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g),
  ].map((m) =>
    [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) =>
      plainText(cell[1]),
    ),
  );
  const tablePreserved =
    !expected.preserveTable ||
    (sourceRows.length > 0 &&
      sourceRows.every((row) =>
        outputRows.some((out) => JSON.stringify(out) === JSON.stringify(row)),
      ));
  const checks = {
    title: draft.title.length <= expected.titleMaxLength,
    headings:
      headings.length >= expected.headingCount.min &&
      headings.length <= expected.headingCount.max,
    requiredTerms: missingTerms.length === 0,
    faithfulness: faithfulness.passed,
    table: tablePreserved,
    reviewerChecklist: reviewerItems >= 3,
    language:
      expected.language === "de"
        ? headings[0] === "Zusammenfassung" &&
          headings.at(-1) === "Was ein Reviewer prüfen sollte"
        : headings[0] === "Summary" &&
          headings.at(-1) === "Things a reviewer should check",
  };
  const weights = {
    title: 10,
    headings: 10,
    requiredTerms: 20,
    faithfulness: 30,
    table: 10,
    reviewerChecklist: 10,
    language: 10,
  };
  return {
    score: Object.entries(checks).reduce(
      (sum, [key, ok]) => sum + (ok ? weights[key] : 0),
      0,
    ),
    checks,
    missingTerms,
    faithfulness,
    headingCount: headings.length,
    reviewerItems,
  };
}
