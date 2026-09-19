import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  attributionFor,
  resetAttributionForTests,
} from "@/lib/analytics/attribution";

beforeEach(() => resetAttributionForTests());
afterEach(() => vi.unstubAllGlobals());

it("returns the current campaign and keeps it in memory for SPA navigation", () => {
  const first = attributionFor("?utm_source=Reddit&utm_medium=social", false);
  expect(first).toEqual({
    utm_source: "reddit",
    utm_medium: "social",
    utm_campaign: null,
  });
  // Follow-up page views without parameters keep the attribution; a full
  // reload (fresh module state) would start empty.
  expect(attributionFor("", false)).toEqual(first);
  expect(attributionFor("/no-query", false)).toEqual(first);
});

it("a new campaign replaces the saved one", () => {
  attributionFor("?utm_source=first", false);
  attributionFor("?utm_source=second", false);
  expect(attributionFor("", false)).toMatchObject({ utm_source: "second" });
});

it("disabled returns nothing and clears the saved attribution", () => {
  expect(attributionFor("?utm_source=X", true)).toEqual({});
  expect(attributionFor("", false)).toEqual({
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
  });
});

it("never touches browser storage globals", () => {
  // The consent decision (docs/visitor-statistics-consent-decision.md) rests on
  // memory-only attribution: any get/set/delete on the stubbed storage globals
  // would be recorded here.
  const touched: string[] = [];
  const guard = {
    get: (_target: object, key: string) => {
      touched.push(`get ${String(key)}`);
      return undefined;
    },
    set: (_target: object, key: string) => {
      touched.push(`set ${String(key)}`);
      return true;
    },
    deleteProperty: (_target: object, key: string) => {
      touched.push(`delete ${String(key)}`);
      return true;
    },
  };
  vi.stubGlobal("sessionStorage", new Proxy({}, guard));
  vi.stubGlobal("localStorage", new Proxy({}, guard));
  attributionFor("?utm_source=probe", false);
  attributionFor("", false);
  attributionFor("?utm_source=probe2", true);
  attributionFor("", false);
  expect(touched).toEqual([]);
});