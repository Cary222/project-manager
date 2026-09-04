import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["e2e/**", "node_modules/**", "**/*.test.mjs"],
  },
  resolve: {
    alias: {
      // server-only 包在 jsdom 测试环境会抛错，用空 stub 替代
      "server-only": path.resolve(__dirname, "./vitest.server-only.stub.ts"),
      "@": path.resolve(__dirname, "./"),
    },
  },
});
