// eslint.config.mjs turns a few jsx-a11y rules off for a few UI files, because the deliberate
// exceptions they cover cannot be expressed as inline directives: Obsidian's community-directory
// scanner lints those same files with a config that has never loaded jsx-a11y, and a directive
// naming a rule it does not know is a hard error there (see scripts/obsidian-scan.mjs).
//
// ESLint can only switch a rule off per file, so that would leave those files unguarded. This
// check closes the gap: it re-runs exactly the rules that were switched off, on exactly the files
// they were switched off for, and requires every remaining violation to sit under an
// `a11y exception (<rule>): <why>` comment. A new interaction on a non-interactive or static
// element fails here the way it used to fail in `pnpm lint`, and a comment left behind after its
// element is gone fails too.
//
// The rule and file lists are DERIVED from eslint.config.mjs rather than repeated here, so adding
// a file or a fourth rule to those blocks cannot quietly escape this fence.

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";
import { ESLint } from "eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import baseConfig, { a11yExceptions } from "../eslint.config.mjs";

const root = process.cwd();

// How far above a violation the justifying comment may sit (the element's opening line, plus a
// little room for a JSX `{/* … */}` wrapper).
const COMMENT_LOOKBACK = 3;

// Rules that are not call-site exceptions and so are not expected in `a11yExceptions`:
// jsx-a11y's own recommended preset already ships them off (deprecated rules), plus one
// plugin-wide decision. Keep the explicit half short and justified.
const GLOBAL_POLICY = new Set([
  // Autofocus is deliberate focus management for modals and inline edit — good a11y here.
  "jsx-a11y/no-autofocus",
  ...Object.entries(jsxA11y.flatConfigs.recommended.rules ?? {})
    .filter(([, setting]) => setting === "off" || setting === 0)
    .map(([rule]) => rule),
]);

// Every (file, rule) pair eslint.config.mjs deliberately switches off for a call-site exception.
const exempt = a11yExceptions.flatMap((block) =>
  Object.keys(block.rules).flatMap((rule) => block.files.map((file) => ({ file, rule }))),
);

// A jsx-a11y rule switched off ANYWHERE else in the config would never be re-run below, so the
// fence would not cover it. Refuse to run rather than pass on an exception it cannot see. Blocks
// that came from `a11yExceptions` are recognised by identity, not by shape.
const declared = new Set(a11yExceptions);
const undeclared = baseConfig.flatMap((block) =>
  declared.has(block)
    ? []
    : Object.entries(block.rules ?? {})
        .filter(
          ([rule, setting]) =>
            rule.startsWith("jsx-a11y/") &&
            (setting === "off" || setting === 0) &&
            !GLOBAL_POLICY.has(rule),
        )
        .map(([rule]) => `${rule} for ${JSON.stringify(block.files ?? "(all files)")}`),
);

if (undeclared.length > 0) {
  console.error("check-a11y-exceptions: FAILED");
  for (const u of undeclared) {
    console.error(`  eslint.config.mjs switches off ${u} outside the a11yExceptions array`);
  }
  console.error(
    "\nMove it into `a11yExceptions` so this fence re-runs it, or — if it is plugin-wide policy" +
      " rather than a call-site exception — add it to GLOBAL_POLICY here with the reason.",
  );
  process.exit(1);
}

if (exempt.length === 0) {
  console.log("check-a11y-exceptions: OK (eslint.config.mjs declares no jsx-a11y exception)");
  process.exit(0);
}

const files = [...new Set(exempt.map((e) => e.file))].sort();
const rules = [...new Set(exempt.map((e) => e.rule))].sort();

const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    ...baseConfig,
    ...exempt.map(({ file, rule }) => ({ files: [file], rules: { [rule]: "error" } })),
  ],
});

const results = await eslint.lintFiles(files);
const sources = new Map();
for (const result of results) {
  sources.set(result.filePath, (await readFile(result.filePath, "utf8")).split("\n"));
}

/** 1-based line of the `a11y exception (...)` comment covering `line` and naming `rule`, or 0. */
const justification = (lines, line, rule) => {
  const short = rule.replace("jsx-a11y/", "");
  for (let n = line - 1; n >= 1 && n >= line - COMMENT_LOOKBACK; n -= 1) {
    const text = lines[n - 1] ?? "";
    if (text.trim() === "") continue;
    if (text.includes("a11y exception (")) return text.includes(short) ? n : 0;
  }
  return 0;
};

const problems = [];
const justified = [];

for (const result of results) {
  const lines = sources.get(result.filePath) ?? [];
  const file = relative(root, result.filePath);
  // comment line -> the single source line it justifies. One comment covers one element, however
  // many rules that element trips; a second element must carry its own comment.
  const used = new Map();
  for (const m of result.messages) {
    if (!m.ruleId || !rules.includes(m.ruleId)) continue;
    const at = justification(lines, m.line, m.ruleId);
    const claimed = used.get(at);
    if (at === 0) {
      problems.push(
        `${file}:${m.line}:${m.column} ${m.ruleId} — no "a11y exception (${m.ruleId.replace("jsx-a11y/", "")}): …" comment above it`,
      );
    } else if (claimed !== undefined && claimed !== m.line) {
      problems.push(
        `${file}:${m.line}:${m.column} ${m.ruleId} — the "a11y exception" comment on line ${at} already justifies line ${claimed}; give this element its own comment`,
      );
    } else {
      justified.push(`${file}:${m.line} ${m.ruleId}`);
      used.set(at, m.line);
    }
  }
  // A justification whose element no longer violates anything is stale documentation.
  lines.forEach((text, i) => {
    if (text.includes("a11y exception (") && !used.has(i + 1)) {
      problems.push(
        `${file}:${i + 1} — "a11y exception" comment justifies nothing; the rule no longer fires below it`,
      );
    }
  });
}

// A file named in an off-block that ESLint never actually lints would pass vacuously — and
// `lintFiles` still returns a result for an ignored file, so the result list alone proves nothing.
const linted = new Set(results.map((r) => relative(root, r.filePath)));
for (const file of files) {
  if (await eslint.isPathIgnored(file)) {
    problems.push(
      `${file} — declared in a11yExceptions but ignored by eslint.config.mjs, so nothing lints it`,
    );
  } else if (!linted.has(relative(root, resolve(root, file)))) {
    problems.push(`${file} — declared in a11yExceptions but ESLint never linted it`);
  }
}

if (problems.length > 0) {
  console.error("check-a11y-exceptions: FAILED");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nFix the a11y issue, or — if it is another deliberate exception — put an" +
      " `a11y exception (<rule>): <why>` comment directly above the element.",
  );
  process.exit(1);
}

console.log(
  `check-a11y-exceptions: OK (${justified.length} documented exception(s) across ${files.length} file(s), no undocumented ones)`,
);
