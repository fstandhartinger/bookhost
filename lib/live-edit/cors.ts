import { TENANT_DOMAINS } from "@/lib/config";

// The embed script (lib/live-edit/client/embed.ts) runs on a tenant
// subdomain (e.g. https://acme.bookhost.co) and calls these control-plane
// routes cross-origin. The actual authorization is the ticket/join-token
// signature, not this header — CORS here only decides which pages' JavaScript
// is allowed to *read* the response, so it's scoped to our own tenant
// subdomain family (mirroring lib/agents/access.ts#requestHost's validation),
// never a bare wildcard.
function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
  const domain = TENANT_DOMAINS.find(
    (d) => host === d || (host.endsWith(`.${d}`) && host !== `www.${d}`),
  );
  return domain ? origin : null;
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = allowedOrigin(request);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export function corsPreflight(request: Request): Response {
  const origin = allowedOrigin(request);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    },
  });
}
