// Obsidian styles every plain button through `button:not(.clickable-icon)` — an element plus a
// pseudo-class, specificity (0,1,1) — and gives it `color`, `background-color` and `box-shadow`.
// A plugin rule that names a single class, `.folia-link { background: transparent }`, is (0,1,0)
// and LOSES: in the running app that button keeps the theme's raised face, however plainly the
// plugin meant to draw it. Nothing in the test suite can see it — jsdom loads no Obsidian theme,
// so there every rule computes exactly what the plugin wrote.
//
// This check is that missing eye. It pairs the classes the plugin puts on real `<button>` elements
// with the rules in `src/styles.css` that colour them, and requires each such rule to out-specify
// (0,1,1). The usual fix is to name the class twice — `.folia-link.folia-link { … }` — which
// matches exactly the same elements at (0,2,0); selecting through an ancestor class works too.
//
// Only the properties the theme actually sets on buttons are policed, so a rule about layout,
// spacing or typography is left alone. One exception is deliberate: Obsidian also overrides button
// `padding`, but only under `.is-tablet`, so it costs nothing on desktop and policing it here would
// flag every button rule in the stylesheet for a case none of them is designed for.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const UI_DIR = "src/ui";
const CSS_FILE = "src/styles.css";

/** What `button:not(.clickable-icon)` sets, and therefore what a plugin rule has to win to keep. */
const CONTESTED = ["background", "background-color", "box-shadow", "color"];
/** The specificity of that theme selector: one pseudo-class, one element. */
const THEME_SPECIFICITY = [0, 1, 1];

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * CSS specificity of a single (comma-free) selector as [ids, classes, elements]. Good enough for
 * the shapes this stylesheet uses: classes, elements, attributes, pseudo-classes and `:not()`/
 * `:is()`/`:where()`.
 */
function specificity(selector) {
  let rest = selector;
  const total = [0, 0, 0];
  rest = rest.replace(/:(not|is|where)\(([^()]*)\)/g, (_m, name, args) => {
    if (name === "where") return " ";
    const worst = args
      .split(",")
      .map((arg) => specificity(arg))
      .sort(compare)
      .pop() ?? [0, 0, 0];
    for (const i of [0, 1, 2]) total[i] += worst[i];
    return " ";
  });
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length;
  total[1] +=
    (rest.match(/\.[\w-]+/g) ?? []).length +
    (rest.match(/\[[^\]]*\]/g) ?? []).length +
    (rest.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const bare = rest.replace(/\.[\w-]+|#[\w-]+|::?[\w-]+|\[[^\]]*\]/g, " ");
  total[2] += (bare.match(/(?<![\w-])[a-zA-Z][\w-]*/g) ?? []).length;
  return total;
}

/**
 * The classes the plugin puts on real `<button>` elements (the opening tag only). A literal that
 * ends in `-` is a class built at runtime (`"folia-chip-" + tone`), so it is kept as a PREFIX and
 * matches every rule for a class that starts with it — those rules style buttons too.
 */
function buttonClasses(tsx) {
  const found = new Set();
  for (let i = tsx.indexOf("<button"); i !== -1; i = tsx.indexOf("<button", i + 1)) {
    let depth = 0;
    let end = i;
    while (end < tsx.length && !(tsx[end] === ">" && depth === 0)) {
      if (tsx[end] === "{") depth += 1;
      else if (tsx[end] === "}") depth -= 1;
      end += 1;
    }
    const tag = tsx.slice(i, end);
    for (const match of tag.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      for (const cls of match[1].split(/\s+/)) if (/^folia-[\w-]+$/.test(cls)) found.add(cls);
      for (const cls of match[1].split(/\s+/)) if (/^folia-[\w-]*-$/.test(cls)) found.add(cls);
    }
  }
  return found;
}

/** Every `selector { body }` pair, including the ones nested inside `@media`. */
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter((r) => r.selector && !r.selector.startsWith("@"));
}

const files = (await readdir(UI_DIR)).filter((f) => f.endsWith(".tsx"));
const tsx = (await Promise.all(files.map((f) => readFile(join(UI_DIR, f), "utf8")))).join("\n");
const classes = buttonClasses(tsx);
const css = await readFile(CSS_FILE, "utf8");

const setsContested = (body) =>
  body
    .split(";")
    .some((decl) => CONTESTED.includes(decl.split(":")[0]?.trim().toLowerCase() ?? ""));

const problems = [];
let checked = 0;
for (const { selector, body } of rules(css)) {
  if (!setsContested(body)) continue;
  for (const one of selector.split(",").map((s) => s.trim())) {
    const subject = one.split(/[\s>+~]+/).pop() ?? "";
    const family = [...classes].find(
      (c) => c.endsWith("-") && new RegExp(`\\.${c}[\\w-]+`).test(subject),
    );
    const hit = family
      ? subject.match(new RegExp(`\\.${family}[\\w-]+`))[0].slice(1)
      : [...classes].find((c) => new RegExp(`\\.${c}(?![\\w-])`).test(subject));
    if (!hit) continue;
    checked += 1;
    const spec = specificity(one);
    if (compare(spec, THEME_SPECIFICITY) <= 0) {
      problems.push(
        `${CSS_FILE}: \`${one}\` is (${spec.join(",")}) — it colours a <button> (.${hit}${family ? `, one of the runtime-built \`.${family}*\` classes` : ""}) but loses to \`button:not(.clickable-icon)\` (0,1,1), so the theme's face wins in the real app. Write it as \`${one.replace(`.${hit}`, `.${hit}.${hit}`)}\`.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("check-button-styles: FAILED");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `check-button-styles: OK (${checked} rule(s) colouring ${classes.size} button class(es) all out-specify the theme)`,
);
