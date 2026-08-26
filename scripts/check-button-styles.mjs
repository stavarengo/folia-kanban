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
function buttons(tsx) {
  const out = [];
  for (let i = tsx.indexOf("<button"); i !== -1; i = tsx.indexOf("<button", i + 1)) {
    let depth = 0;
    let end = i;
    while (end < tsx.length && !(tsx[end] === ">" && depth === 0)) {
      if (tsx[end] === "{") depth += 1;
      else if (tsx[end] === "}") depth -= 1;
      end += 1;
    }
    const tag = tsx.slice(i, end);
    const classes = new Set();
    for (const match of tag.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      for (const cls of match[1].split(/\s+/)) {
        if (/^folia-[\w-]+$/.test(cls) || /^folia-[\w-]*-$/.test(cls)) classes.add(cls);
      }
    }
    if (classes.size > 0) out.push({ classes, styled: /\bstyle=/.test(tag) });
    i = end;
  }
  return out;
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
const elements = buttons(tsx);
const classes = new Set(elements.flatMap((b) => [...b.classes]));
const css = await readFile(CSS_FILE, "utf8");
const parsed = rules(css);

const setsContested = (body) =>
  body
    .split(";")
    .some((decl) => CONTESTED.includes(decl.split(":")[0]?.trim().toLowerCase() ?? ""));

const problems = [];
let checked = 0;
for (const { selector, body } of parsed) {
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

// Second half: winning a property the plugin never writes is not the same as writing it. A rule
// that resets `background` but says nothing about `box-shadow` leaves the theme's raised face on
// the button, which is the shape the original bug took. So each button is checked as an ELEMENT:
// the rules that dress it in its resting state, all of them together, must speak for every
// contested property. Only rules with no pseudo-class count — a `:hover` background says nothing
// about how the button looks before the pointer arrives.
const declared = (body) =>
  body
    .split(";")
    .map((decl) => decl.split(":")[0]?.trim().toLowerCase())
    .map((prop) => (prop === "background-color" ? "background" : prop))
    .filter((prop) => CONTESTED.includes(prop) || prop === "background");

for (const element of elements) {
  const own = [...classes].flatMap((c) =>
    c.endsWith("-")
      ? element.classes.has(c)
        ? [...css.matchAll(new RegExp(`\\.(${c}[\\w-]+)`, "g"))].map((m) => m[1])
        : []
      : element.classes.has(c)
        ? [c]
        : [],
  );
  const covered = new Set(element.styled ? ["background"] : []);
  for (const { selector, body } of parsed) {
    for (const one of selector.split(",").map((s) => s.trim())) {
      if (one.includes(":")) continue;
      const subject = one.split(/[\s>+~]+/).pop() ?? "";
      const named = [...subject.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (named.length === 0 || !named.every((c) => own.includes(c))) continue;
      if (compare(specificity(one), THEME_SPECIFICITY) <= 0) continue;
      for (const prop of declared(body)) covered.add(prop);
    }
  }
  const missing = ["color", "background", "box-shadow"].filter((p) => !covered.has(p));
  if (missing.length > 0) {
    const label = [...element.classes].join(" ");
    const problem = `${CSS_FILE}: the <button> with class "${label}" has no winning rule for ${missing.join(", ")}, so the theme still supplies ${missing.length === 1 ? "it" : "them"} in the real app. Declare ${missing.join(", ")} (\`none\` is a fine answer) on one of its own rules.`;
    if (!problems.includes(problem)) problems.push(problem);
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
