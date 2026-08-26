// Local reproduction of the Stylelint + ESLint passes that Obsidian's community-directory
// scanner runs against a submitted plugin (obsidianmd/obsidian-workflows, src/lint.ts).
// The rule sets, ignore lists and the minAppVersion -> Electron mapping below are copied
// verbatim from that file so a finding here means a finding on the portal.
//
// Two deliberate differences from the bot:
//  - it only fails on stylelint exit code 2 (errors), so warning-severity findings are reported
//    on the portal but do not fail its own gate. We fail on ANY finding, warning or error,
//    because the goal is a zero-warning listing.
//  - it lints a fresh clone, so it only ever sees files git tracks. A working copy also holds
//    build output, scratch directories and anything else gitignored, and stylelint's `ignoreFiles`
//    turns out to be inert in 17.6.0 for the way lint.ts invokes it (verified against both the CLI
//    and the Node API), so nothing upstream would keep those out. Both passes below are therefore
//    restricted to `git ls-files`, which is exactly what the bot would clone. IGNORES is still
//    passed through unchanged, and ESLint's own ignore handling still applies on top.
//
// Known limit of the reproduction: the bot npm-installs its own tool versions at run time
// (stylelint 17.6.0, stylelint-no-unsupported-browser-features 8.1.1, eslint 9.37.0,
// eslint-plugin-obsidianmd 0.4.1, typescript-eslint 8.61.1). Everything here is pinned to the
// same version EXCEPT eslint itself, which stays on the repo's own major (10.x) because two
// eslint majors cannot coexist in one install. The obsidianmd plugin's peer range covers both,
// but a rule whose behaviour differs between the two majors could still diverge. The browser
// feature data (caniuse-lite) is likewise pinned here and fresh on the bot, so a data update can
// surface a CSS warning there that this check has not seen yet.
//
// `stylelint-no-unsupported-browser-features` is only named as a string in the stylelint config,
// the way lint.ts does it, so knip cannot see the dependency — it is listed in knip.json's
// ignoreDependencies for that reason.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative as relativePath, resolve } from "node:path";
import process from "node:process";
import { ESLint } from "eslint";
import { globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import stylelint from "stylelint";
import tseslint from "typescript-eslint";

const root = process.cwd();
const verbose = process.argv.includes("--verbose");

// --- lint.ts: SCANNER_STYLELINT_CONFIG.ignoreFiles ------------------------------------
const IGNORES = [
  "node_modules",
  "dist",
  "build",
  "pkg",
  "test-vault",
  ".obsidian",
  "**/.obsidian/**",
  "esbuild.config.mjs",
  "version-bump.mjs",
  "**/*.test.*",
  "**/*.tests.*",
  "**/*.spec.*",
  "**/*.specs.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/mocks/**",
  "**/__mocks__/**",
  "**/*.cjs",
  "**/*.mjs",
  "**/*.cts",
  "**/*.mts",
  "**/vite*",
  "**/scripts/**",
  "**/docs/**",
  "**/i18n/**",
  "**/i18next/**",
  "**/locale/**",
  "**/locales/**",
  "**/translations/**",
  "**/l10n/**",
  ".pnpm-store",
  "**/*.spec.ts",
  "**/testUtils**",
  "automation/**",
  "e2e-tests/**",
];

// --- lint.ts: ELECTRON_VERSIONS / getMinElectronVersion() ------------------------------
const ELECTRON_VERSIONS = {
  25: "1.4.5",
  28: "1.5.8",
  30: "1.6.5",
  31: "1.7.4",
  37: "1.9.12",
  39: "1.11.4",
};
const DEFAULT_ELECTRON = 39;

const semverToNum = (v) => {
  const [major = 0, minor = 0, patch = 0] = v.split(".").map(Number);
  return major * 100_000 + minor * 1_000 + patch;
};

const getMinElectronVersion = (minAppVersion) => {
  if (!minAppVersion) return DEFAULT_ELECTRON;
  const target = semverToNum(minAppVersion);
  let result = Math.min(...Object.keys(ELECTRON_VERSIONS).map(Number));
  for (const [electronStr, obsidianVersion] of Object.entries(ELECTRON_VERSIONS)) {
    if (semverToNum(obsidianVersion) <= target) result = Math.max(result, Number(electronStr));
  }
  return result;
};

// --- lint.ts: SCANNER_STYLELINT_CONFIG.rules ------------------------------------------
const stylelintConfig = (minElectron) => ({
  plugins: ["stylelint-no-unsupported-browser-features"],
  ignoreDisables: true,
  ignoreFiles: IGNORES,
  rules: {
    "function-url-scheme-disallowed-list": [
      ["http", "https", "file"],
      {
        severity: "error",
        message:
          "External URLs are not allowed in themes. To embed images & fonts encode them as base64 <https://docs.obsidian.md/Themes/App+themes/Embed+fonts+and+images+in+your+theme>",
      },
    ],
    "function-url-scheme-allowed-list": ["data"],
    "declaration-no-important": [
      true,
      {
        severity: "warning",
        message:
          "Avoid !important — override styles by increasing selector specificity or using CSS variables instead.",
      },
    ],
    "color-named": [
      "never",
      {
        severity: "warning",
        message:
          "Use hex colors or Obsidian CSS variables instead of named colors to ensure proper light/dark theme support. <https://docs.obsidian.md/Reference/CSS+variables/CSS+variables>",
      },
    ],
    "custom-property-no-missing-var-function": null,
    "no-duplicate-selectors": null,
    "no-duplicate-at-import-rules": null,
    "declaration-block-no-duplicate-properties": [true, { severity: "warning" }],
    "shorthand-property-no-redundant-values": null,
    "plugin/no-unsupported-browser-features": [
      true,
      {
        severity: "warning",
        browsers: [`electron >= ${minElectron}`],
        ignore: ["css-nesting", "css-cascade-layers"],
      },
    ],
    "selector-pseudo-class-disallowed-list": [
      ["has"],
      {
        severity: "warning",
        message:
          "Avoid :has() — it can cause significant performance issues due to broad selector invalidation.",
      },
    ],
    "selector-pseudo-class-no-unknown": [
      true,
      { ignorePseudoClasses: ["global", "local"], severity: "warning" },
    ],
    "selector-pseudo-element-no-unknown": [true, { severity: "warning" }],
    "selector-type-no-unknown": [true, { ignoreTypes: [], severity: "warning" }],
    "at-rule-no-unknown": [
      true,
      { ignoreAtRules: ["layer", "property", "container"], severity: "warning" },
    ],
    "unit-no-unknown": [true, { severity: "warning" }],
    "property-disallowed-list": [["all"], { severity: "warning" }],
  },
});

// --- lint.ts: buildScannerEslintConfig(), tsconfig branch ------------------------------
const toWarns = (config) => {
  if (!config) return config;
  if (!Array.isArray(config) && typeof config[Symbol.iterator] === "function") {
    return [...config].map(toWarns);
  }
  if (Array.isArray(config)) return config.map(toWarns);
  const result = { ...config };
  if (result.extends) result.extends = toWarns(result.extends);
  if (result.rules) {
    result.rules = Object.fromEntries(
      Object.entries(result.rules).map(([key, value]) => {
        if (key.startsWith("eslint-comments/")) return [key, value];
        if (value === "error" || value === 2) return [key, "warn"];
        if (Array.isArray(value) && (value[0] === "error" || value[0] === 2)) {
          return [key, ["warn", ...value.slice(1)]];
        }
        return [key, value];
      }),
    );
  }
  return result;
};

const eslintConfig = () => [
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "eslint.config.mjs", "eslint.config.mts"],
        },
        tsconfigRootDir: root,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...toWarns(obsidianmd.configs.recommended),
  {
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: "off",
      reportUnusedInlineConfigs: "off",
    },
  },
  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-forbidden-elements": "error",

      "no-undef": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "import/no-unresolved": "off",

      "obsidianmd/validate-manifest": "off",
      "obsidianmd/validate-license": "off",

      "obsidianmd/commands/no-command-in-command-id": "off",
      "obsidianmd/commands/no-plugin-id-in-command-id": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: { "eslint-comments/require-description": "error" },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    plugins: { "@typescript-eslint": tseslint.plugin, obsidianmd },
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      "obsidianmd/commands/no-command-in-command-id": "warn",
      "obsidianmd/commands/no-plugin-id-in-command-id": "warn",

      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-unsupported-api": "error",
    },
  },
  globalIgnores(IGNORES),
  { ignores: ["eslint.config.scanner.mjs", "main.js", "styles.css", "manifest.json"] },
];

// What a fresh clone of this repo would contain — see the header note.
const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);

// The extensions the scanner's ESLint config has a matching block for. Handing it a `.md` or a
// `.css` path would only produce "no matching configuration" noise.
const LINTABLE = /\.(m?ts|c?ts|tsx|m?js|c?js|jsx|json)$/;

const runStylelint = async (minElectron) => {
  const files = trackedFiles().filter((f) => f.endsWith(".css"));
  if (files.length === 0) return { linted: [], findings: [] };
  const { results } = await stylelint.lint({
    cwd: root,
    files,
    config: stylelintConfig(minElectron),
  });

  const linted = results.map((r) => r.source).filter(Boolean);
  const findings = results.flatMap((r) =>
    r.warnings.map((w) => ({
      file: r.source,
      line: w.line,
      column: w.column,
      severity: w.severity,
      rule: w.rule,
      text: w.text,
    })),
  );
  return { linted, findings };
};

const runEslint = async () => {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: eslintConfig(),
    errorOnUnmatchedPattern: false,
  });
  const candidates = trackedFiles().filter((f) => LINTABLE.test(f));
  const files = [];
  for (const f of candidates) if (!(await eslint.isPathIgnored(f))) files.push(f);
  if (files.length === 0) return { linted: [], findings: [] };
  const results = await eslint.lintFiles(files);

  const linted = results.map((r) => r.filePath);
  const findings = results.flatMap((r) =>
    r.messages.map((m) => ({
      file: r.filePath,
      line: m.line,
      column: m.column,
      severity: m.fatal ? "fatal" : m.severity === 2 ? "error" : "warning",
      rule: m.ruleId ?? "(parse)",
      text: m.message,
    })),
  );
  return { linted, findings };
};

// --- README placeholder check --------------------------------------------------------------
// The portal's review also reports "README contains unfilled placeholder text — All placeholder
// text (such as \"[description]\", \"TODO\", or template comments) must be replaced with real
// content describing the plugin." That rule is NOT part of obsidian-workflows (checkReadme in
// src/repo-checks.ts only checks that a README exists and is not tiny), so unlike the two passes
// above this one is an approximation, not a reproduction: the patterns below are our reading of the
// message, and the portal may match more, less, or differently.
//
// Deliberately case-SENSITIVE for the bare markers: this plugin's own vocabulary has a lowercase
// "todo" (a column named `todo`, the todo.txt priority convention, the "next todos" setting), and
// those are real content. A placeholder left behind in a README is written TODO / FIXME / TBD.
const README_PATTERNS = [
  { rule: "placeholder/marker", re: /\b(TODO|FIXME|XXX|TBD)\b/g, what: "leftover marker" },
  {
    rule: "placeholder/bracket",
    // Literal template tokens only. A bracket pattern any wider matches this README's own Markdown
    // links, wikilinks, task boxes and inline fields, none of which are placeholders.
    re: /\[(description|placeholder|plugin name|your plugin name|your name|insert [^\]]*)\]/gi,
    what: "bracketed placeholder",
  },
  { rule: "placeholder/template", re: /\{\{[^}]*\}\}/g, what: "template expression" },
  // The portal's message names "template comments", and a README that carries none cannot regress
  // into one. A deliberate tooling comment (a markdownlint directive, say) trips this: that is a
  // conversation to have, not a false alarm to suppress in advance.
  { rule: "placeholder/comment", re: /<!--[\s\S]*?-->/g, what: "HTML comment" },
  {
    rule: "placeholder/filler",
    re: /\b(lorem ipsum|sample plugin|your plugin name)\b/gi,
    what: "template filler",
  },
];

const checkReadme = async () => {
  const file = resolve(root, "README.md");
  const text = await readFile(file, "utf8");
  const findings = [];
  for (const { rule, re, what } of README_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      findings.push({
        file,
        line,
        column: m.index - before.lastIndexOf("\n"),
        severity: "warning",
        rule,
        text: `README ${what}: ${JSON.stringify(m[0].slice(0, 60))} — replace it with real content describing the plugin.`,
      });
    }
  }
  return { linted: [file], findings };
};

// Findings we have decided not to act on yet. An entry matches on tool + rule + file + the exact
// message text, and on how many times it may occur; a second occurrence, or a changed message, is
// an unexpected finding like any other. An entry that stops matching is reported too, so a stale
// baseline cannot quietly outlive the thing it excused. Empty: the scan is clean, and every finding
// is unexpected.
const BASELINE = [];

// Also normalises separators, so the BASELINE keys match on Windows too.
const relative = (file) => relativePath(root, resolve(root, String(file))).replaceAll("\\", "/");

// Walks the findings once, handing each the first baseline entry that still has room for it.
// Returns the findings nothing excused, plus the entries that matched fewer times than declared.
const applyBaseline = (all) => {
  const left = BASELINE.map((b) => b.count);
  const excused = new Set();
  const unexpected = [];

  for (const [tool, f] of all) {
    const i = BASELINE.findIndex(
      (b, n) =>
        left[n] > 0 &&
        b.tool === tool &&
        b.rule === f.rule &&
        b.file === relative(f.file) &&
        b.text === f.text,
    );
    if (i === -1) unexpected.push([tool, f]);
    else {
      left[i] -= 1;
      excused.add(f);
    }
  }

  const stale = BASELINE.map((b, n) => ({ ...b, missing: left[n] })).filter((b) => b.missing > 0);
  return { unexpected, excused, stale };
};

const report = (label, { linted, findings }, excused) => {
  console.log(`\n=== ${label} ===`);
  if (verbose) {
    console.log(`linted ${linted.length} file(s):`);
    for (const f of linted) console.log(`  ${relative(f)}`);
  } else {
    console.log(`linted ${linted.length} file(s)`);
  }
  if (findings.length === 0) {
    console.log("no findings");
    return;
  }
  for (const f of findings) {
    const where = `${relative(f.file)}:${f.line}:${f.column}`;
    const tag = excused.has(f) ? "baselined" : f.severity;
    console.log(`  ${tag}  ${where}  ${f.rule}  ${f.text}`);
  }
};

const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const minElectron = getMinElectronVersion(manifest.minAppVersion);
console.log(
  `Obsidian community scan (local reproduction of obsidian-workflows src/lint.ts)\n` +
    `manifest.minAppVersion ${manifest.minAppVersion} -> browserslist target "electron >= ${minElectron}"`,
);

const css = await runStylelint(minElectron);
const js = await runEslint();
const readme = await checkReadme();

const all = [
  ...css.findings.map((f) => ["stylelint", f]),
  ...js.findings.map((f) => ["eslint", f]),
  ...readme.findings.map((f) => ["readme", f]),
];
const { unexpected, excused, stale } = applyBaseline(all);

report("stylelint", css, excused);
report("eslint", js, excused);
report("readme placeholders (approximation, not a reproduction)", readme, excused);

console.log(
  `\n${all.length} finding(s): ${unexpected.length} unexpected, ${all.length - unexpected.length} baselined.`,
);
for (const b of stale) {
  console.error(
    `obsidian-scan: baseline entry for ${b.rule} in ${b.file} matched ${b.count - b.missing} of ${b.count} declared finding(s) — remove or narrow it.`,
  );
}
if (unexpected.length > 0) {
  console.error("obsidian-scan: the community scan would report the findings above.");
}
if (unexpected.length > 0 || stale.length > 0) process.exit(1);
