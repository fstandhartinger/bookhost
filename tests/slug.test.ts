import { it, expect } from "vitest";
import { RESERVED_TEST_PREFIXES, validateSlug } from "../lib/slug";
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
  const limitsPath = ["ops/provisioner/limits.env", "ops/provisioner/limits.env.example"]
    .map((p) => path.resolve(process.cwd(), p))
    .find((p) => fs.existsSync(p));
  if (!limitsPath) throw new Error("No provisioner limits file found");
  const limits = fs.readFileSync(limitsPath, "utf8");
  const configured = limits.match(/^RESERVED_TEST_PREFIXES=(.*)$/m)?.[1].split(",").filter(Boolean);
  expect(configured).toEqual([...RESERVED_TEST_PREFIXES]);
});
