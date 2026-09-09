import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { sameOriginForm, sameOrigin } from "@/lib/security";
import { baseUrl } from "@/lib/config";
it("allows native same-origin form navigation with no-referrer but denies opaque cross-site initiators", () => {
  const form = (
    origin: string | undefined,
    site = "same-origin",
    mode = "navigate",
  ) =>
    new Request(baseUrl() + "/api/join/context", {
      method: "POST",
      headers: {
        ...(origin ? { origin } : {}),
        "sec-fetch-site": site,
        "sec-fetch-mode": mode,
      },
    });
  expect(sameOriginForm(form(new URL(baseUrl()).origin))).toBe(true);
  expect(sameOriginForm(form("null"))).toBe(true);
  expect(sameOrigin(form("null"))).toBe(false);
  expect(sameOriginForm(form(undefined))).toBe(false);
  expect(sameOriginForm(form("https://foreign.invalid"))).toBe(false);
  expect(sameOriginForm(form("null", "cross-site"))).toBe(false);
  expect(sameOriginForm(form("null", "same-site"))).toBe(false);
  expect(sameOriginForm(form("null", "same-origin", "cors"))).toBe(false);
});
