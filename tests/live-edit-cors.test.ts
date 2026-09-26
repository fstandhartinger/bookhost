import { describe, expect, it } from "vitest";
import { corsHeaders, corsPreflight } from "@/lib/live-edit/cors";

const req = (origin: string | null) =>
  new Request("https://bookhost.co/api/live-edit/join", {
    headers: origin ? { origin } : {},
  });

describe("Live Edit CORS", () => {
  it("allows a tenant subdomain origin and echoes it back", () => {
    const headers = corsHeaders(req("https://acme.bookhost.co"));
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": "https://acme.bookhost.co",
    });
  });

  it("allows the bare tenant domain itself", () => {
    const headers = corsHeaders(req("https://bookhost.co"));
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": "https://bookhost.co",
    });
  });

  it("rejects an unrelated origin", () => {
    expect(corsHeaders(req("https://evil.example.com"))).toEqual({});
    expect(corsHeaders(req("https://bookhost.co.evil.com"))).toEqual({});
    expect(corsHeaders(req("https://not-bookhost.co"))).toEqual({});
  });

  it("rejects a www subdomain (not a tenant workspace)", () => {
    expect(corsHeaders(req("https://www.bookhost.co"))).toEqual({});
  });

  it("has no CORS headers when no Origin header is present", () => {
    expect(corsHeaders(req(null))).toEqual({});
  });

  it("preflight allows a valid tenant origin and denies others", () => {
    const ok = corsPreflight(req("https://acme.bookhost.co"));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://acme.bookhost.co",
    );
    const denied = corsPreflight(req("https://evil.example.com"));
    expect(denied.status).toBe(403);
  });
});
