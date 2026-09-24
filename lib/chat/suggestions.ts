export type SuggestionRow = { pageName: string; section: string | null };

/** Plain-text index labels only: strip any HTML, control characters and quotes. */
function clean(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/["\u201c\u201d]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const family = /^(What|How) .+\?$/;

/**
 * Deterministic prompt suggestions derived from indexed page/section names.
 * Templates only, no LLM: one section-level question per distinct section
 * comes first for variety, then richer section and page questions;
 * case-insensitive dedupe, capped at four.
 */
export function suggestedQuestions(rows: SuggestionRow[]): string[] {
  const sectionNames: string[] = [];
  const sectionAbout: string[] = [];
  const pageCandidates: string[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const page = clean(row.pageName);
    const section = clean(row.section);
    if (section) sectionNames.push(`How is "${section}" documented?`);
    if (page && section)
      sectionAbout.push(`What does "${page}" say about "${section}"?`);
    if (page) pageCandidates.push(`What is "${page}"?`);
    if (page) pageCandidates.push(`What does "${page}" cover?`);
  }
  const questions: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    ...sectionNames,
    ...sectionAbout,
    ...pageCandidates,
  ]) {
    if (candidate.length < 3 || candidate.length > 500) continue;
    if (!family.test(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(candidate);
    if (questions.length === 4) break;
  }
  return questions;
}
