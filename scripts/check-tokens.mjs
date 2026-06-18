#!/usr/bin/env node
// Asserts the design-token JSON source of truth matches the code that consumes it.
//
//   Direction 1 — for every token marked $extensions.folia.live === true, its value
//   (resolvedValue when the $value is a {ref}) byte-matches the matching --folia-*
//   declaration inside the .folia-root token block in src/styles.css. The mapping is
//   set-equal both ways: no live token without a declaration, no --folia-* declaration
//   without a live token.
//
//   Direction 2 — the color.column.* hexes equal, in order, the COLUMN_COLORS array
//   exported from src/ui/columnColors.ts.
//
// Tokens with live:false (typography, z-index, opacity, radius.pill, shadow.ring,
// shadow.panel, color.scrim) are NOT checked against the CSS — they have no var yet.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokensDir = join(root, "tokens", "source");
const cssPath = join(root, "src", "styles.css");
const columnColorsPath = join(root, "src", "ui", "columnColors.ts");

const errors = [];

// ---------------------------------------------------------------- token model
/** Walk a tokens JSON tree, returning every leaf with a $value plus its dotted path. */
function collectTokens(node, path, out) {
  if (node === null || typeof node !== "object") return;
  if (Object.prototype.hasOwnProperty.call(node, "$value")) {
    out.push({ path, node });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    collectTokens(child, path ? `${path}.${key}` : key, out);
  }
}

/** Resolve a token's literal CSS string: resolvedValue for {ref} values, else $value. */
function literalValue(node) {
  const value = node.$value;
  if (typeof value === "string" && /^\{.+\}$/.test(value)) {
    const resolved = node.$extensions?.folia?.resolvedValue;
    if (resolved === undefined) {
      return { error: `value ${value} is a ref but has no $extensions.folia.resolvedValue` };
    }
    return { value: resolved };
  }
  return { value };
}

const allTokens = [];
for (const file of readdirSync(tokensDir).filter((f) => f.endsWith(".tokens.json"))) {
  const raw = readFileSync(join(tokensDir, file), "utf8");
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    errors.push(`[${file}] invalid JSON: ${e.message}`);
    continue;
  }
  const out = [];
  collectTokens(json, "", out);
  for (const t of out) allTokens.push({ file, ...t });
}

// ----------------------------------------------------- parse the styles.css block
// The first `.folia-root { … }` block holds the --folia-* declarations. Only the
// declaration lines (`^\s*--folia-…: …;`) inside that first block count, so later
// blocks and `var(--folia-…)` usages elsewhere never leak in.
const css = readFileSync(cssPath, "utf8");
const blockStart = css.indexOf(".folia-root");
if (blockStart === -1) errors.push("[styles.css] no .folia-root block found");
const braceOpen = css.indexOf("{", blockStart);
const braceClose = css.indexOf("}", braceOpen);
const block = css.slice(braceOpen + 1, braceClose);

/** Map of --folia-* var name → declared value (trailing /* *​/ comment stripped). */
const cssVars = new Map();
for (const line of block.split("\n")) {
  const m = /^\s*(--folia-[A-Za-z0-9-]+)\s*:\s*(.+?)\s*;/.exec(line);
  if (!m) continue;
  let value = m[2];
  const comment = value.indexOf("/*");
  if (comment !== -1) value = value.slice(0, comment);
  cssVars.set(m[1], value.trim());
}

// ----------------------------------------------------- direction 1: live ↔ css
const liveVarNames = new Set();
for (const { file, path, node } of allTokens) {
  const folia = node.$extensions?.folia;
  if (!folia || folia.live !== true) continue;
  const cssVar = folia.cssVar;
  if (!cssVar) {
    errors.push(`[${file}] token ${path} is live:true but has no $extensions.folia.cssVar`);
    continue;
  }
  liveVarNames.add(cssVar);
  const { value, error } = literalValue(node);
  if (error) {
    errors.push(`[${file}] token ${path}: ${error}`);
    continue;
  }
  if (!cssVars.has(cssVar)) {
    errors.push(
      `[${file}] token ${path} expects ${cssVar} in the .folia-root block, but it is missing`,
    );
    continue;
  }
  const declared = cssVars.get(cssVar);
  if (declared !== value) {
    errors.push(
      `[${file}] token ${path} (${cssVar}) mismatch:\n    JSON: ${JSON.stringify(value)}\n    CSS:  ${JSON.stringify(declared)}`,
    );
  }
}

// Reverse: every --folia-* declaration must be backed by a live token.
for (const cssVar of cssVars.keys()) {
  if (!liveVarNames.has(cssVar)) {
    errors.push(`[styles.css] declaration ${cssVar} has no live token in tokens/source/`);
  }
}

// --------------------------------------------- direction 2: column ↔ columnColors.ts
const columnTokens = allTokens
  .filter(({ path }) => /^color\.column\.\d+$/.test(path))
  .sort((a, b) => Number(a.path.split(".")[2]) - Number(b.path.split(".")[2]))
  .map(({ node }) => node.$value);

const colorsSrc = readFileSync(columnColorsPath, "utf8");
const arrayMatch = /COLUMN_COLORS\s*=\s*\[([\s\S]*?)\]/.exec(colorsSrc);
if (!arrayMatch) {
  errors.push("[columnColors.ts] could not find the COLUMN_COLORS array");
} else {
  const codeColors = [...arrayMatch[1].matchAll(/["'`](#[0-9a-fA-F]{3,8})["'`]/g)].map((m) => m[1]);
  if (columnTokens.length !== codeColors.length) {
    errors.push(
      `[color.column] count mismatch: ${columnTokens.length} tokens vs ${codeColors.length} COLUMN_COLORS entries`,
    );
  } else {
    columnTokens.forEach((hex, i) => {
      if (hex !== codeColors[i]) {
        errors.push(
          `[color.column.${i + 1}] mismatch: JSON ${hex} vs COLUMN_COLORS ${codeColors[i]}`,
        );
      }
    });
  }
}

// ------------------------------------------------------------------------ report
if (errors.length) {
  console.error("check-tokens: FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(
  `check-tokens: OK (${liveVarNames.size} live tokens ↔ ${cssVars.size} declarations, ${columnTokens.length} column colors)`,
);
