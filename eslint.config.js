import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

const jsxA11yTyped =
  /** @type {{ flatConfigs: Record<string, import("eslint").Linter.Config> }} */ (jsxA11y);

export default [
  {
    ignores: ["dist/", "examples/", "node_modules/", "scripts/", "coverage/", ".pnpm-store/"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ...jsxA11yTyped.flatConfigs.recommended,
    // This block keeps the a11y gate. The 5 orphaned `react-hooks/*` inline directives
    // reference a plugin we intentionally don't load here, so don't fail on them.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...jsxA11yTyped.flatConfigs.recommended.rules,
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
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
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
    // Giant files and god functions are forbidden (blueprint §25). New code must stay within
    // these limits; the pre-existing offenders are tracked under tracking/waivers/0004 and
    // relaxed in the override block below until they are split.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 10],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
    },
  },
  {
    // Pre-existing oversized / over-complex files (blueprint §25 + §35 phased migration).
    // Tracked debt: see tracking/waivers/0004-legacy-file-size-complexity.md (expiry + plan).
    // Only the three rules these files violate are relaxed; max-params/max-depth stay enforced,
    // and every NEW file remains fully gated by the block above.
    files: [
      "src/main.ts",
      "src/model/board.ts",
      "src/model/card.ts",
      "src/model/columns.ts",
      "src/obsidian/vaultRepo.ts",
      "src/ui/App.tsx",
      "src/ui/Board.tsx",
      "src/ui/CardContextMenu.tsx",
      "src/ui/CardDetail.tsx",
      "src/ui/CardItem.tsx",
      "src/ui/Column.tsx",
      "src/ui/ColumnEditModal.tsx",
      "src/ui/ColumnMenu.tsx",
      "src/ui/Toolbar.tsx",
      "src/ui/cardView.ts",
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
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
  // Scope the obsidianmd recommended preset to src only — test files must get ZERO obsidianmd
  // rules. The preset ships file-less blocks (global rules/plugins/languageOptions) that would
  // otherwise apply everywhere; force `files: ["src/**/*.{ts,tsx}"]` on every block except:
  //  - a pure global-ignores block (ignores-only, no files/rules/plugins/languageOptions), and
  //  - the package.json block, which sets `language: "json/json"`; re-globbing it onto our
  //    TS/TSX sources would parse them as JSON and fatally error. It targets package.json (not
  //    under src/), so it cannot leak obsidianmd findings onto test files — leave it untouched.
  // This keeps plugin registration and rule blocks glob-aligned so the obsidianmd namespace
  // resolves for src files.
  ...obsidianmd.configs.recommended.map((c) =>
    (c.ignores && !c.files && !c.rules && !c.plugins && !c.languageOptions) || c.language
      ? c
      : { ...c, files: ["src/**/*.{ts,tsx}"] },
  ),
  {
    // no-undef is redundant with the TS type-checker, and `activeWindow`/`activeDocument` are
    // valid Obsidian ambient globals. Disable it for the TS sources the preset enables it on.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-undef": "off" },
  },
  {
    // "Folia Kanban" is the product/brand name, not a phrase to sentence-case. Register it with
    // the rule's `brands` option so the official casing is preserved wherever the name appears in
    // UI strings (ribbon tooltip, placeholders, the view's display text). Listing the words
    // independently lets the rule match each as a brand token with word boundaries. Placed after
    // the preset spread so it wins the rule's options for src.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "obsidianmd/ui/sentence-case": ["error", { brands: ["Folia", "Kanban"] }],
    },
  },
  {
    // The obsidianmd recommended preset turns on type-aware @typescript-eslint rules but only
    // sets the parser, not parserServices. Provide the project service for every linted ts/tsx
    // file (tsconfig includes both src and test) so those rules can resolve type info instead of
    // crashing fatally on files outside the existing src-only type-aware block above. Placed
    // after the spread so these parserOptions win the languageOptions merge.
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
