const reserved = new Set([
  "www",
  "demo",
  "api",
  "admin",
  "app",
  "mail",
  "smtp",
  "support",
  "help",
  "billing",
  "login",
  "welcome",
  "status",
  "wissen",
  "test",
  "staging",
  "internal",
  "root",
  "ftp",
  "autodiscover",
]);
export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug))
    return "Use 3–30 lowercase letters, numbers or hyphens. Start and end with a letter or number.";
  if (reserved.has(slug))
    return "This address is reserved. Please choose another.";
  return null;
}
