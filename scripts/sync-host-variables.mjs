#!/usr/bin/env node
// Produces the documented host-variable registry so theme guards can check Obsidian aliases.
// Conflicting fields keep the first non-empty value in sorted page order and record its page.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const positional = args.filter((arg) => arg !== "--check");
if (positional.length > 1 || positional.some((arg) => arg.startsWith("--"))) {
  console.error("Usage: sync-host-variables.mjs [docs-root] [--check]");
  process.exit(1);
}
const docsRoot = resolve(positional[0] ?? join(root, "tmp/docs/obsidian-developer-docs"));
const layouts = ["en/Reference/CSS variables", "Reference/CSS variables"];
const sourcePath = layouts.find((path) => existsSync(join(docsRoot, path)));
const candidates = layouts.map((path) => join(docsRoot, path));
const docsPath = sourcePath && join(docsRoot, sourcePath);
if (!docsPath) {
  console.error(
    `sync-host-variables: No CSS-variable docs found. Tried ${candidates.join(" and ")}. Get a checkout with: git clone --depth 1 https://github.com/obsidianmd/obsidian-developer-docs`,
  );
  process.exit(1);
}

let commit = null;
try {
  const gitRoot = execFileSync("git", ["-C", docsRoot, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  // A plain docs folder inside Folia must not inherit Folia's commit as its provenance.
  if (realpathSync(gitRoot) === realpathSync(docsRoot)) {
    commit = execFileSync("git", ["-C", docsRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  }
} catch {
  // Plain folders are supported without Git metadata.
}

function markdownPages(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const page = prefix + entry.name;
    if (entry.isDirectory()) return markdownPages(join(directory, entry.name), `${page}/`);
    return entry.isFile() && /\.md$/i.test(entry.name) ? [page] : [];
  });
}

function cells(line) {
  if (!line.includes("|")) return null;
  const parts = [""];
  let backslashes = 0;
  for (const character of line.trim()) {
    if (character === "|" && backslashes % 2 === 0) parts.push("");
    else parts[parts.length - 1] += character;
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  if (parts[0] === "") parts.shift();
  if (parts.at(-1) === "") parts.pop();
  return parts.map((part) => part.trim().replace(/\\\|/g, "|"));
}

const pages = markdownPages(docsPath).sort();
const variables = new Map();
const origins = new Map();
let warnings = 0;
function warn(message) {
  warnings++;
  console.error(`sync-host-variables: ${message}`);
}

for (const page of pages) {
  const lines = readFileSync(join(docsPath, page), "utf8").split(/\r?\n/);
  let columns = null;
  let defaultColumns = [];
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = null;
      }
      continue;
    }
    if (marker) {
      fence = marker[1];
      columns = null;
      continue;
    }
    const row = cells(line);
    if (!row || /^ {4}|^\t/.test(line)) {
      columns = null;
      continue;
    }
    const separator = cells(lines[index + 1] ?? "");
    if (separator?.length === row.length && separator.every((cell) => /^:?-+:?$/.test(cell))) {
      columns = row.map((cell) => cell.replace(/`/g, "").trim().toLowerCase());
      defaultColumns = columns.flatMap((column, index) =>
        /^default(?:\b|_)/.test(column)
          ? [{ index, mode: /\b(light|dark)\b/.exec(column)?.[1] }]
          : [],
      );
      if (
        defaultColumns.length > 0 &&
        !(defaultColumns.length === 1 && !defaultColumns[0].mode) &&
        !(
          defaultColumns.length === 2 &&
          new Set(defaultColumns.map(({ mode }) => mode)).size === 2 &&
          defaultColumns.every(({ mode }) => mode)
        )
      ) {
        warn(`${page}:${index + 1}: unsupported default columns`);
        defaultColumns = [];
      }
      index++;
      continue;
    }
    if (!columns) continue;
    const name = /^`(--[^\s`]+)`$/.exec(row[0])?.[1];
    if (!name) continue;
    if (row.length !== columns.length) {
      warn(`${page}:${index + 1}: ${name} has ${row.length} cells for ${columns.length} columns`);
    }
    const entry = variables.get(name) ?? { pages: [] };
    if (!entry.pages.includes(page)) entry.pages.push(page);
    const valueAt = (column) => row[column]?.replace(/`/g, "").trim();
    let defaultValue;
    if (defaultColumns.length === 1) {
      defaultValue = valueAt(defaultColumns[0].index);
    } else if (defaultColumns.length === 2) {
      const values = defaultColumns.map(({ index, mode }) => [mode, valueAt(index)]);
      if (values.every(([, value]) => value)) {
        defaultValue = Object.fromEntries(values.sort(([a], [b]) => a.localeCompare(b)));
      } else {
        warn(`${page}:${index + 1}: ${name} has an incomplete mode-specific default`);
      }
    }
    for (const [field, value] of [
      ["default", defaultValue],
      ["description", valueAt(columns.indexOf("description"))],
    ]) {
      if (value === undefined) continue;
      const originKey = `${name}:${field}`;
      const observations = origins.get(originKey) ?? [];
      observations.push({ page, value });
      origins.set(originKey, observations);
      if (value && !Object.hasOwn(entry, field)) entry[field] = value;
    }
    variables.set(name, entry);
  }
}

for (const [name, entry] of variables) {
  entry.scope = entry.pages.every((page) => page.startsWith("Publish/")) ? "publish" : "app";
  for (const field of ["default", "description"]) {
    if (!Object.hasOwn(entry, field)) continue;
    const observations = origins.get(`${name}:${field}`);
    const winner = observations.find(({ value }) => value);
    if (
      observations.some(
        ({ page, value }) =>
          page !== winner.page && JSON.stringify(value) !== JSON.stringify(winner.value),
      )
    ) {
      entry[`${field}From`] = winner.page;
    }
  }
}

function sortedKeys(value) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys(value[key])]),
  );
}

const output = sortedKeys({
  $source: {
    repository: "obsidianmd/obsidian-developer-docs",
    path: sourcePath,
    commit,
  },
  variables: Object.fromEntries(variables),
});
const destination = join(root, "src/theme/host/variables.json");
// Keep short page arrays inline to match the repository's JSON formatting without dependencies.
const json = JSON.stringify(output, null, 2).replace(
  /^( +)"pages": \[\n([\s\S]*?)\n\1\]/gm,
  (block, indent, contents) => {
    const compact = `${indent}"pages": [${contents
      .trim()
      .split(/,\n\s*/)
      .join(", ")}]`;
    return compact.length <= 100 ? compact : block;
  },
);
if (check) {
  if (!existsSync(destination) || readFileSync(destination, "utf8") !== json + "\n") {
    console.error("sync-host-variables: registry has drifted; run without --check to regenerate");
    process.exitCode = 1;
  }
} else {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, json + "\n");
}
if (warnings > 0) process.exitCode = 1;
console.error(
  `sync-host-variables: ${pages.length} pages read, ${variables.size} variables found, ${warnings} warnings${
    check ? "" : `, written to ${destination}`
  }`,
);
