export const PLAN = { name: "Team", price: 39, currency: "EUR", trialDays: 14 };
export const PRODUCT_NAME = process.env.PRODUCT_NAME || "BookHost";
export const PUBLIC_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://bookhost.co"
).replace(/\/$/, "");
export const LEGACY_HOSTS = (
  process.env.LEGACY_HOSTS || "wissen.app.mintapis.com"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
export const DEFENSIVE_HOSTS = (
  process.env.DEFENSIVE_HOSTS ||
  "bookhost.cloud,www.bookhost.cloud,bookhost.online,www.bookhost.online,bookhost.site,www.bookhost.site"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
export const NEW_TENANT_DOMAIN = process.env.NEW_TENANT_DOMAIN || "bookhost.co";
export const TENANT_DOMAINS = (
  process.env.TENANT_DOMAINS || "wissen.app.mintapis.com,bookhost.co"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
export const DEMO_URL =
  process.env.DEMO_URL || "https://demo.bookhost.co";
// Inbound email routing is independent of workspace web hosts.
export const INTAKE_TENANT_DOMAIN = "wissen.app.mintapis.com";
export function baseUrl() {
  return (
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    PUBLIC_BASE_URL
  ).replace(/\/$/, "");
}
export const smtpReady = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
