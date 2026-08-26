// Custom properties inherit down the DOM, and `createPortal` moves a subtree out of it. Every
// `--folia-*` token is declared in one rule, `.folia-scope` in src/styles.css, so a surface the
// plugin portals to the document body resolves NONE of them unless it carries that class itself:
// priority chips lose their colour, radii, shadows and font sizes silently fall back to nothing.
// jsdom cannot see this — it loads no stylesheet, so every test renders exactly what the component
// wrote. This check is that missing eye, at the source level.
//
// The rule cuts both ways. A portal whose container is the board root (`rootRef`) is still INSIDE
// the scope; putting the class on it would re-declare the static token fallbacks below the live
// values App sets inline on the root element (`--folia-statusbar-clearance`), so those portals must
// NOT carry it.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const UI_DIR = "src/ui";
const CSS_FILE = "src/styles.css";
const SCOPE = "folia-scope";
/** Container expressions that name a node inside the board root, where the scope already applies. */
const INSIDE_ROOT = /rootRef/;

/**
 * Index just past the `)` that closes the call whose `(` is at `open`, ignoring parens inside
 * strings, template literals and comments. Returns -1 when the source is unbalanced.
 */
function endOfCall(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === quote) break;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) return -1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i);
      if (i === -1) return -1;
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The call's arguments, split on the commas that sit at the call's own nesting depth. */
function splitArgs(inner) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      for (i++; i < inner.length; i++) {
        if (inner[i] === "\\") i++;
        else if (inner[i] === quote) break;
      }
      continue;
    }
    if (c === "/" && inner[i + 1] === "/") {
      i = inner.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && inner[i + 1] === "*") {
      i = inner.indexOf("*/", i);
      if (i === -1) break;
      i++;
      continue;
    }
    // JSX angle brackets are deliberately not counted: `=>` and `/>` would unbalance them. Parens
    // and braces are enough, since every comma that could matter sits inside one of those.
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  // A trailing comma (prettier adds one to a multi-line call) leaves an empty last slot.
  return args.filter((a) => a.trim() !== "");
}

/** The first `className=…` value in a JSX fragment: the portal root's own classes. */
function firstClassName(jsx) {
  const m = /className\s*=\s*(?:"([^"]*)"|\{([\s\S]*?)\})/.exec(jsx);
  if (!m) return null;
  return m[1] ?? m[2];
}

async function tsxFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsxFiles(full)));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const errors = [];
let checked = 0;

const css = await readFile(CSS_FILE, "utf8");
if (!/^\.folia-scope\s*\{/m.test(css)) {
  errors.push(`[${CSS_FILE}] no .folia-scope rule — the token block must hang off the scope class`);
}

for (const file of (await tsxFiles(UI_DIR)).sort()) {
  const src = await readFile(file, "utf8");
  for (const m of src.matchAll(/createPortal\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = endOfCall(src, open);
    const line = src.slice(0, m.index).split("\n").length;
    const where = `${file}:${line}`;
    if (close === -1) {
      errors.push(`[${where}] could not find the end of the createPortal call`);
      continue;
    }
    const args = splitArgs(src.slice(open + 1, close));
    if (args.length < 2) {
      errors.push(`[${where}] createPortal call has no container argument`);
      continue;
    }
    checked++;
    const classes = firstClassName(args[0]) ?? "";
    const container = args[args.length - 1];
    const scoped = classes.includes(SCOPE);
    if (INSIDE_ROOT.test(container)) {
      if (scoped) {
        errors.push(
          `[${where}] portals into the board root but carries \`${SCOPE}\`: that re-declares the ` +
            `static token fallbacks below the live values set on the root element. Drop the class.`,
        );
      }
      continue;
    }
    if (!scoped) {
      errors.push(
        `[${where}] portals outside the board root without \`${SCOPE}\` on its root element, so ` +
          `every --folia-* token resolves to nothing inside it. Add the class (classes: "${classes}").`,
      );
    }
  }
}

if (errors.length) {
  console.error("check-portal-scope: FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`check-portal-scope: OK (${checked} portals)`);
