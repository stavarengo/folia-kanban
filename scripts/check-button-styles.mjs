// Obsidian styles every plain button through `button:not(.clickable-icon)` — an element plus a
// pseudo-class, specificity (0,1,1) — and gives it `color`, `background-color` and `box-shadow`.
// A plugin rule that names a single class, `.folia-link { background: transparent }`, is (0,1,0)
// and LOSES: in the running app that button keeps the theme's raised face, however plainly the
// plugin meant to draw it. Nothing in the test suite can see it — jsdom loads no Obsidian theme,
// so there every rule computes exactly what the plugin wrote.
//
// This check is that missing eye. It pairs the classes the plugin puts on real `<button>` elements
// with the rules in `src/theme/` that colour them, and requires each such rule to out-specify
// (0,1,1). The usual fix is to name the class twice — `.folia-link.folia-link { … }` — which
// matches exactly the same elements at (0,2,0); selecting through an ancestor class works too.
//
// Doubling has a second edge, and the last pass here is about that one: the borrowed weight also
// out-ranks the plugin's own single-class rules for the same element, so a rule written to refine
// another can lose to it and go on reading correctly in the file. That collision has nothing to do
// with the tag, so that pass looks at every element the plugin dresses, not only the buttons.
//
// Only the properties the theme actually sets on buttons are policed, so a rule about layout,
// spacing or typography is left alone. One exception is deliberate: Obsidian also overrides button
// `padding`, but only under `.is-tablet`, so it costs nothing on desktop and policing it here would
// flag every button rule in the stylesheet for a case none of them is designed for.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readThemeBundle, THEME_DIR } from "./theme-bundle.mjs";
import process from "node:process";

// Only the React UI is scanned. Controls built through Obsidian's own Setting API
// (`src/settings.ts`) are deliberately out of scope: those are Obsidian's controls in Obsidian's
// settings pane, and they are SUPPOSED to wear the theme's face.
const UI_DIR = "src/ui";
const CSS_FILE = THEME_DIR;

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
 * The classes the plugin puts on the `<name>` elements it writes (the opening tag only). A literal
 * that ends in `-` is a class built at runtime (`"folia-chip-" + tone`), so it is kept as a PREFIX
 * and matches every rule for a class that starts with it — those rules dress the element too.
 */
function elementsNamed(tsx, name) {
  const open = `<${name}`;
  const out = [];
  for (let i = tsx.indexOf(open); i !== -1; i = tsx.indexOf(open, i + 1)) {
    // `<buttons>` is not a `<button>`, and `<span-ish>` is not a `<span>`.
    if (/[\w-]/.test(tsx[i + open.length] ?? "")) continue;
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

const buttons = (tsx) => elementsNamed(tsx, "button");

/**
 * Every element the plugin dresses, whatever its tag. The theme half of this check is about
 * <button> and nothing else, but the collision half is not: a doubled rule out-ranks its own
 * neighbours on a <p> exactly as it does on a button, and two of the rows that sent this check
 * looking were a <p> and a <span>. So no tag is named here — every lowercase opening tag in the
 * file is read, and only the ones carrying a `folia-*` class are kept. A TypeScript generic
 * (`Map<string, …>`) matches the same shape and falls out through that filter, which is why the
 * filter is the whole definition: a list of tag names would silently stop covering the next tag
 * someone reaches for.
 */
const carriers = (tsx) =>
  [...new Set([...tsx.matchAll(/<([a-z][\w-]*)/g)].map((m) => m[1]))]
    .flatMap((name) => elementsNamed(tsx, name))
    .filter((element) => element.classes.size > 0);

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
const { css } = await readThemeBundle();
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

/**
 * The shorthands this stylesheet writes, each with the longhands it sets. A rule saying
 * `font: inherit` and a rule saying `font-size: 11px` are a clash, and comparing property names
 * literally would never see it — that is exactly how `.folia-link.folia-link` spent a release
 * quietly setting the size of every title row that tried to declare its own.
 */
const SHORTHANDS = {
  animation: [
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "animation-fill-mode",
    "animation-play-state",
  ],
  background: [
    "background-color",
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
    "background-attachment",
    "background-clip",
    "background-origin",
  ],
  border: [
    "border-width",
    "border-style",
    "border-color",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
  ],
  "border-bottom": ["border-bottom-width", "border-bottom-style", "border-bottom-color"],
  "border-left": ["border-left-width", "border-left-style", "border-left-color"],
  "border-right": ["border-right-width", "border-right-style", "border-right-color"],
  "border-top": ["border-top-width", "border-top-style", "border-top-color"],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  font: ["font-style", "font-variant", "font-weight", "font-size", "line-height", "font-family"],
  gap: ["row-gap", "column-gap"],
  inset: ["top", "right", "bottom", "left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  "list-style": ["list-style-type", "list-style-position", "list-style-image"],
  outline: ["outline-width", "outline-style", "outline-color"],
  overflow: ["overflow-x", "overflow-y"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  "place-items": ["align-items", "justify-items"],
  "text-decoration": [
    "text-decoration-line",
    "text-decoration-color",
    "text-decoration-style",
    "text-decoration-thickness",
  ],
  transition: [
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
  ],
};

/**
 * Every property a rule body sets, each shorthand accompanied by the longhands it writes, so two
 * rules clash whenever the sets they touch overlap however each of them spelled it.
 */
const written = (body) =>
  body
    .split(";")
    .map((decl) => decl.split(":")[0]?.trim().toLowerCase())
    .filter((prop) => prop && !prop.startsWith("--"));

const properties = (body) => written(body).flatMap((prop) => [prop, ...(SHORTHANDS[prop] ?? [])]);

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

  const missing = ["color", "background", "box-shadow"].filter((p) => !covered.has(p));
  if (missing.length > 0) {
    const label = [...element.classes].join(" ");
    const problem = `${CSS_FILE}: the <button> with class "${label}" has no winning rule for ${missing.join(", ")}, so the theme still supplies ${missing.length === 1 ? "it" : "them"} in the real app. Declare ${missing.join(", ")} (\`none\` is a fine answer) on one of its own rules.`;
    if (!problems.includes(problem)) problems.push(problem);
  }
}

// Doubling a class to beat the theme also raises it against the plugin's OWN later rules, and that
// is the one way this convention can break something. Two rules on the same element setting the
// same property should still resolve by source order — the later one refines the earlier — so a
// case where weight overrules order means a refinement has gone silently dead. This runs over every
// element the plugin dresses, not only the buttons: the collision has nothing to do with the tag.
for (const element of carriers(tsx)) {
  const own = [...classes].flatMap((c) =>
    c.endsWith("-")
      ? element.classes.has(c)
        ? [...css.matchAll(new RegExp(`\\.(${c}[\\w-]+)`, "g"))].map((m) => m[1])
        : []
      : element.classes.has(c)
        ? [c]
        : [],
  );
  const dress = dressing(
    [...new Set([...own, ...element.classes])].filter((c) => !c.endsWith("-")),
  );
  for (const [i, earlier] of dress.entries()) {
    for (const later of dress.slice(i + 1)) {
      if (compare(earlier.spec, later.spec) <= 0) continue;
      // The comparison runs over expanded sets, the report over what the rule actually says: a
      // dead `transition` should read as one property, not as its five longhands.
      const beaten = new Set(properties(earlier.body));
      const clash = written(later.body).filter((prop) =>
        [prop, ...(SHORTHANDS[prop] ?? [])].some((p) => beaten.has(p)),
      );
      if (clash.length === 0) continue;
      const problem = `${CSS_FILE}: \`${later.selector}\` sets ${clash.join(", ")} for the element with class "${[...element.classes].join(" ")}", but the earlier \`${earlier.selector}\` out-weighs it, so that declaration is dead. Give \`${later.selector}\` the same doubled weight.`;
      if (!problems.includes(problem)) problems.push(problem);
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
