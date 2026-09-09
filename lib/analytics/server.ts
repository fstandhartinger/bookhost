import { createHmac, randomBytes } from "node:crypto";
import { clientIp } from "@/lib/security";
// Random salt is never persisted or derived from an enduring application secret.
export function dailyHasher() {
  let day = "";
  let salt = randomBytes(32);
  let expires = 0;
  let timer: NodeJS.Timeout | undefined;
  return (ip: string, ua: string, now = new Date()) => {
    const next = now.toISOString().slice(0, 10);
    if (next !== day || now.getTime() >= expires) {
      salt.fill(0);
      salt = randomBytes(32);
      day = next;
      expires = Date.parse(next + "T00:00:00Z") + 86400000;
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => {
          salt.fill(0);
          day = "";
        },
        Math.max(1, expires - now.getTime()),
      );
      timer.unref();
    }
    return createHmac("sha256", salt)
      .update(JSON.stringify([ip, ua.slice(0, 512)]))
      .digest("hex");
  };
}
const state = globalThis as typeof globalThis & {
  analyticsHasher?: ReturnType<typeof dailyHasher>;
};
export const visitorHash = (state.analyticsHasher ??= dailyHasher());
export function requestHash(request: Request) {
  const ip = clientIp(request);
  return ip ? visitorHash(ip, request.headers.get("user-agent") || "") : null;
}
export function isAdmin(email: string | null | undefined) {
  return (
    !!email &&
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.toLowerCase())
  );
}
