import { describe, expect, it, afterEach } from "vitest";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const originalRedirect = process.env.REDIRECT_LEGACY_HOSTS;
afterEach(() => {
  if (originalRedirect === undefined) delete process.env.REDIRECT_LEGACY_HOSTS;
  else process.env.REDIRECT_LEGACY_HOSTS = originalRedirect;
});

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

describe("defensive host redirect", () => {
  it("redirects bookhost.cloud to the canonical root", () => {
    process.env.REDIRECT_LEGACY_HOSTS = "false";
    const response = middleware(request("/", "bookhost.cloud"));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://bookhost.co/");
  });
  it("preserves path and query on www.bookhost.site", () => {
    process.env.REDIRECT_LEGACY_HOSTS = "false";
    const response = middleware(request("/blog/foo?x=1", "www.bookhost.site"));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://bookhost.co/blog/foo?x=1");
  });
  it("keeps defensive host APIs available", () => {
    expect(middleware(request("/api/auth/callback/google", "bookhost.online")).status).toBe(200);
  });
  it("keeps defensive host health checks available", () => {
    expect(middleware(request("/healthz", "bookhost.online")).status).toBe(200);
  });
  it("redirects even when legacy redirects are unset", () => {
    delete process.env.REDIRECT_LEGACY_HOSTS;
    expect(middleware(request("/pricing", "bookhost.online")).status).toBe(301);
  });
  it("does not redirect the canonical host", () => {
    process.env.REDIRECT_LEGACY_HOSTS = "true";
    expect(middleware(request("/pricing", "bookhost.co")).status).toBe(200);
  });
});
