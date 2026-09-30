// The theme is many files but one stylesheet, and the guards that read it have to read it the way
// the browser does: in the order src/theme/index.css imports it. Source order is load-bearing here
// (src/theme/base.css says why), so a guard that globbed the directory instead would silently
// judge a different stylesheet than the one Obsidian loads.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";

export const THEME_DIR = "src/theme";
export const THEME_ENTRY = join(THEME_DIR, "index.css");

/** The one import shape the theme uses: a relative path to a sibling .css file, double-quoted. */
const IMPORT = /^"(\.\/[A-Za-z0-9._-]+\.css)"$/;

/**
 * The files `index.css` imports, in order, as repo-relative paths.
 *
 * Anything the entry contains that is not one of those imports is an error rather than something
 * skipped. esbuild understands far more than this reader does — `@import url(…)`, single quotes,
 * media conditions, a rule written straight into the entry — and every one of those would ship in
 * the bundle while staying invisible to the guards, which is the one failure this file must not
 * have.
 */
export async function themeFiles(entry = THEME_ENTRY) {
  const css = await readFile(entry, "utf8");
  const base = dirname(entry);
  const files = [];
  const problems = [];
  for (const node of postcss.parse(css, { from: entry }).nodes) {
    if (node.type === "comment") continue;
    if (node.type === "atrule" && node.name === "import") {
      const match = IMPORT.exec(node.params.trim());
      if (match) {
        files.push(join(base, match[1]));
        continue;
      }
      problems.push(
        `${entry}:${node.source.start.line}: \`@import ${node.params}\` is not a form this reader understands, so the guards would never see that file while esbuild still bundles it. Write it as \`@import "./name.css";\`.`,
      );
      continue;
    }
    problems.push(
      `${entry}:${node.source.start.line}: ${entry} is the import list and nothing else, but this is ${node.type === "rule" ? `a rule (\`${node.selector}\`)` : `\`@${node.name}\``}. Move it into the section file it belongs to.`,
    );
  }
  if (files[0] !== join(base, "tokens.css")) {
    problems.push(
      `${entry}: tokens.css must be the FIRST import. Every file below it reads its tokens, and a bundle that does not carry the block at all still passes every check that reads the block from disk.`,
    );
  }
  // A section file that imports another one would put CSS in the bundle that no guard reading this
  // list ever visits. The entry is the import list; the sections are leaves.
  const bodies = await Promise.all(files.map((f) => readFile(f, "utf8").catch(() => "")));
  for (let i = 0; i < files.length; i++) {
    const at = postcss
      .parse(bodies[i], { from: files[i] })
      .nodes.find((n) => n.type === "atrule" && n.name === "import");
    if (at) {
      problems.push(
        `${files[i]}:${at.source.start.line}: \`@import ${at.params}\` — only ${entry} imports. A file pulled in from here is in the bundle but not in the list the guards read, so nothing would ever check it.`,
      );
    }
  }
  if (problems.length) {
    const error = new Error(problems.join("\n"));
    error.problems = problems;
    throw error;
  }
  return files;
}

/**
 * The whole theme as one string, plus `locate(line)` — a 1-based line in that string mapped back to
 * the `file:line` it came from, so a guard can point at the file a reader has to open.
 */
export async function readThemeBundle(entry = THEME_ENTRY) {
  const files = await themeFiles(entry);
  const parts = await Promise.all(files.map((f) => readFile(f, "utf8")));
  const index = [];
  const chunks = [];
  for (let i = 0; i < files.length; i++) {
    const lines = parts[i].split("\n");
    // A file ending in a newline splits to a trailing "" that is not a line of its own; keeping it
    // would push every later file's reported line number one further off than the last.
    if (lines.at(-1) === "") lines.pop();
    for (let n = 0; n < lines.length; n++) index.push([files[i], n + 1]);
    chunks.push(lines.join("\n") + "\n");
  }
  const css = chunks.join("");
  return {
    css,
    files,
    locate(line) {
      const hit = index[line - 1];
      return hit ? `${relative(".", hit[0])}:${hit[1]}` : entry;
    },
  };
}

/**
 * The stylesheet as CSS reads it: every declaration's property and value, and every at-rule's
 * prelude, with escapes decoded. `v\\61 r(--x)` is a var() call and `--folia\\-x` a token name, and
 * a guard that matched the letters as written would wave both through.
 */
export function parseDecoded(css, from) {
  const decode = (text) =>
    text.includes("\\")
      ? text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([^])/g, (_m, hex, ch) =>
          hex === undefined ? ch : String.fromCodePoint(parseInt(hex, 16)),
        )
      : text;
  const root = postcss.parse(css, { from });
  root.walk((node) => {
    if (node.type === "decl") {
      node.prop = decode(node.prop);
      node.value = decode(node.value);
    } else if (node.type === "atrule" && node.params) node.params = decode(node.params);
  });
  return root;
}

export const HOST_VARIABLES = join(THEME_DIR, "host", "variables.json");
export const FLOOR = join(THEME_DIR, "host", "floor.json");

/**
 * Walk the top-level var() calls of a value, yielding [name, fallbackText|null, start, end]. CSS
 * function names are case-insensitive, so `VAR(--x)` is a var() call too.
 */
export function* varCalls(value) {
  const lower = value.toLowerCase();
  for (let i = 0; i < value.length; i++) {
    if (!lower.startsWith("var(", i)) continue;
    let depth = 0;
    let j = i + 3;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")" && --depth === 0) break;
    }
    const inner = value.slice(i + 4, j);
    let comma = -1;
    let d = 0;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] === "(") d++;
      else if (inner[k] === ")") d--;
      else if (inner[k] === "," && d === 0) {
        comma = k;
        break;
      }
    }
    yield comma === -1
      ? [inner.trim(), null, i, j]
      : [inner.slice(0, comma).trim(), inner.slice(comma + 1).trim(), i, j];
    i = j;
  }
}

async function codeFiles(dir = "src") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await codeFiles(path)));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Every host variable the board reads, as name -> ["file:line", …]: each var() in the stylesheet
 * (fallbacks included), each `var(--x)` written literally in the board's code, and the column
 * palette, whose variable names are built at runtime by `columnAccent` and so are read by calling
 * it rather than by matching its template.
 */
export async function hostReads() {
  const reads = new Map();
  const add = (name, where) => {
    if (name.startsWith("--folia-")) return;
    if (!reads.has(name)) reads.set(name, []);
    reads.get(name).push(where);
  };
  const visit = (value, where) => {
    for (const [name, fallback] of varCalls(value)) {
      add(name, where);
      if (fallback !== null) visit(fallback, where);
    }
  };
  for (const file of [THEME_ENTRY, ...(await themeFiles())]) {
    parseDecoded(await readFile(file, "utf8"), file).walk((node) => {
      const where = `${file}:${node.source?.start?.line}`;
      if (node.type === "decl") visit(node.value, where);
      else if (node.type === "atrule" && node.params) visit(node.params, where);
    });
  }
  for (const file of await codeFiles()) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, n) => {
      for (const m of line.matchAll(/var\((--[A-Za-z0-9_-]+)(?![A-Za-z0-9_$-]|\$\{)/g))
        add(m[1], `${file}:${n + 1}`);
    });
  }
  const { COLUMN_COLORS, columnAccent } = await import(
    pathToFileURL(join("src", "ui", "columnColors.ts")).href
  );
  for (const name of COLUMN_COLORS) visit(columnAccent(name), "src/ui/columnColors.ts");
  return reads;
}

/**
 * The --folia-* names the board's code mentions, as name -> "file:line" of the first mention: the
 * channels it writes, and any it reads. Comments are skipped, so prose about the tokens is not a use.
 */
export async function codeTokens() {
  const names = new Map();
  for (const file of await codeFiles()) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, n) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.replace(/\/\/.*$/, "").matchAll(/--folia-[a-z0-9-]+/g))
        if (!names.has(m[0])) names.set(m[0], `${file}:${n + 1}`);
    });
  }
  return names;
}
