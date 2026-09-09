import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    fileParallelism: process.env.INTAKE_DB_TEST !== "1",
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
