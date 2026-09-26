// Bundles server-src/main.ts (the custom server that adds Live Edit's
// WebSocket upgrade path around Next's own request handler) into
// ./live-edit-server.js. Only our own source is bundled (`packages: "external"`
// leaves every node_modules import as a normal runtime require) — Next itself,
// pg, @hocuspocus/server, yjs and everything else stay ordinary dependencies
// resolved from node_modules at container start, so this build step can't
// silently miss a transitive dependency the way manual output-file-tracing
// lists (see next.config.ts) can for a hand-rolled custom server.
import { build } from "esbuild";

await build({
  entryPoints: ["server-src/main.ts"],
  outfile: "live-edit-server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: false,
  logLevel: "info",
});
