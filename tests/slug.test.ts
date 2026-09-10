import { it, expect } from "vitest";
import { validateSlug } from "../lib/slug";
import fs from "node:fs";
import path from "node:path";
it.each(["my-team", "abc", "a12", "a".repeat(30)])("accepts %s", (slug) =>
  expect(validateSlug(slug)).toBeNull(),
);
it.each([
  "restore",
  "restore-team",
  "restoreabc",
  "a--b",
  "backup",
  "e2e-test",
  "ns1",
  "bookstack",
  "assets",
  "imap",
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
  "rc-review",
  "fb-acceptance",
  "nh-check",
  "dom-test",
  "bh-fixture",
  "tmp-run",
  "test-workspace",
])("rejects %s", (slug) => expect(validateSlug(slug)).toBeTruthy());

it("keeps control-plane test prefixes synchronized with the provisioner defaults", () => {
  const limits = fs.readFileSync(path.resolve(process.cwd(), "ops/provisioner/limits.env"), "utf8");
  const configured = limits.match(/^RESERVED_TEST_PREFIXES=(.*)$/m)?.[1].split(",").filter(Boolean);
  expect(configured).toEqual(["rc-", "fb-", "nh-", "dom-", "bh-", "tmp-", "test-"]);
});
