import { describe, expect, it } from "vitest";
import { headerLinksFor } from "@/components/header-account-links";

describe("headerLinksFor", () => {
  it("links to the workspace on signed-in /app paths", () => {
    for (const pathname of ["/app", "/app/chat"]) {
      const links = headerLinksFor(pathname);
      expect(links.some((link) => link.href === "/app")).toBe(true);
      expect(links.some((link) => link.href === "/login")).toBe(false);
      expect(links.some((link) => link.href === "/pricing")).toBe(false);
      expect(links.some((link) => link.label === "Your workspace")).toBe(true);
    }
  });

  it("keeps the public links on every other path", () => {
    for (const pathname of ["/", "/pricing", "/application-form", null]) {
      const links = headerLinksFor(pathname);
      expect(links.some((link) => link.href === "/login")).toBe(true);
      expect(links.some((link) => link.href === "/pricing")).toBe(true);
      expect(links.some((link) => link.label === "Your workspace")).toBe(false);
    }
  });
});
