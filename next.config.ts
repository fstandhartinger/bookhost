import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  // Keep PDF.js worker/native module resolution intact in the Node runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/intake": [
      "./node_modules/pdf-parse/dist/**/*",
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
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
