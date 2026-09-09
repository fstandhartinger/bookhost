import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { db } from "./db";
import { baseUrl } from "./config";
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(baseUrl()).origin;
}
// Native form navigation under Referrer-Policy: no-referrer uses Origin: null.
// Fetch Metadata is browser-controlled: cross-origin documents cannot forge
// Sec-Fetch-Site: same-origin. Missing Origin and foreign origins still fail.
export function sameOriginForm(request: Request) {
  return (
    sameOrigin(request) ||
    (request.method === "POST" &&
      request.headers.get("origin") === "null" &&
      request.headers.get("sec-fetch-site") === "same-origin" &&
      request.headers.get("sec-fetch-mode") === "navigate")
  );
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function rateLimit(key: string, limit = 10, windowSeconds = 3600) {
  const result = await db.query(
    `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+make_interval(secs => $2)) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+make_interval(secs => $2) ELSE rate_limits.expires_at END RETURNING hits`,
    [key, windowSeconds],
  );
  return result.rows[0].hits <= limit;
}

// Only enable TRUST_PROXY on a listener reachable exclusively through the proxy.
export function clientIp(request: Request): string | null {
  const socket = (request as Request & { socket?: { remoteAddress?: string } })
    .socket?.remoteAddress;
  const value =
    process.env.TRUST_PROXY === "true"
      ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        socket ||
        request.headers.get("x-real-ip")
      : socket || request.headers.get("x-real-ip");
  return value && isIP(value) ? value : null;
}
export function freshAuthentication(authTime: unknown): boolean {
  const now = Math.floor(Date.now() / 1000);
  return (
    typeof authTime === "number" && authTime <= now && now - authTime < 900
  );
}
