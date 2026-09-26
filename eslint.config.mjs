import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // Generated bundles, not source — see scripts/build-live-edit-embed.mjs
      // and scripts/build-server.mjs.
      "public/live-edit/embed.js",
      "live-edit-server.js",
    ],
  },
];

export default config;
