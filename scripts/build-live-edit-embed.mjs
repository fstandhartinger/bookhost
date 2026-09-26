// Bundles the Live Edit browser client (lib/live-edit/client/embed.ts) into a single
// self-contained IIFE at public/live-edit/embed.js, ready to be served statically and
// injected into BookStack pages via a <script> tag. No external CDN dependencies —
// Yjs / Tiptap / hocuspocus-provider are all bundled in.
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const entryPoint = fileURLToPath(new URL("../lib/live-edit/client/embed.ts", import.meta.url));
const outfile = fileURLToPath(new URL("../public/live-edit/embed.js", import.meta.url));

await esbuild.build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});

console.log(`live-edit embed built -> ${outfile}`);
