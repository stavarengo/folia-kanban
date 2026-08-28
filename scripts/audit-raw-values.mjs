#!/usr/bin/env node
// Scans src/ for raw design values that should be design tokens — hex/rgb/hsl colors,
// box-shadows, font-family, z-index, and obvious spacing/radius magic numbers — and
// fails on any finding NOT already in the baseline allowlist (a RATCHET: existing debt
// is tolerated, new debt is blocked).
//
//   node scripts/audit-raw-values.mjs            check against the allowlist (CI/hook)
//   node scripts/audit-raw-values.mjs --update   regenerate the allowlist from the
//                                                 current tree (pay-down / re-baseline)
//
// The --folia-* token-definition lines inside styles.css are the legitimate home for
// raw values, so they are excluded from the scan. So is tokens/source/ (outside src/).
//
// Allowlist file: scripts/raw-value-allowlist.json. Each entry is {file, snippet, count}:
// `count` is how many times that exact snippet is tolerated in that file. The same magic
// number can legitimately recur, but every recurrence is still debt — the check fails as
// soon as the number of occurrences found for a (file, snippet) pair exceeds the allowed
// count, so a second, unlisted copy of an already-allowlisted value is new debt, not a
// free pass. The matcher for --update and check is the SAME detect() so a fresh baseline
// always yields a clean check (exit 0) by construction.
//
// The functions below are exported for test/audit-raw-values.test.ts, which imports this
// module and calls them directly against throwaway fixture paths — this file never reads
// or writes anything on import; only the CLI block at the bottom (guarded to run only when
// this file is the process entry point) touches this repo's own src/ and allowlist.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const allowlistPath = join(root, "scripts", "raw-value-allowlist.json");

// ------------------------------------------------------------------ file walk
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|css)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// ------------------------------------------------------------------ detectors
// Each detector is a RegExp with the global flag. A line is exempt from scanning
// when it is a --folia-* token declaration (the legit raw-value home in styles.css).
const DETECTORS = [
  // hex colors (#rgb, #rrggbb, #rrggbbaa)
  /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g,
  // rgb()/rgba()/hsl()/hsla() literals
  /\b(?:rgba?|hsla?)\([^)]*\)/g,
  // box-shadow declarations (CSS)
  /\bbox-shadow\s*:[^;]+;/g,
  // font-family declarations (CSS)
  /\bfont-family\s*:[^;]+;/g,
  // z-index numeric literals (CSS)
  /\bz-index\s*:\s*-?\d+/g,
  // spacing/radius magic numbers: px lengths of 2+ digits (1px hairlines and 0 are fine)
  /\b\d{2,}px\b/g,
  // font-weight numeric literals (the --folia-font-weight-* token decls are exempt via TOKEN_DECL)
  /\bfont-weight\s*:\s*\d+/g,
  // bare opacity literals — but NOT the endpoints 0/1 (keyframe/transition extremes) nor var(...).
  // The (?:0|1)(?![\d.]) lookahead rejects whole-value 0 and 1 while letting 0.5 / 0.18 through.
  /\bopacity\s*:\s*"?(?!(?:0|1)(?![\d.]))[\d.]+/g,
  // half-pixel lengths (e.g. 1.5px hairline borders) — sub-pixel design values, not hairlines
  /\b\d+\.\d+px\b/g,
];

const TOKEN_DECL = /^\s*--folia-[A-Za-z0-9-]+\s*:/;

/** The identity of a (file, snippet) pair for the count maps below. JSON-encoded rather than
 * joined with a plain separator: a box-shadow/font-family snippet legitimately contains spaces,
 * so `${file} ${snippet}` could let two different (file, snippet) pairs collide on the same
 * string (e.g. file "a", snippet "b c" vs. file "a b", snippet "c"). */
export function key(file, snippet) {
  return JSON.stringify([file, snippet]);
}

/** Detect raw-value findings under `scanSrcDir` (default: this repo's src/), reporting each
 * file relative to `scanRoot` (default: this repo's root). Returns sorted {file, snippet,
 * count}[], one entry per distinct (file, snippet) pair — `count` is how many times it occurs. */
export function detect(scanSrcDir = srcDir, scanRoot = root) {
  const files = walk(scanSrcDir, []).sort();
  const byKey = new Map();
  for (const file of files) {
    const rel = relative(scanRoot, file);
    const lines = readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      if (TOKEN_DECL.test(line)) continue; // legit raw-value home
      for (const detector of DETECTORS) {
        detector.lastIndex = 0;
        let m;
        while ((m = detector.exec(line)) !== null) {
          const snippet = m[0].trim();
          const k = key(rel, snippet);
          const existing = byKey.get(k);
          if (existing) existing.count++;
          else byKey.set(k, { file: rel, snippet, count: 1 });
        }
      }
    }
  }
  const unique = [...byKey.values()];
  unique.sort((a, b) => a.file.localeCompare(b.file) || a.snippet.localeCompare(b.snippet));
  return unique;
}

/** Total occurrences across all findings — the number the OK/FAIL messages report. */
export function totalOccurrences(findings) {
  return findings.reduce((sum, f) => sum + f.count, 0);
}

/**
 * Findings whose observed count exceeds what `allowlist` tolerates for that (file, snippet) —
 * the new debt a check must fail on. Throws if any allowlist entry's `count` is not a
 * non-negative integer: a malformed count (a string, `NaN`, a fraction) must not silently
 * fail open by comparing false against everything.
 */
export function findNovel(findings, allowlist) {
  const allowedCounts = new Map();
  for (const f of allowlist) {
    if (!Number.isInteger(f.count) || f.count < 0) {
      throw new Error(
        `invalid allowlist count for ${f.file} ${JSON.stringify(f.snippet)}: ` +
          `${JSON.stringify(f.count)} (must be a non-negative integer)`,
      );
    }
    allowedCounts.set(key(f.file, f.snippet), f.count);
  }
  return findings.filter((f) => f.count > (allowedCounts.get(key(f.file, f.snippet)) ?? 0));
}

// ------------------------------------------------------------------ allowlist io
const ALLOWLIST_HEADER =
  "Baseline of tolerated raw design values (ratchet). New raw values fail the check; " +
  "existing ones are grandfathered here, one count per (file, snippet) pair for how many " +
  "occurrences are tolerated — a new, unlisted copy of an already-allowed value is new debt " +
  "too. Pay this debt down via tracking/waivers/ — open a waiver, remove/decrement entries as " +
  "you tokenize. Regenerate with: node scripts/audit-raw-values.mjs --update";

export function writeAllowlist(findings, path = allowlistPath) {
  // Carry forward a hand-written `note` field from the file being replaced, if there is one —
  // it documents WHY each residual is accepted, which --update has no way to know or regenerate,
  // so re-baselining must not silently erase it.
  let note;
  try {
    const existing = JSON.parse(readFileSync(path, "utf8"));
    if (typeof existing.note === "string") note = existing.note;
  } catch {
    // no existing file, or not valid JSON — nothing to carry forward
  }
  const payload = note
    ? { _comment: ALLOWLIST_HEADER, note, findings }
    : { _comment: ALLOWLIST_HEADER, findings };
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n");
}

export function readAllowlist(path = allowlistPath) {
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(json.findings) ? json.findings : [];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------ main
// Only runs when this file is the process entry point (`node scripts/audit-raw-values.mjs`), so
// importing it — as the test file does, to call the functions above directly — never touches
// this repo's own src/ or allowlist as a side effect of import.
const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const update = process.argv.includes("--update") || process.env.AUDIT_UPDATE === "1";
  const findings = detect();

  if (update) {
    writeAllowlist(findings);
    console.log(
      `audit-raw-values: wrote baseline with ${findings.length} entries ` +
        `(${totalOccurrences(findings)} occurrences) to scripts/raw-value-allowlist.json`,
    );
    process.exit(0);
  }

  const allowlist = readAllowlist();
  if (allowlist === null) {
    console.error("audit-raw-values: FAIL — scripts/raw-value-allowlist.json missing or invalid.");
    console.error("  Generate it with: node scripts/audit-raw-values.mjs --update");
    process.exit(1);
  }

  let novel;
  try {
    novel = findNovel(findings, allowlist);
  } catch (e) {
    console.error(`audit-raw-values: FAIL — ${e.message}`);
    process.exit(1);
  }

  if (novel.length) {
    console.error(
      `audit-raw-values: FAIL — ${novel.length} value(s) exceed what the allowlist tolerates:`,
    );
    for (const f of novel) {
      const allowed =
        allowlist.find((a) => a.file === f.file && a.snippet === f.snippet)?.count ?? 0;
      console.error(`  - ${f.file}: ${f.snippet} (found ${f.count}, allowlisted ${allowed})`);
    }
    console.error("");
    console.error(
      "  Tokenize them, or (if deliberate/temporary) record a waiver under tracking/waivers/",
    );
    console.error("  and re-baseline with: node scripts/audit-raw-values.mjs --update");
    process.exit(1);
  }

  console.log(
    `audit-raw-values: OK (${totalOccurrences(findings)} occurrences, all within what the allowlist tolerates)`,
  );
}
