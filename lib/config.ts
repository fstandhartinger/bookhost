export const PLAN = { name: "Team", price: 39, currency: "EUR", trialDays: 14 };
export function baseUrl() {
  return (
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    "https://wissen.app.mintapis.com"
  ).replace(/\/$/, "");
}
export const smtpReady = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
