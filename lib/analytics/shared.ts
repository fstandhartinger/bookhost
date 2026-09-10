import {
  DEFENSIVE_HOSTS,
  LEGACY_HOSTS,
  PUBLIC_BASE_URL,
  TENANT_DOMAINS,
} from "@/lib/config";
// Campaign labels only: reject URLs, email addresses and arbitrary free text.
export function campaign(value: unknown): string | null {
  return typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value)
    ? value.toLowerCase()
    : null;
}
export function parseUtm(params: URLSearchParams) {
  return {
    utm_source: campaign(params.get("utm_source")),
    utm_medium: campaign(params.get("utm_medium")),
    utm_campaign: campaign(params.get("utm_campaign")),
  };
}
export function publicPath(value: unknown): string | null {
  // Never store account IDs, checkout tokens, search strings or private paths.
  return typeof value === "string" &&
    /^\/(?:pricing|login(?:\/reset)?|cancel|legal\/(?:datenschutz|impressum|agb|avv))?$/.test(
      value,
    )
    ? value
    : null;
}
// Our own hosts are navigation, not a channel. Counting them would bury the
// referrers we actually want to see, such as the listing in the BookStack
// installation docs, under our own page-to-page traffic.
export function ownHost(host: string): boolean {
  const mine = [
    (() => {
      try {
        return new URL(PUBLIC_BASE_URL).hostname;
      } catch {
        return "";
      }
    })(),
    ...LEGACY_HOSTS,
    ...DEFENSIVE_HOSTS,
    ...TENANT_DOMAINS,
  ].filter(Boolean);
  return mine.some((own) => host === own || host.endsWith(`.${own}`));
}
export function referrerHost(value: unknown): string | null {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.slice(0, 253).toLowerCase();
    return ownHost(host) ? null : host;
  } catch {
    return null;
  }
}
export function optedOut(headers: Headers) {
  return (
    headers.get("dnt") === "1" ||
    headers.get("sec-gpc") === "1" ||
    headers.get("x-wissen-no-analytics") === "1"
  );
}
