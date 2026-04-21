import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/tools/**/*.ts", "src/upstream/**/*.ts", "src/config.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/test-helpers.ts",
        "src/index.ts",
        "src/http_server.ts",
        "src/test-utils.ts",
        "src/tools/context.ts",
        "src/tools/index.ts",
        "src/tools/mail-attachment.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
