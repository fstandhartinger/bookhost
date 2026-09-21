/**
 * Citation markers must index the source list that is actually returned: the
 * first cited passage becomes [1], the second [2], and so on, no matter where
 * the passage sat in the retrieved list.
 */

/**
 * The 1-based marker for `passage` in the first-appearance order `order`;
 * a passage cited for the first time is appended to it.
 */
export function citationMarker(order: number[], passage: number): number {
  let position = order.indexOf(passage);
  if (position === -1) {
    order.push(passage);
    position = order.length - 1;
  }
  return position + 1;
}

export type RenumberedCitations = {
  text: string;
  /** Original 1-based passage numbers in the order the sources must be listed. */
  citations: number[];
};

/**
 * Rewrite bracketed markers in a model answer so that [n] indexes the source
 * list that is returned: markers are renumbered by first appearance and
 * markers outside 1..passageCount are dropped, never left dangling.
 */
export function renumberCitations(
  text: string,
  passageCount: number,
): RenumberedCitations {
  const citations: number[] = [];
  const rewritten = text.replace(/\[(\d+)\]/g, (_marker, digits: string) => {
    const passage = Number(digits);
    if (!Number.isSafeInteger(passage) || passage < 1 || passage > passageCount)
      return "";
    return `[${citationMarker(citations, passage)}]`;
  });
  return { text: tidy(rewritten), citations };
}

/** Close the gaps a dropped marker leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
}
