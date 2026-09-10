export const RESERVED_TEST_PREFIXES = ["rc-", "fb-", "nh-", "dom-", "bh-", "tmp-", "test-"] as const;

const reserved = new Set([
  "www",
  "demo",
  "api",
  "admin",
  "app",
  "mail",
  "smtp",
  "imap",
  "ftp",
  "ns1",
  "ns2",
  "status",
  "restore",
  "backup",
  "test",
  "e2e-test",
  "wissen",
  "bookstack",
  "login",
  "billing",
  "support",
  "help",
  "docs",
  "blog",
  "cdn",
  "static",
  "assets",
]);
export function isReservedTestSlug(slug: string): boolean {
  return RESERVED_TEST_PREFIXES.some((prefix) => slug.startsWith(prefix));
}
export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug))
    return "Use 3–30 lowercase letters, numbers or hyphens. Start and end with a letter or number.";
  if (isReservedTestSlug(slug))
    return "This address is reserved for isolated test workspaces. Please choose another.";
  if (slug.includes("--") || slug.startsWith("restore") || reserved.has(slug))
    return "This address is reserved. Please choose another.";
  return null;
}
