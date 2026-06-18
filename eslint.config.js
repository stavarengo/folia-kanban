import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";

export default [
  {
    ignores: ["dist/", "examples/", "node_modules/", "scripts/", "coverage/", ".pnpm-store/"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ...jsxA11y.flatConfigs.recommended,
    // This block keeps the a11y gate. The 5 orphaned `react-hooks/*` inline directives
    // reference a plugin we intentionally don't load here, so don't fail on them.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // autofocus is deliberate focus management for modals/inline-edit (good a11y here).
      "jsx-a11y/no-autofocus": "off",
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    // Architecture boundary (blueprint §8/§15): the Obsidian API may be imported only by
    // the adapter (src/obsidian) and the plugin shell (main.ts/view.tsx). The domain and
    // the UI go through the CardRepository port (src/model/repo.ts).
    files: ["src/model/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "obsidian",
              message:
                "UI and domain must not import the Obsidian API directly. Use the CardRepository port (src/model/repo.ts); only src/obsidian/** and the plugin shell may touch obsidian.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tests must not be skipped or focused (blueprint §22).
    files: ["test/**/*.{ts,tsx}"],
    plugins: { vitest },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...vitest.environments.env.globals,
      },
    },
    rules: {
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
    },
  },
];
