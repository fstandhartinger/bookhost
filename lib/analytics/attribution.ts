import { parseUtm } from "./shared";
// Campaign attribution for statistics lives ONLY in the memory of the open
// page: it survives client-side (SPA) navigations and is gone after a full
// reload. No cookie and no browser storage is used (see
// docs/visitor-statistics-consent-decision.md).
export interface Attribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}
let saved: Attribution | null = null;
export function attributionFor(
  search: string,
  disabled: boolean,
): Attribution | Record<string, never> {
  if (disabled) {
    saved = null;
    return {};
  }
  const current = parseUtm(
    new URLSearchParams(search.startsWith("?") ? search : `?${search}`),
  );
  if (current.utm_source) {
    saved = current;
    return current;
  }
  return saved ?? current;
}
export function resetAttributionForTests() {
  saved = null;
}