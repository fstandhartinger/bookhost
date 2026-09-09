export const PLAN = { name: "Team", price: 39, currency: "EUR", trialDays: 14 };
export const PRODUCT_NAME = process.env.PRODUCT_NAME || "BookHost";
export const PUBLIC_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://bookhost.co"
).replace(/\/$/, "");
export const LEGACY_HOSTS = (process.env.LEGACY_HOSTS || "wissen.app.mintapis.com")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
export const TENANT_DOMAIN = process.env.TENANT_DOMAIN || "wissen.app.mintapis.com";
export function baseUrl() {
  return (
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    PUBLIC_BASE_URL
  ).replace(/\/$/, "");
}
export const smtpReady = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
