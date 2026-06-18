#!/usr/bin/env node
// Toolchain preflight (blueprint §3). Refuses to let work start on the wrong
// runtime or a half-installed tree. Run via `pnpm doctor`; it is the first step
// of `pnpm verify`.
//
// Checks: Node baseline, pnpm package manager, lockfile present, dependencies
// installed, no unresolved merge-conflict markers, project runtime prerequisites.
// This is an Obsidian plugin with no runtime env vars, so there is no .env check.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const failures = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};

// 1. Node baseline — must satisfy package.json engines.node (>=24).
{
  const major = Number(process.versions.node.split(".")[0]);
  const required = Number((pkg.engines?.node ?? ">=24").replace(/[^\d]/g, "")) || 24;
  if (major >= required) ok(`Node ${process.versions.node} (>= ${required})`);
  else
    fail(
      `Node ${process.versions.node} is older than required >= ${required}. Use the version in .node-version.`,
    );
}

// 2. Package manager — must be pnpm (the pinned packageManager).
{
  const ua = process.env.npm_config_user_agent ?? "";
  const pinned = pkg.packageManager ?? "";
  if (!pinned.startsWith("pnpm@"))
    fail(`package.json "packageManager" must pin pnpm, got "${pinned}".`);
  else if (ua && !ua.startsWith("pnpm/"))
    fail(`Use pnpm — this run used "${ua.split(" ")[0]}". Run via "pnpm doctor".`);
  else ok(`pnpm (${pinned || "pinned"})`);
}

// 3. Lockfile present.
existsSync(join(root, "pnpm-lock.yaml"))
  ? ok("pnpm-lock.yaml present")
  : fail("pnpm-lock.yaml missing — run pnpm install.");

// 4. Dependencies installed (node_modules + a couple of sentinels).
{
  const sentinels = ["node_modules", "node_modules/.bin/tsc", "node_modules/esbuild"];
  const missing = sentinels.filter((p) => !existsSync(join(root, p)));
  missing.length
    ? fail(`Dependencies not installed (missing ${missing.join(", ")}) — run pnpm install.`)
    : ok("Dependencies installed");
}

// 5. No unresolved merge-conflict markers in source/config.
{
  const SCAN_DIRS = ["src", "test", "scripts", "docs", ".github"];
  const SCAN_EXT = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".jsonc",
    ".yml",
    ".yaml",
    ".css",
    ".md",
  ]);
  const MARKERS = [/^<{7}( |$)/, /^={7}$/, /^>{7}( |$)/];
  const hits = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (SCAN_EXT.has(extname(e.name))) {
        const lines = readFileSync(join(root, rel), "utf8").split("\n");
        lines.forEach((line, i) => {
          if (MARKERS.some((m) => m.test(line))) hits.push(`${rel}:${i + 1}`);
        });
      }
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  for (const f of ["package.json", "tsconfig.json", "eslint.config.js", "vitest.config.ts"]) {
    if (existsSync(join(root, f))) {
      readFileSync(join(root, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (MARKERS.some((m) => m.test(line))) hits.push(`${f}:${i + 1}`);
        });
    }
  }
  hits.length
    ? fail(`Unresolved merge-conflict markers: ${hits.join(", ")}`)
    : ok("No merge-conflict markers");
}

// 6. Project runtime prerequisites — the files the build and plugin load depend on.
{
  const required = ["manifest.json", "src/main.ts", "src/styles.css", "esbuild.config.mjs"];
  const missing = required.filter(
    (p) => !existsSync(join(root, p)) || !statSync(join(root, p)).isFile(),
  );
  missing.length
    ? fail(`Missing project prerequisites: ${missing.join(", ")}`)
    : ok("Project prerequisites present (manifest, entry, styles, build config)");
}

if (failures.length) {
  console.error(
    `\ndoctor: FAIL (${failures.length} problem(s)). Fix the above before running other tasks.`,
  );
  process.exit(1);
}
console.log("\ndoctor: OK");
