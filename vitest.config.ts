import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    // Blueprint §22: a missing-test run or a stray .only must fail, not pass quietly.
    passWithNoTests: false,
    allowOnly: false,
  },
});
