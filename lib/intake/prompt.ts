/** High-confidence EN/DE routing only; short or mixed sources remain unspecified. */
export function sourceLocale(text: string): "en" | "de" | undefined {
  const words = text.toLowerCase().match(/\p{L}+/gu) || [];
  const english = new Set([
    "the",
    "and",
    "for",
    "with",
    "not",
    "this",
    "these",
    "is",
    "are",
    "from",
  ]);
  const german = new Set([
    "die",
    "der",
    "das",
    "und",
    "nicht",
    "für",
    "mit",
    "eine",
    "einer",
    "dem",
    "den",
    "ist",
    "werden",
  ]);
  const en = words.filter((word) => english.has(word)).length;
  const de = words.filter((word) => german.has(word)).length;
  if (en >= 8 && en > de * 2) return "en";
  if (de >= 8 && de > en * 2) return "de";
  return undefined;
}
export function draftHeadings(locale: "en" | "de" | undefined) {
  return locale === "de"
    ? { summary: "Zusammenfassung", review: "Prüfpunkte für die Freigabe" }
    : { summary: "Summary", review: "Things a reviewer should check" };
}
