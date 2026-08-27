import { defineConfig } from "vitest/config";
import path from "path";

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
