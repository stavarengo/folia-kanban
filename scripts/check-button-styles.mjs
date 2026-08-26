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

// Only the React UI is scanned. Buttons built through Obsidian's own Setting API (`src/settings.ts`)
// are deliberately out of scope: those are Obsidian's controls in Obsidian's settings pane, and
// they are SUPPOSED to wear the theme's button face.
const UI_DIR = "src/ui";
const CSS_FILE = "src/styles.css";

/**
 * What `button:not(.clickable-icon)` sets in Obsidian's own app.css, and therefore what a plugin
 * rule has to win to keep. Read out of the installed Obsidian's own `obsidian.asar`, where the
 * desktop rule sets exactly `color`, `background-color` and `box-shadow`. `border` is not on the
 * list because nothing at that specificity sets it — the border a button starts with comes from the
 * user agent, which any single class already beats. `padding` is set, but only under
 * `.is-tablet`, so on desktop it costs nothing and policing it here would flag every button rule
 * in the stylesheet for a case none of them is designed for.
 */
const CONTESTED = ["background", "background-color", "box-shadow", "color"];
/** The specificity of that theme selector: one pseudo-class, one element. */
const THEME_SPECIFICITY = [0, 1, 1];

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * CSS specificity of a single (comma-free) selector as [ids, classes, elements]. Good enough for
 * the shapes this stylesheet uses: classes, elements, attributes, pseudo-classes and `:not()`/
 * `:is()`/`:where()`. Nested parentheses (`:is(a:not(b))`) and functional arguments that look like
 * type selectors (`:nth-child(2n+1)`) are counted a little high — the error direction is towards
 * "this rule wins", so a miscount can only let a rule through, never invent a failure. Neither
 * shape appears in the stylesheet; if one ever does, count it by hand.
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
    out.push({
      classes,
      // An inline `style` naming a background is dressing the stylesheet cannot see but the button
      // really has: a colour swatch paints itself. Any other inline style is ignored.
      styled: /style=\{[^}]*background/.test(tag),
      tag: tag.replace(/\s+/g, " ").slice(0, 90),
    });
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

const files = (await readdir(UI_DIR, { recursive: true })).filter((f) => f.endsWith(".tsx"));
const tsx = (await Promise.all(files.map((f) => readFile(join(UI_DIR, f), "utf8")))).join("\n");
const elements = buttons(tsx);
const classes = new Set(elements.flatMap((b) => [...b.classes]));
const unclassed = elements.filter((b) => b.classes.size === 0);
const css = await readFile(CSS_FILE, "utf8");
const parsed = rules(css);

const problemsEarly = [];

const setsContested = (body) =>
  body
    .split(";")
    .some((decl) => CONTESTED.includes(decl.split(":")[0]?.trim().toLowerCase() ?? ""));

// Finding nothing to check is a broken check, not a clean one: a moved file or a changed markup
// convention would otherwise pass silently for as long as it takes someone to notice.
if (elements.length === 0) {
  console.error(
    `check-button-styles: FAILED — found no <button> at all in ${UI_DIR}/**. Either the markup convention changed or this script stopped finding the files.`,
  );
  process.exit(1);
}

// A button with no `folia-*` class of its own cannot be dressed by any rule this check can find,
// so it wears whatever the theme gives it. That may even be what someone wants, but it has to be a
// decision rather than an omission, and this is the only place it can be seen.
for (const button of unclassed) {
  problemsEarly.push(
    `${UI_DIR}/**: \`${button.tag}…\` carries no folia-* class, so nothing in ${CSS_FILE} can dress it and the theme's button face is what shows. Give it a class the stylesheet styles.`,
  );
}

const problems = [...problemsEarly];
let checked = 0;
for (const { selector, body } of parsed) {
  if (!setsContested(body)) continue;
  for (const one of selector.split(",").map((s) => s.trim())) {
    const subject = one.split(/[\s>+~]+/).pop() ?? "";
    // A rule can reach these buttons without naming a class at all — `.folia-toolbar button` is
    // (0,1,1), a TIE with the theme rule that then loses on source order. Treat the bare element
    // as a subject in its own right so that shape cannot slip through.
    const bareButton = /(^|[\s>+~])button(?![\w-])/.test(subject);
    const family = [...classes].find(
      (c) => c.endsWith("-") && new RegExp(`\\.${c}[\\w-]+`).test(subject),
    );
    const hit = family
      ? subject.match(new RegExp(`\\.${family}[\\w-]+`))[0].slice(1)
      : [...classes].find((c) => new RegExp(`\\.${c}(?![\\w-])`).test(subject));
    if (!hit && !bareButton) continue;
    checked += 1;
    const spec = specificity(one);
    if (compare(spec, THEME_SPECIFICITY) <= 0) {
      problems.push(
        hit
          ? `${CSS_FILE}: \`${one}\` is (${spec.join(",")}) — it colours a <button> (.${hit}${family ? `, one of the runtime-built \`.${family}*\` classes` : ""}) but loses to \`button:not(.clickable-icon)\` (0,1,1), so the theme's face wins in the real app. Write it as \`${one.replace(`.${hit}`, `.${hit}.${hit}`)}\`.`
          : `${CSS_FILE}: \`${one}\` is (${spec.join(",")}) — it colours buttons through the bare element, which does not beat \`button:not(.clickable-icon)\` (0,1,1), so the theme's face wins in the real app. Select the button by a class it carries, named twice.`,
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

/**
 * The rules that dress one button in its resting state, in source order, each with its specificity.
 * Descendant rules count on the assumption their ancestor matches — conservative in the direction
 * of "this button is dressed", which is the only direction that can hide a problem here.
 */
function dressing(own) {
  const out = [];
  for (const [order, { selector, body }] of parsed.entries()) {
    for (const one of selector.split(",").map((sel) => sel.trim())) {
      if (one.includes(":")) continue;
      const subject = one.split(/[\s>+~]+/).pop() ?? "";
      const named = [...subject.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (named.length === 0 || !named.every((c) => own.includes(c))) continue;
      out.push({ selector: one, body, order, spec: specificity(one) });
    }
  }
  return out;
}

/** Every property a rule body sets, normalised enough to compare two rules for a clash. */
const properties = (body) =>
  body
    .split(";")
    .map((decl) => decl.split(":")[0]?.trim().toLowerCase())
    .filter((prop) => prop && !prop.startsWith("--"));

for (const element of elements) {
  // A runtime-built family (`"folia-chip-" + tone`) is credited as a whole: which member a button
  // ends up carrying is a render-time decision, so the check asks that the family dresses it rather
  // than pretending to know which one shows.
  const own = [...classes].flatMap((c) =>
    c.endsWith("-")
      ? element.classes.has(c)
        ? [...css.matchAll(new RegExp(`\\.(${c}[\\w-]+)`, "g"))].map((m) => m[1])
        : []
      : element.classes.has(c)
        ? [c]
        : [],
  );
  const dress = dressing(own);
  const covered = new Set(element.styled ? ["background"] : []);
  for (const rule of dress) {
    if (compare(rule.spec, THEME_SPECIFICITY) <= 0) continue;
    for (const prop of declared(rule.body)) covered.add(prop);
  }

  // Doubling a class to beat the theme also raises it against the plugin's OWN later rules, and
  // that is the one way this convention can break something. Two rules on the same button setting
  // the same property should still resolve by source order — the later one refines the earlier —
  // so a case where weight overrules order means a refinement has gone silently dead.
  for (const [i, earlier] of dress.entries()) {
    for (const later of dress.slice(i + 1)) {
      if (compare(earlier.spec, later.spec) <= 0) continue;
      const clash = properties(earlier.body).filter((prop) =>
        properties(later.body).includes(prop),
      );
      if (clash.length === 0) continue;
      problems.push(
        `${CSS_FILE}: \`${later.selector}\` sets ${clash.join(", ")} for the <button> with class "${[...element.classes].join(" ")}", but the earlier \`${earlier.selector}\` now out-weighs it, so that declaration is dead. Give \`${later.selector}\` the same doubled weight.`,
      );
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
