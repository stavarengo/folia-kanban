import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

const jsxA11yTyped =
  /** @type {{ flatConfigs: Record<string, import("eslint").Linter.Config> }} */ (jsxA11y);

/** The preset's own `no-restricted-globals` entries, which any block overriding the rule must keep. */
const obsidianRestrictedGlobals = (
  obsidianmd.configs.recommended.find((c) => c.rules?.["no-restricted-globals"])?.rules?.[
    "no-restricted-globals"
  ] ?? []
).filter((entry) => typeof entry === "object");

const focusedWindowGlobals = ["activeDocument", "activeWindow"];
const focusedWindowMessage =
  "This is the focused window's, not necessarily the board's. Take the document from an element the board rendered (`el.ownerDocument`).";

/** Node's globals: the plugin runs on mobile too, where none of them exist. */
const nodeGlobals = ["process", "Buffer", "global", "require", "__dirname"];
/** The page's globals: the model and MCP have no DOM, and MCP runs with no board open. `self` and
 *  `globalThis` are the page too, and banning them whole also stops an alias
 *  (`const scope = self; scope.document`) from walking around the property ban. */
const domGlobals = ["document", "window", "localStorage", "navigator", "self", "globalThis"];

const nodeMessage = "Node globals are not available on mobile. Keep them to the adapter and shell.";
const domMessage =
  "src/model and src/mcp have no DOM. Pass what they need in from the UI or the adapter.";

/**
 * The `no-restricted-globals` and `no-restricted-properties` option lists for one layer, so a
 * banned global is also banned when reached as `window.x`, `globalThis.x` or `self.x`. ESLint
 * replaces a rule's options per block, so each list re-states the preset's entries and the
 * focused-window ban; a later entry for the same name wins.
 */
function restrictedGlobalRules({ node = false, dom = false } = {}) {
  const banned = new Map(focusedWindowGlobals.map((name) => [name, focusedWindowMessage]));
  if (node) for (const name of nodeGlobals) banned.set(name, nodeMessage);
  if (dom) for (const name of domGlobals) banned.set(name, domMessage);
  const byName = new Map(obsidianRestrictedGlobals.map((entry) => [entry.name, entry]));
  for (const [name, message] of banned) byName.set(name, { name, message });
  return {
    "no-restricted-globals": ["error", ...byName.values()],
    "no-restricted-properties": [
      "error",
      ...["window", "globalThis", "self"].flatMap((object) =>
        [...banned].map(([property, message]) => ({ object, property, message })),
      ),
    ],
  };
}

/**
 * Deliberate jsx-a11y exceptions, kept here rather than as `eslint-disable-next-line` comments:
 * Obsidian's community-directory scanner runs ESLint with its own config, which does not load
 * eslint-plugin-jsx-a11y, and an inline directive naming a rule that config has never heard of is
 * a hard "Definition for rule ... was not found" error on the submission scan.
 *  - the dialog surfaces (`role="dialog"` + `aria-modal`, focus-managed) take onKeyDown to drive
 *    Escape, which the rule reads as an interaction on a non-interactive element;
 *  - the drag handles get their role/tabIndex from spread dnd-kit attributes, which the rule
 *    cannot see;
 *  - click-to-edit on the description is a convenience with a real keyboard equivalent (the
 *    "Edit description" button rendered next to it).
 *
 * ESLint can only switch a rule off per FILE, so these blocks are wider than the call sites they
 * exist for. `pnpm a11y-exceptions:check` (in `pnpm verify`) closes that gap: it reads this exact
 * array, re-runs each rule on each file it is switched off for, and requires every remaining
 * violation to sit under an `a11y exception (<rule>): <why>` comment. Adding a file or a rule here
 * widens the fence with it; it cannot open a hole.
 */
export const a11yExceptions = [
  {
    files: ["src/ui/CardDetail.tsx"],
    rules: { "jsx-a11y/no-noninteractive-element-interactions": "off" },
  },
  {
    files: [
      "src/ui/CardDetail.tsx",
      "src/ui/CardItem.tsx",
      "src/ui/Column.tsx",
      "src/ui/Markdown.tsx",
    ],
    rules: { "jsx-a11y/no-static-element-interactions": "off" },
  },
  {
    files: ["src/ui/CardDetail.tsx", "src/ui/Markdown.tsx"],
    rules: { "jsx-a11y/click-events-have-key-events": "off" },
  },
];

export default [
  {
    ignores: ["dist/", "examples/", "node_modules/", "coverage/", ".pnpm-store/"],
  },
  {
    // The guards and release helpers. Node globals, plus the browser's for the callbacks a script
    // hands to a page (Playwright's `page.evaluate`), which run in the page.
    files: ["scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ...jsxA11yTyped.flatConfigs.recommended,
    rules: {
      ...jsxA11yTyped.flatConfigs.recommended.rules,
      // autofocus is deliberate focus management for modals/inline-edit (good a11y here).
      "jsx-a11y/no-autofocus": "off",
      // Renders the host's <select>, which the rule cannot see through the component.
      "jsx-a11y/label-has-associated-control": ["error", { controlComponents: ["HostDropdown"] }],
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
    // Type-aware linting: forbid silencing the type system. Scoped to the
    // an explicit rule list (not full recommended-type-checked) so the guard stays
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
    // Giant files and god functions are forbidden. New code must stay within
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
    // Pre-existing oversized / over-complex files.
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
      "src/ui/CardDetail.tsx",
      "src/ui/CardItem.tsx",
      "src/ui/Column.tsx",
      "src/ui/Toolbar.tsx",
      "src/ui/cardView.ts",
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
  ...a11yExceptions,
  {
    // Tests must not be skipped or focused.
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
  // otherwise apply everywhere, so force `files: ["src/**/*.{ts,tsx}"]` onto them. Two kinds of
  // block must be left exactly as they are:
  //  - a pure global-ignores block (ignores-only, no files/rules/plugins/languageOptions);
  //  - the two blocks targeting `package.json`. One sets `language: "json/json"` (re-globbing it
  //    onto TS/TSX would parse those files as JSON and fatally error); the other has no `language`
  //    and carries 61 rule DISABLES meant for package.json. Re-globbing that one onto src/ used to
  //    silently switch off most of the type-aware gate above — every `no-unsafe-*`, `ban-ts-comment`
  //    and `unbound-method` among them — while this config still claimed to enforce it.
  //    Neither targets anything under src/, so neither can leak obsidianmd findings onto tests.
  // This keeps plugin registration and rule blocks glob-aligned so the obsidianmd namespace
  // resolves for src files.
  ...obsidianmd.configs.recommended.map((c) =>
    (c.ignores && !c.files && !c.rules && !c.plugins && !c.languageOptions) ||
    c.language ||
    [c.files].flat(2).includes("package.json")
      ? c
      : { ...c, files: ["src/**/*.{ts,tsx}"] },
  ),
  {
    // Architecture boundary, placed after the obsidianmd preset spread because that preset turns
    // `no-restricted-imports` off for src. The Obsidian API, and the electron, CodeMirror and Lezer
    // modules the app supplies with it (esbuild.config.mjs marks them external), may be imported
    // only by the adapter (src/obsidian) and the plugin shell (main.ts/view.tsx). Everything else goes
    // through the CardRepository port (src/model/repo.ts).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/obsidian/**", "src/main.ts", "src/view.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "obsidian",
              message:
                "Only src/obsidian/** and the plugin shell (src/main.ts, src/view.tsx) may import the Obsidian API. Use the CardRepository port (src/model/repo.ts).",
            },
            {
              name: "electron",
              message:
                "Obsidian supplies electron at runtime. Only src/obsidian/** and the plugin shell may import it.",
            },
          ],
          patterns: [
            {
              group: ["electron/*", "@codemirror/*", "@lezer/*"],
              message:
                "Obsidian supplies electron, CodeMirror and Lezer at runtime. Only src/obsidian/** and the plugin shell may import them.",
            },
          ],
        },
      ],
    },
  },
  {
    // The same boundary for the ambient globals Obsidian injects: no import is involved, so the
    // import ban cannot see them. This replaces the preset's option list for these files, so its
    // own entries are carried over. Everything here also runs on mobile, so Node's globals stay out.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/obsidian/**", "src/main.ts", "src/view.tsx"],
    rules: restrictedGlobalRules({ node: true }),
  },
  {
    // The model and MCP have no DOM either. The preset's advice to write `window.setTimeout` and
    // `window` instead of `globalThis` would lead straight into that ban, so it is off here.
    files: ["src/{model,mcp}/**/*.{ts,tsx}"],
    rules: {
      ...restrictedGlobalRules({ node: true, dom: true }),
      "obsidianmd/prefer-window-timers": "off",
      "obsidianmd/no-global-this": "off",
    },
  },
  {
    // no-undef is redundant with the TS type-checker, and the adapter and shell may use Obsidian's
    // ambient globals. Disable it for the TS sources the preset enables it on.
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
      // "WIP" rides along for the same reason: it is how every kanban tool spells the column
      // limit, and neither `ignoreWords` (skipped for a label's first word) nor `acronyms` (which
      // would replace the rule's whole default list) keeps "WIP limit" as written.
      "obsidianmd/ui/sentence-case": ["error", { brands: ["Folia", "Kanban", "WIP"] }],
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
  {
    // One version gate. The preset's `obsidianmd/no-unsupported-api` already fails a use of an API
    // newer than manifest.json's `minAppVersion` unless a literal `requireApiVersion(...)` guards
    // it. It sees dotted member access, calls, `new` and `extends`, not a destructured property
    // (`const { errorEl } = setting`) or a bracketed key (`b["setDestructive"]()`), so write newer
    // APIs in the dotted form. Allowing that guard only in src/obsidian/compat.ts leaves compat.ts as the one
    // place such a call can live, each with its fallback beside it.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/obsidian/compat.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Any mention, identifier or string key, so a namespace import
          // (`Obsidian.requireApiVersion`, `Obsidian["requireApiVersion"]`) or a destructured alias
          // cannot bring the gate back elsewhere.
          selector: "Identifier[name='requireApiVersion'], Literal[value='requireApiVersion']",
          message:
            "Gate newer Obsidian APIs in src/obsidian/compat.ts, with a fallback for older apps; requireApiVersion belongs there only.",
        },
      ],
    },
  },
];
