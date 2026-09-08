import type { NextConfig } from "next";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
// The parser is a child process: trace its complete runtime dependency graph.
function parserDependencies() {
  const seen = new Set<string>();
  function visit(name: string, parent: string) {
    const require = createRequire(parent);
    let directory: string;
    try {
      directory = dirname(require.resolve(`${name}/package.json`));
    } catch {
      try {
        directory = dirname(require.resolve(name));
      } catch {
        return;
      }
    }
    while (!existsSync(join(directory, "package.json")))
      directory = dirname(directory);
    const manifest = join(directory, "package.json");
    if (seen.has(directory)) return;
    seen.add(directory);
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    for (const dep of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    }))
      visit(dep, manifest);
  }
  for (const name of ["mammoth", "pdf-parse", "yauzl"])
    visit(name, join(process.cwd(), "package.json"));
  return [...seen].map((path) => `./${relative(process.cwd(), path)}/**/*`);
}
const config: NextConfig = {
  output: "standalone",
  // Keep PDF.js worker/native module resolution intact in the Node runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/intake": ["./scripts/intake-extract.mjs", ...parserDependencies()],
  },
  poweredByHeader: false,
  experimental: { cpus: 2 },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
