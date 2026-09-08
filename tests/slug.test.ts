import { it, expect } from "vitest";
import { validateSlug } from "../lib/slug";
it.each(["my-team", "abc", "a12", "a".repeat(30)])("accepts %s", (slug) =>
  expect(validateSlug(slug)).toBeNull(),
);
it.each([
  "ab",
  "a".repeat(31),
  "-abc",
  "abc-",
  "Abc",
  "a_b",
  "a.b",
  "demo",
  "www",
  "api",
  "admin",
  "foo/bar",
  "<script>",
  "über",
])("rejects %s", (slug) => expect(validateSlug(slug)).toBeTruthy());
