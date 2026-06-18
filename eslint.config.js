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
    // Type-aware linting (blueprint §6): forbid silencing the type system. Scoped to the
    // blueprint's explicit rule list (not full recommended-type-checked) so the guard stays
    // proportional to a 26-file plugin.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-nocheck": true, "ts-expect-error": "allow-with-description" },
      ],
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
