export type Locale = "en" | "de";
const en = new Set(
  "the and for with not this these is are from a an to of in on should check verify what before after must has have be was were it their our your all at as by or summary review procedure decisions tasks responsibilities device damage accessories switch document inspect off turn".split(
    " ",
  ),
);
const de = new Set(
  "die der das und nicht für mit eine einer dem den ist werden ein eines des zu im auf aus sollte prüfen was vor nach muss hat haben sein wird sind wurde wurden es ihre unser alle bei als oder zusammenfassung prüfung verfahren entscheidungen aufgaben zuständigkeiten gerät ausschalten schäden dokumentieren zubehör freigabe frist zuständigkeit entwurf unterlagen ablauf".split(
    " ",
  ),
);
/** Proportional evidence: three words suffice; ties/neutral technical text stay uncertain. */
export function languageEvidence(
  text: string,
  minimumWords = 3,
): Locale | undefined {
  const words = text.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < minimumWords) return undefined;
  const english = words.filter((w) => en.has(w)).length / words.length;
  const german =
    words.filter((w) => de.has(w) || /[äöüß]/.test(w)).length / words.length;
  if (english >= 0.12 && english > german * 2) return "en";
  if (german >= 0.12 && german > english * 2) return "de";
  return undefined;
}
export function sourceLocale(text: string): Locale {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    languageEvidence(text) ??
    languageEvidence(lines[0] || "", 1) ??
    languageEvidence(
      [...lines].sort((a, b) => b.length - a.length)[0] || "",
      1,
    ) ??
    "en"
  ); // No linguistic evidence (e.g. identifiers only): explicit product default.
}
export function draftHeadings(locale: Locale | undefined) {
  return locale === "de"
    ? { summary: "Zusammenfassung", review: "Was ein Reviewer prüfen sollte" }
    : { summary: "Summary", review: "Things a reviewer should check" };
}
