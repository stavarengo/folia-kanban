// Custom properties inherit down the DOM, and `createPortal` moves a subtree out of it. Every
// `--folia-*` token is declared in one rule, `.folia-scope` in src/styles.css, so a surface the
// plugin portals to the document body resolves NONE of them unless it carries that class itself:
// priority chips lose their colour, radii, shadows and font sizes silently fall back to nothing.
// jsdom cannot see this — it loads no stylesheet, so every test renders exactly what the component
// wrote. This check is that missing eye, at the source level.
//
// The rule cuts both ways. A portal whose container IS the board root (`rootRef.current`) never left
// the scope, so the class there is redundant — and worse than redundant: it re-declares the whole
// token block below the root, shadowing any value App sets live on the root element
// (`--folia-statusbar-clearance` today) with the static fallback for everything underneath. So those
// portals must not carry it.
//
// Which side a portal is on is therefore a real question, and this check refuses to guess: only two
// container shapes are recognised, a document body (outside) and the board root ref (inside).
// Anything else is reported as unclassifiable rather than defaulted, because BOTH defaults are
// wrong in one direction — "assume outside" would tell an in-root portal to add the class and
// reintroduce the shadowing, "assume inside" would excuse a body portal with dead tokens. Teach it
// the new shape instead. Only `.tsx` and `.ts` under src/ are read, and only a JSX element literal
// can be judged: a portal whose first argument is a variable is reported, not waved through.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const SRC_DIR = "src";
const CSS_FILE = "src/styles.css";
const SCOPE = "folia-scope";
/** Container expressions that ARE the board root, where the scope already applies. */
const INSIDE_ROOT = [/^rootRef\.current$/];
/** Container expressions that name a document body, always outside the board root. */
const OUTSIDE_ROOT = [/(^|\.)body$/];

/**
 * Characters after which a `'` can legitimately open a JS string. In JSX TEXT an apostrophe is just
 * an apostrophe ("Don't"), and treating it as a quote would swallow the rest of the call; a real
 * string literal always follows an operator, a bracket or a comma.
 */
const QUOTE_OPENERS = new Set([
  "",
  "(",
  "[",
  "{",
  ",",
  ":",
  "=",
  "?",
  "&",
  "|",
  "!",
  "+",
  ";",
  ">",
]);

/** True when the `'`/`"`/`` ` `` at `i` opens a string rather than sitting inside JSX text. */
function opensString(src, i) {
  if (src[i] !== "'") return true;
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  return QUOTE_OPENERS.has(j < 0 ? "" : src[j]);
}

/** Index of the character after the string/comment starting at `i`, or `i` when nothing starts there. */
function skipInert(src, i) {
  const c = src[i];
  if (c === '"' || c === "'" || c === "`") {
    if (!opensString(src, i)) return i;
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === "\\") j++;
      else if (src[j] === c) return j;
    }
    return src.length;
  }
  if (c === "/" && src[i + 1] === "/") {
    const nl = src.indexOf("\n", i);
    return nl === -1 ? src.length : nl;
  }
  if (c === "/" && src[i + 1] === "*") {
    const end = src.indexOf("*/", i);
    return end === -1 ? src.length : end + 1;
  }
  return i;
}

/**
 * Index just past the `)` that closes the call whose `(` is at `open`, ignoring parens inside
 * strings, template literals and comments. Returns -1 when the source is unbalanced.
 */
function endOfCall(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const skipped = skipInert(src, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = src[i];
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
    const skipped = skipInert(inner, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = inner[i];
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

/**
 * The portal root's own opening tag — from its `<` to the `>` that ends that tag, and no further,
 * so a className on a CHILD can never be mistaken for the root's. Returns null when the first
 * argument is not a JSX element literal (a variable, a call), which the caller reports rather than
 * waves through: this check can only see classes written here.
 */
function openingTag(jsx) {
  const start = jsx.indexOf("<");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + 1; i < jsx.length; i++) {
    const skipped = skipInert(jsx, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = jsx[i];
    if (c === "{" || c === "(") depth++;
    else if (c === "}" || c === ")") depth--;
    else if (c === "<" && depth === 0)
      return null; // a child tag before this one closed: malformed
    else if (c === ">" && depth === 0) return jsx.slice(start, i + 1);
  }
  return null;
}

/**
 * The `className=…` value on that opening tag, or "" when it declares none. A braced value is read
 * to its OWN matching `}`, never to the last one in the tag — otherwise every later attribute
 * (`data-x={"folia-scope"}`, an aria-label) would count as a class and could satisfy the check.
 */
function rootClassName(tag) {
  const at = /className\s*=\s*/.exec(tag);
  if (!at) return "";
  const start = at.index + at[0].length;
  if (tag[start] === '"' || tag[start] === "'") {
    const end = tag.indexOf(tag[start], start + 1);
    return end === -1 ? "" : tag.slice(start + 1, end);
  }
  if (tag[start] !== "{") return "";
  let depth = 0;
  for (let i = start; i < tag.length; i++) {
    const skipped = skipInert(tag, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(start + 1, i);
  }
  return "";
}

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const errors = [];
let checked = 0;

const css = await readFile(CSS_FILE, "utf8");
if (!/^\.folia-scope\s*\{/m.test(css)) {
  errors.push(`[${CSS_FILE}] no .folia-scope rule — the token block must hang off the scope class`);
}

for (const file of (await sourceFiles(SRC_DIR)).sort()) {
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
    const tag = openingTag(args[0]);
    if (tag === null) {
      errors.push(
        `[${where}] the portalled element is not a JSX literal here, so its classes cannot be ` +
          `checked. Portal a real element and put \`${SCOPE}\` on it.`,
      );
      continue;
    }
    const classes = rootClassName(tag);
    const container = args[args.length - 1].trim();
    // Tokenised rather than split on whitespace, so a computed className (`{"a " + b}`) whose
    // quotes cling to the first and last word is still read class by class.
    const scoped = (classes.match(/[A-Za-z0-9_-]+/g) ?? []).includes(SCOPE);
    if (
      !INSIDE_ROOT.some((re) => re.test(container)) &&
      !OUTSIDE_ROOT.some((re) => re.test(container))
    ) {
      errors.push(
        `[${where}] cannot tell whether the container \`${container}\` is inside the board root, and ` +
          `guessing would be wrong either way. Teach INSIDE_ROOT/OUTSIDE_ROOT in this script about ` +
          `the new shape.`,
      );
      continue;
    }
    if (INSIDE_ROOT.some((re) => re.test(container))) {
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
