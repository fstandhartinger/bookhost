import { TENANT_DOMAINS } from "@/lib/config";
import { db } from "@/lib/db";

// The embed script (lib/live-edit/client/embed.ts) runs on a tenant
// subdomain (e.g. https://acme.bookhost.co) and calls these control-plane
// routes cross-origin. The actual authorization is the ticket/join-token
// signature, not this header — CORS here only decides which pages' JavaScript
// is allowed to *read* the response, so it's scoped to our own tenant
// subdomain family (mirroring lib/agents/access.ts#requestHost's validation),
// never a bare wildcard.
function canonicalHttpsOrigin(request: Request): { origin: string; host: string } | null {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  // Browser Origin values are canonical scheme + host only. Reject credentials,
  // ports, paths and non-HTTPS origins before considering any tenant mapping.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    origin !== url.origin
  )
    return null;
  return { origin, host: url.hostname.toLowerCase() };
}

const TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

async function allowedOrigin(request: Request): Promise<string | null> {
  const parsed = canonicalHttpsOrigin(request);
  if (!parsed) return null;
  const { origin, host } = parsed;

  // Standard tenant hosts have exactly one workspace label before a configured
  // tenant domain. Confirm the slug still maps to a running workspace.
  for (const domain of TENANT_DOMAINS) {
    const suffix = `.${domain}`;
    if (!host.endsWith(suffix)) continue;
    const slug = host.slice(0, -suffix.length);
    if (!TENANT_SLUG.test(slug) || slug === "www") return null;
    try {
      const tenant = (
        await db.query(
          "SELECT 1 FROM tenants WHERE slug=$1 AND status='running' AND desired_state='running' LIMIT 1",
          [slug],
        )
      ).rows[0];
      return tenant ? origin : null;
    } catch {
      return null;
    }
  }

  // Custom domains are admitted only after BookHost has verified and activated
  // the exact hostname for a running workspace. This also covers active
  // aliases that are not the workspace's primary `tenants.host` value.
  try {
    const tenant = (
      await db.query(
        `SELECT 1 FROM tenants t
         WHERE t.status='running' AND t.desired_state='running'
           AND lower(t.host)=lower($1)
         UNION
         SELECT 1 FROM tenant_domains d JOIN tenants t ON t.team_id=d.team_id
         WHERE lower(d.host)=lower($1) AND d.status='active'
           AND d.removal_requested_at IS NULL
           AND t.status='running' AND t.desired_state='running'
         LIMIT 1`,
        [host],
      )
    ).rows[0];
    return tenant ? origin : null;
  } catch {
    return null;
  }
}

export async function corsHeaders(request: Request): Promise<HeadersInit> {
  const origin = await allowedOrigin(request);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function corsPreflight(request: Request): Promise<Response> {
  const origin = await allowedOrigin(request);
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
