import { beforeEach, describe, expect, it, vi } from "vitest";
import { corsHeaders, corsPreflight } from "@/lib/live-edit/cors";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query } }));

const req = (origin: string | null) =>
  new Request("https://bookhost.co/api/live-edit/join", {
    headers: origin ? { origin } : {},
  });

beforeEach(() => query.mockReset());

describe("Live Edit CORS", () => {
  it("allows a running tenant subdomain origin and echoes it back", async () => {
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const headers = await corsHeaders(req("https://acme.bookhost.co"));
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": "https://acme.bookhost.co",
    });
  });

  it("does not allow the bare control-plane domain as a tenant origin", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await corsHeaders(req("https://bookhost.co"))).toEqual({});
  });

  it("rejects an unrelated origin", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await corsHeaders(req("https://evil.example.com"))).toEqual({});
    expect(await corsHeaders(req("https://bookhost.co.evil.com"))).toEqual({});
    expect(await corsHeaders(req("https://not-bookhost.co"))).toEqual({});
  });

  it("rejects non-canonical, non-HTTPS, port and nested tenant origins", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await corsHeaders(req("http://acme.bookhost.co"))).toEqual({});
    expect(await corsHeaders(req("https://acme.bookhost.co:8443"))).toEqual({});
    expect(await corsHeaders(req("https://a.acme.bookhost.co"))).toEqual({});
    expect(await corsHeaders(req("https://www.bookhost.co"))).toEqual({});
  });

  it("allows an exact verified custom workspace domain", async () => {
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const headers = await corsHeaders(req("https://wiki.example.org"));
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": "https://wiki.example.org",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("tenant_domains"), [
      "wiki.example.org",
    ]);
  });

  it("has no CORS headers when no Origin header is present", async () => {
    expect(await corsHeaders(req(null))).toEqual({});
  });

  it("preflight allows a valid tenant origin and denies others", async () => {
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const ok = await corsPreflight(req("https://acme.bookhost.co"));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://acme.bookhost.co",
    );
    query.mockResolvedValueOnce({ rows: [] });
    const denied = await corsPreflight(req("https://evil.example.com"));
    expect(denied.status).toBe(403);
  });
});
