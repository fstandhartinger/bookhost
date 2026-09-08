import { createHash } from "node:crypto";
import { db } from "./db";
import { baseUrl } from "./config";
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(baseUrl()).origin;
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
