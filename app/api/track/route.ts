import { db } from "@/lib/db";
import { rateLimit, sameOrigin } from "@/lib/security";
import { requestHash } from "@/lib/analytics/server";
import {
  optedOut,
  parseUtm,
  publicPath,
  referrerHost,
} from "@/lib/analytics/shared";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const done = () =>
    new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  if (!sameOrigin(request) || optedOut(request.headers)) return done();
  try {
    const hash = requestHash(request);
    if (!hash || !(await rateLimit("analytics:" + hash, 60, 60))) return done();
    // Bound streamed bodies, including chunked requests with no Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return done();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done: ended, value } = await reader.read();
      if (ended) break;
      size += value.length;
      if (size > 2048) {
        await reader.cancel();
        return done();
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return done();
    const path = publicPath(body.path);
    if (!path) return done();
    const utm = parseUtm(
      new URLSearchParams({
        utm_source: typeof body.utm_source === "string" ? body.utm_source : "",
        utm_medium: typeof body.utm_medium === "string" ? body.utm_medium : "",
        utm_campaign:
          typeof body.utm_campaign === "string" ? body.utm_campaign : "",
      }),
    );
    if (body.name === "demo_click") {
      await db.query(
        "INSERT INTO events(name,utm_source,visitor_hash) VALUES('demo_click',$1,$2)",
        [utm.utm_source, hash],
      );
    } else if (!body.name) {
      await db.query(
        "INSERT INTO page_views(path,referrer_host,utm_source,utm_medium,utm_campaign,visitor_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          path,
          referrerHost(body.referrer),
          utm.utm_source,
          utm.utm_medium,
          utm.utm_campaign,
          hash,
        ],
      );
    }
  } catch {
    /* Analytics must never interfere with navigation. */
  }
  return done();
}
