import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `obsidian` ships types only, so there is nothing to import at runtime. Point the module id
      // at the in-memory fake (test/obsidianFake.ts) so the vault adapter can be constructed and
      // exercised under test; TypeScript keeps using the real `.d.ts`.
      obsidian: fileURLToPath(new URL("./test/obsidianFake.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    // A missing-test run or a stray .only must fail, not pass quietly.
    passWithNoTests: false,
    allowOnly: false,
  },
});
