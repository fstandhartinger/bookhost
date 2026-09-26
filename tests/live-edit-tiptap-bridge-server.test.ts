// @vitest-environment node
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Live Edit Tiptap bridge in the BookHost server runtime", () => {
  it("loads BookStack HTML from the same CommonJS bundle used by the custom server", () => {
    const bundled = buildSync({
      entryPoints: [resolve("lib/live-edit/tiptap-bridge.ts")],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      packages: "external",
      tsconfig: "tsconfig.json",
      write: false,
    }).outputFiles[0].text;
    const module = { exports: {} as Record<string, unknown> };
    const require = createRequire(import.meta.url);
    new Function("require", "module", "exports", bundled)(require, module, module.exports);
    const bridge = module.exports as {
      seedYdocFromHtml: (html: string) => unknown;
      htmlFromYdoc: (doc: unknown) => string;
    };
    const doc = bridge.seedYdocFromHtml("<p>Server document load</p>");
    const roundTrip = bridge.htmlFromYdoc(doc);

    expect(roundTrip).toContain("Server document load");
  });
});
