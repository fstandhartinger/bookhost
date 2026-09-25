import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    fileParallelism: process.env.INTAKE_DB_TEST !== "1",
    environment: "node",
    environmentMatchGlobs: [
      ["tests/wiki-chat-mounted.test.ts", "happy-dom"],
      ["tests/wiki-chat-enter.test.ts", "happy-dom"],
      ["tests/wiki-chat-demo.test.ts", "happy-dom"],
    ],
    include: ["tests/**/*.test.ts"],
  },
});
