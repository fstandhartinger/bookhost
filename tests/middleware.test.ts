import { describe, expect, it, afterEach } from "vitest";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const original = process.env.REDIRECT_LEGACY_HOSTS;
afterEach(() => { process.env.REDIRECT_LEGACY_HOSTS = original; });

function request(path: string, host: string) {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

describe("legacy host redirect", () => {
  it("redirects pages with path and query", () => {
    process.env.REDIRECT_LEGACY_HOSTS = "true";
    const response = middleware(request("/pricing?from=old", "wissen.app.mintapis.com"));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://bookhost.co/pricing?from=old");
  });
  it("keeps APIs and health checks on the legacy host", () => {
    process.env.REDIRECT_LEGACY_HOSTS = "true";
    expect(middleware(request("/api/stripe/webhook", "wissen.app.mintapis.com")).status).toBe(200);
    expect(middleware(request("/healthz", "wissen.app.mintapis.com")).status).toBe(200);
  });
  it("keeps tenant subdomains on the tenant domain", () => {
    process.env.REDIRECT_LEGACY_HOSTS = "true";
    expect(middleware(request("/login", "demo.wissen.app.mintapis.com")).status).toBe(200);
  });
});
