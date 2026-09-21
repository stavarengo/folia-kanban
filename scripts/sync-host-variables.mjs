#!/usr/bin/env node
// Produces the documented host-variable registry so theme guards can check Obsidian aliases.

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
const docsRoot = resolve(process.argv[2] ?? join(root, "tmp/docs/obsidian-developer-docs"));
const candidates = ["en/Reference/CSS variables", "Reference/CSS variables"].map((path) =>
  join(docsRoot, path),
);
const docsPath = candidates.find((path) => existsSync(path));
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
      const defaults = columns.filter((column) => /^default(?:\b|_)/.test(column));
      if (defaults.length > 1) {
        warn(
          `${page}:${index + 1}: multiple default columns (${defaults.join(", ")}); keeping ${defaults[0]}`,
        );
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
    for (const [field, column] of [
      ["default", columns.findIndex((value) => /^default(?:\b|_)/.test(value))],
      ["description", columns.findIndex((value) => value === "description")],
    ]) {
      if (column < 0) continue;
      const value = (row[column] ?? "").replace(/`/g, "");
      const originKey = `${name}:${field}`;
      if (Object.hasOwn(entry, field)) {
        if (entry[field] !== value) {
          warn(
            `${name} ${field} differs between ${origins.get(originKey)} and ${page}; keeping the first`,
          );
        }
      } else {
        entry[field] = value;
        origins.set(originKey, page);
      }
    }
    variables.set(name, entry);
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
    path: "en/Reference/CSS variables",
    commit,
    syncedOn: new Date().toISOString().slice(0, 10),
  },
  variables: Object.fromEntries(variables),
});
const destination = join(root, "src/theme/host/variables.json");
mkdirSync(dirname(destination), { recursive: true });
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
writeFileSync(destination, json + "\n");
console.error(
  `sync-host-variables: ${pages.length} pages read, ${variables.size} variables found, ${warnings} warnings`,
);
