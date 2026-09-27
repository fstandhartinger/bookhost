import { expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { publicPath } from "@/lib/analytics/shared";

it("accepts every sitemap path in the analytics allowlist", () => {
  const entries = sitemap();
  expect(entries.length).toBeGreaterThan(0);
  const pathnames = entries.map((entry) => new URL(entry.url).pathname);
  expect(pathnames).toContain("/agents");
  expect(pathnames).toContain("/bookstack-mcp");
  for (const pathname of pathnames) {
    expect(publicPath(pathname)).toBe(pathname);
  }
});

it("keeps private and unlisted paths out of the analytics allowlist", () => {
  for (const path of [
    "/join",
    "/join/abc",
    "/welcome",
    "/welcome?session_id=x",
    "/app",
    "/app/agents",
    "/admin",
    "/admin/stats",
    "/login/other",
  ]) {
    expect(publicPath(path)).toBeNull();
  }
});
