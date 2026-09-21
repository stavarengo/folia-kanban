#!/usr/bin/env node
// The one guard over src/theme. It replaces the old tokens:check bijection and the raw-value
// ratchet with a rule the ratchet could never state: the --folia-* layer is a TRANSLATION of
// Obsidian's design foundations, so every token is either an alias of a variable Obsidian
// documents or an owned value that says in writing why Obsidian has no answer for it.
//
//   A  every var(--x) resolves — a --folia-* token, a documented host variable, or an observed one
//   B  src/theme/host/observed.json is the only home for a host variable the docs do not list
//   C  no raw design value outside src/theme/tokens.css
//   D  tokens.css and tokens/*.tokens.json agree on base values and light/dark overrides
//   E  an owned token whose value is already a documented default must alias that variable
//   F  the eight column hexes match src/ui/columnColors.ts
//
// What it deliberately does not police, so the gaps are chosen rather than discovered:
//
//   - Whether a fallback can ever fire. `var(--color-red, #e5534b)` is an ALIAS of --color-red
//     whose fallback is declared in the metadata, so the relationship is recorded either way and
//     the fallback cannot turn an alias into an owned value by being there. What the guard asks of
//     it is that the CSS and the metadata say the same thing, that it carries a reason, and that it
//     agrees with the documented default when the registry has one. Reachability it cannot decide:
//     the answer lives in the running app, not in the docs.
//   - The unitless numbers inside a `transform`. `translate(-50%, var(--x)) scale(0.94)` is one
//     geometry, readable only whole; a scale factor named elsewhere would be worse, not better.
//     Lengths and angles inside a transform ARE policed, and a bare number anywhere else is not
//     exempt — `filter: brightness(1.06)` is a design value and has a token.
//   - The properties in UNITLESS_OK, whose numbers are counts the layout engine reads rather than
//     sizes anyone chose, and the multipliers 0, 1, -1 and 2 inside a math function.
//
// Run: pnpm theme:check

import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import process from "node:process";
import postcss from "postcss";
import { themeFiles, THEME_DIR, THEME_ENTRY } from "./theme-bundle.mjs";

const TOKENS_CSS = join(THEME_DIR, "tokens.css");
const TOKENS_JSON_DIR = join(THEME_DIR, "tokens");
const HOST_DIR = join(THEME_DIR, "host");
const COLUMN_COLORS = "src/ui/columnColors.ts";

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

const json = async (path) => JSON.parse(await readFile(path, "utf8"));

// ------------------------------------------------------------------ the host registry
const registry = (await json(join(HOST_DIR, "variables.json"))).variables;
const observed = await json(join(HOST_DIR, "observed.json"));

for (const [name, entry] of Object.entries(observed)) {
  if (name in registry) {
    fail(
      join(HOST_DIR, "observed.json"),
      `${name} is documented (${registry[name].pages.join(", ")}), so it does not belong here — delete the entry and read it as a documented variable.`,
    );
  }
  const text = (v) => typeof v === "string" && v.trim() !== "";
  if (!text(entry?.observedIn) || !text(entry?.where)) {
    fail(
      join(HOST_DIR, "observed.json"),
      `${name} needs both "observedIn" (the Obsidian version it was seen in) and "where" (where it was seen), so a later reader can re-check it.`,
    );
  }
}

/**
 * Obsidian documents two surfaces with one set of pages, and the registry records which: `app` for
 * the application a plugin runs inside, `publish` for the static site Publish renders. A Publish
 * variable is documented and real and still means nothing here, so it is not a host variable this
 * board may read.
 */
const publishOnly = (name) => registry[name]?.scope === "publish";
const hostKnows = (name) => (name in registry && !publishOnly(name)) || name in observed;

// ------------------------------------------------------------------ the token block
const tokensCss = await readFile(TOKENS_CSS, "utf8");
const tokensRoot = postcss.parse(tokensCss, { from: TOKENS_CSS });

/** Base declarations and optional scheme overrides, all in tokens.css. */
const declared = new Map();
const themed = new Map([
  ["light", new Map()],
  ["dark", new Map()],
]);
const selectors = new Map([
  [".folia-scope", declared],
  [".theme-light .folia-scope", themed.get("light")],
  [".theme-dark .folia-scope", themed.get("dark")],
]);
const seenRules = new Set();
for (const rule of tokensRoot.nodes) {
  if (rule.type === "comment") continue;
  const map = rule.type === "rule" && selectors.get(rule.selector.trim());
  if (!map) {
    fail(
      TOKENS_CSS,
      "Only .folia-scope and .theme-light/.theme-dark .folia-scope rules belong in the token file.",
    );
    continue;
  }
  if (seenRules.has(map)) fail(TOKENS_CSS, `Duplicate token rule: ${rule.selector}.`);
  if (map !== declared && !seenRules.has(declared))
    fail(TOKENS_CSS, "Theme overrides must follow the base token block.");
  seenRules.add(map);
  for (const d of rule.nodes ?? []) {
    if (d.type === "comment") continue;
    const at = `${TOKENS_CSS}:${d.source.start.line}`;
    if (d.type !== "decl") {
      fail(at, "Token blocks must be flat lists of declarations.");
      continue;
    }
    if (!d.prop.startsWith("--folia-")) {
      if (map !== declared) fail(at, "Theme overrides may only redeclare --folia-* tokens.");
      continue;
    }
    if (d.important) fail(at, `${d.prop} may not use !important.`);
    if (map.has(d.prop)) fail(at, `${d.prop} is declared twice in ${rule.selector}.`);
    if (map !== declared && !declared.has(d.prop)) fail(at, `${d.prop} has no base declaration.`);
    map.set(d.prop, { value: d.value.trim(), line: d.source.start.line });
  }
}
if (!seenRules.has(declared)) fail(TOKENS_CSS, "Missing .folia-scope token block.");

// A token may read another token, and a chain of those may close on itself. CSS calls that cycle
// invalid at computed-value time: not "falls back to the previous value" but "this declaration and
// every declaration that reads it are thrown away", which is a blank board from one edit. Nothing
// in the browser reports it, so "every var() resolves" has to mean resolves, not merely names
// something that exists.
const effectiveSchemes = new Map([
  ["base", declared],
  ...[...themed].map(([scheme, overrides]) => [scheme, new Map([...declared, ...overrides])]),
]);
for (const [scheme, effective] of effectiveSchemes) {
  const state = new Map();
  const walk = (name, trail) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "open") {
      const loop = trail.slice(trail.indexOf(name));
      fail(
        `${TOKENS_CSS}:${effective.get(name).line}`,
        `${loop.concat(name).join(" → ")} is a cycle in the ${scheme} scheme. CSS throws away every declaration in it, and every declaration that reads one, so the rules that use these tokens would compute to nothing at all.`,
      );
      return;
    }
    state.set(name, "open");
    for (const next of tokenDependencies(effective.get(name).value)) {
      if (effective.has(next)) walk(next, [...trail, name]);
    }
    state.set(name, "done");
  };
  for (const name of effective.keys()) walk(name, []);
}

// ------------------------------------------------------------------ value scanning (rules A + C)
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet " +
    "brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan " +
    "darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen " +
    "darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey " +
    "darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
    "forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue " +
    "lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon " +
    "lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime " +
    "limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple " +
    "mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue " +
    "mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen " +
    "seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);
const COLOR_FUNCTIONS = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
// A CSS number may carry an exponent — `1e3px` is a thousand pixels — so every scan below spells
// the number the way the grammar does rather than the way people write it.
const NUMBER = String.raw`-?\d*\.?\d+(?:[eE][-+]?\d+)?`;
const DIMENSION = new RegExp(
  String.raw`(?<![\w.#-])` +
    NUMBER +
    String.raw`(px|em|rem|ex|ch|cap|ic|lh|rlh|vh|vw|vi|vb|vmin|vmax|[dsl]v(?:h|w|min|max|i|b)|cq[whibx]|cqmin|cqmax|cm|mm|in|pt|pc|q|ms|s|deg|rad|grad|turn)(?![\w%-])`,
  "i",
);
const NUMERIC_PROPS = new Set(["font-size", "font-weight", "line-height", "z-index", "opacity"]);
const SHADOW_PROPS = new Set(["box-shadow", "text-shadow"]);
/** Unitless numbers that carry no design intent: ratios the layout engine reads as counts. */
const UNITLESS_OK = new Set([
  "flex",
  "flex-grow",
  "flex-shrink",
  "order",
  "grid-row",
  "grid-column",
  "grid-row-start",
  "grid-row-end",
  "grid-column-start",
  "grid-column-end",
  "columns",
  "column-count",
  "tab-size",
  "animation-iteration-count",
  "scale",
  "zoom",
  "-webkit-line-clamp",
]);

/**
 * Walk the top-level var() calls of a value, yielding [name, fallbackText|null].
 *
 * The text has already been unescaped by `read()`: CSS lets any identifier be spelled with
 * escapes, so `v\\61 r(--x)` is a var() call and `17p\\78` is seventeen pixels, and a reader that
 * matched letters would wave both through.
 *
 * CSS function names are case-insensitive, so `VAR(--anything)` is a var() call and a reader that
 * only knows the lowercase spelling would wave it through — along with everything else this file
 * checks, since every other rule reads the value through here.
 */
function* varCalls(value) {
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

// Fallback references participate in CSS cycles even when the fallback would not be used.
function tokenDependencies(value) {
  const dependencies = [];
  const visit = (text) => {
    for (const [name, fallback] of varCalls(text)) {
      if (name.startsWith("--folia-")) dependencies.push(name);
      if (fallback !== null) visit(fallback);
    }
  };
  visit(read(value));
  return dependencies;
}

/**
 * The value with every var() NAME replaced by a neutral placeholder — and every fallback left in,
 * stripped the same way. A fallback is live CSS: `var(--x, 17px)` paints 17 pixels the moment
 * `--x` is missing, so dropping it here would let a raw value in through the one door this rule
 * exists to close.
 */
function stripVars(value) {
  let out = "";
  let last = 0;
  for (const [, fallback, start, end] of varCalls(value)) {
    out += value.slice(last, start) + " § ";
    if (fallback !== null) out += ` ${stripVars(fallback)} `;
    last = end + 1;
  }
  return out + value.slice(last);
}

/** A property or value as CSS means it: escapes decoded, and (for a property) lower-cased. */
function read(text, { lower = false } = {}) {
  const decoded = text.includes("\\")
    ? text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([^])/g, (_m, hex, ch) =>
        hex === undefined ? ch : String.fromCodePoint(parseInt(hex, 16)),
      )
    : text;
  return lower ? decoded.toLowerCase() : decoded;
}

/** Rule A, applied to one value wherever it appears. */
function checkVarsResolve(value, where, line) {
  for (const [name, fallback] of varCalls(value)) {
    if (name.startsWith("--folia-")) {
      if (!declared.has(name)) {
        fail(
          `${where}:${line}`,
          `var(${name}) resolves to nothing — no such token in ${TOKENS_CSS}. Declare it there (with its metadata in ${TOKENS_JSON_DIR}) or use a token that exists.`,
        );
      } else if (fallback !== null && declared.get(name).value !== "initial") {
        fail(
          `${where}:${line}`,
          `var(${name}, ${fallback}) carries a fallback for a token that is always declared in ${TOKENS_CSS}, so the fallback is dead text that only hides a raw value. Write var(${name}). (A token declared \`initial\` is the exception — that one really can be absent.)`,
        );
      }
    } else if (publishOnly(name)) {
      fail(
        `${where}:${line}`,
        `var(${name}) is documented for Obsidian Publish (${registry[name].pages.join(", ")}), not for the app this plugin runs inside, so nothing defines it here. Use an app variable, or record it in ${join(HOST_DIR, "observed.json")} if you have actually seen the app define it.`,
      );
    } else if (!hostKnows(name)) {
      fail(
        `${where}:${line}`,
        `var(${name}) is not a variable Obsidian documents. If the running app really defines it, record it in ${join(HOST_DIR, "observed.json")} with the version you saw it in and where; otherwise use a documented variable.`,
      );
    }
    if (fallback !== null) checkVarsResolve(fallback, where, line);
  }
}

/** Rule C, applied to one declaration outside tokens.css. */
/**
 * A `--folia-*` declaration in a component file is an OVERRIDE — the urgency cue swapping its
 * colour per due state — and the two ways it can stop being that are both invisible in the file
 * that does it: re-declaring at `.folia-scope`, which quietly replaces the block for everything
 * below, and reading the token it is declaring, which CSS throws away along with every declaration
 * that reads it.
 */
function checkTokenOverride(decl, where, selector) {
  const prop = read(decl.prop, { lower: true });
  const line = decl.source.start.line;
  if (selector.split(",").some((s) => s.trim() === ".folia-scope")) {
    fail(
      `${where}:${line}`,
      `${prop} is declared on \`.folia-scope\` here, which re-declares the token block for everything below this rule. ${TOKENS_CSS} is the one place a token is defined.`,
    );
  }
  if (/\.theme-(?:light|dark)\b/.test(selector)) {
    fail(
      `${where}:${line}`,
      "Theme token overrides belong only in tokens.css with matching theme metadata.",
    );
  }
  // A component selector can match a token scope itself (for example a portalled menu).
  // Check that possible overlap conservatively; this is not a selector/cascade evaluator.
  for (const [scheme, effective] of effectiveSchemes) {
    const seen = new Set([prop]);
    const queue = tokenDependencies(decl.value);
    while (queue.length) {
      const next = queue.shift();
      if (next === prop) {
        fail(
          `${where}:${line}`,
          `${prop} reads itself directly or through the ${scheme} token map. This would form a cycle if the component rule and token declarations apply to the same element. Keep component overrides independent of tokens that read them.`,
        );
        return;
      }
      if (seen.has(next) || !effective.has(next)) continue;
      seen.add(next);
      queue.push(...tokenDependencies(effective.get(next).value));
    }
  }
}

function checkRawValues(decl, where) {
  const line = decl.source.start.line;
  // Read as CSS reads it: property names are case-insensitive and either side may be spelled with
  // escapes. The message quotes what is actually written, so the reader can find the line.
  const prop = read(decl.prop, { lower: true });
  const bare = stripVars(read(decl.value));
  const say = (what, advice) =>
    fail(`${where}:${line}`, `\`${decl.prop}: ${decl.value}\` — ${what}. ${advice}`);
  const TOKENISE = `Move the value into ${TOKENS_CSS} as a token named for what it is FOR, and read it here through var().`;

  if (prop.startsWith("--")) {
    // A component rule may RE-declare a token (the urgency cue swaps its colour per due state), but
    // it may not invent one: a name with no entry in the block is a token nobody can find.
    if (
      where !== TOKENS_CSS &&
      !declared.has(prop) &&
      !["--icon-size", "--icon-stroke"].includes(prop)
    ) {
      fail(
        `${where}:${line}`,
        `${prop} is declared here but nowhere in ${TOKENS_CSS}, so it is a token no reader can look up. Declare it in the block (with its metadata) and override it here.`,
      );
    }
    if (where === TOKENS_CSS) return;
  }

  const hex = bare.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) return say(`${hex[0]} is a colour literal`, TOKENISE);
  const fn = bare.match(COLOR_FUNCTIONS);
  if (fn) return say(`${fn[0]}…) is a colour literal`, TOKENISE);
  for (const word of bare.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (NAMED_COLORS.has(word)) return say(`\`${word}\` is a named colour`, TOKENISE);
  }

  const dim = bare.match(DIMENSION);
  if (dim) return say(`${dim[0]} is a raw ${dimensionKind(dim[1])}`, TOKENISE);

  if (SHADOW_PROPS.has(prop) && !/^\s*(none|§|inherit|initial|unset)\s*$/.test(bare)) {
    return say("a shadow is written out here", TOKENISE);
  }
  if ((prop === "font-family" || prop === "font") && !/^[\s\u00a7]*$/.test(bare)) {
    // `font` is the shorthand: it sets a family and a size at once. `font: inherit`, the one the
    // board uses, sets neither.
    if (!/^\s*(inherit|initial|unset|revert)\s*$/.test(bare)) {
      return say(
        prop === "font"
          ? "the font shorthand sets a family and a size here"
          : "a font stack is written out here",
        TOKENISE,
      );
    }
  }
  if (prop === "cursor" && !/^\s*§\s*$/.test(bare)) {
    return say(
      `\`${decl.value}\` is a cursor keyword`,
      `${TOKENISE} (Use --cursor for controls and --cursor-link for links.)`,
    );
  }
  if (NUMERIC_PROPS.has(prop)) {
    // A percentage counts here. `opacity: 50%` renders exactly as `opacity: 0.5`, so allowing one
    // spelling while rejecting the other would only teach people which spelling to use.
    const number = bare.match(
      new RegExp(String.raw`(?<![\w.#-])` + NUMBER + String.raw`%?(?![\w.-])`),
    );
    if (number) return say(`${prop} is written as a number`, TOKENISE);
  }
  if (!NUMERIC_PROPS.has(prop) && !UNITLESS_OK.has(prop)) {
    // A bare number outside the properties above is almost always a length that lost its unit or a
    // value that should be named; `0` is the one that never carries design intent.
    //
    // Arithmetic on tokens is fine; arithmetic that SCALES one is a design decision hiding as a
    // sum, so only the two multipliers that mean something structural pass a math function: -1,
    // which negates a token CSS gives no other way to negate, and 2, a symmetric pair. The lengths
    // inside those functions have already been judged by the raw-length scan above.
    const MATH = /\b(?:calc|min|max|clamp)\([^()]*(?:\([^()]*\)[^()]*)*\)/g;
    const NUMBERS = new RegExp(String.raw`(?<![\w.#-])` + NUMBER + String.raw`(?![\w.%-])`, "g");
    for (const math of bare.match(MATH) ?? []) {
      const odd = math.match(NUMBERS)?.find((n) => ![0, 1, -1, 2].includes(Number(n)));
      if (odd) {
        return say(
          `\`${odd}\` scales a token inside \`${math}\``,
          `That multiplier decides a size rather than doing arithmetic. ${TOKENISE}`,
        );
      }
    }
    // The lookbehind excludes a number that is part of an identifier or a hex colour, but NOT one
    // opening a function argument: `filter: brightness(1.06)` is a design value like any other.
    const outsideMath = bare.replace(MATH, " \u00a7 ");
    const number = outsideMath.match(NUMBERS)?.filter((n) => Number(n) !== 0);
    if (number?.length && !/^\s*[§\s]*$/.test(bare) && prop !== "transform") {
      // transform's numbers are geometry (translate/scale factors), not design values.
      return say(`\`${number[0]}\` is an unnamed number`, TOKENISE);
    }
  }
}

function dimensionKind(unit) {
  const u = unit.toLowerCase();
  if (u === "ms" || u === "s") return "duration";
  if (["deg", "rad", "grad", "turn"].includes(u)) return "angle";
  return "length";
}

// ------------------------------------------------------------------ rules A + C over the theme
// The entry itself is scanned too: it is a file someone can write a declaration into.
let imported = [];
try {
  imported = await themeFiles();
} catch (e) {
  for (const problem of e.problems ?? [e.message]) errors.push(problem);
}
const componentFiles = [THEME_ENTRY, ...imported].filter((f) => f !== TOKENS_CSS);
for (const file of componentFiles) {
  const css = await readFile(file, "utf8");
  const root = postcss.parse(css, { from: file });
  root.walkDecls((decl) => {
    checkVarsResolve(read(decl.value), file, decl.source.start.line);
    checkRawValues(decl, file);
    if (read(decl.prop, { lower: true }).startsWith("--folia-")) {
      checkTokenOverride(decl, file, decl.parent.selector ?? "");
    }
  });
  root.walkAtRules((at) => {
    if (at.params) checkVarsResolve(at.params, file, at.source.start.line);
    // A prelude is a design decision too: `@media (min-width: 700px)` is a raw length deciding
    // where the layout changes, and nothing above reads it because it is not a declaration.
    if (/^(media|container|supports)$/.test(at.name) && at.params) {
      const bare = stripVars(at.params);
      const dim = bare.match(DIMENSION);
      if (dim) {
        fail(
          `${file}:${at.source.start.line}`,
          `\`@${at.name} ${at.params}\` — ${dim[0]} is a raw ${dimensionKind(dim[1])} in the prelude. A breakpoint is a design value like any other; name it in ${TOKENS_CSS} and read it here.`,
        );
      }
    }
    // `@property` re-declares a custom property's type, inheritance and initial value. Pointed at a
    // token it can stop that token reaching any descendant, which changes what every rule reading
    // it renders — from a file that declares no rule at all. Nothing in the bundle needs it, and a
    // comparison of declarations cannot see it, so it does not get to be here quietly.
    if (at.name === "property" && at.params.trim().startsWith("--folia-")) {
      fail(
        `${file}:${at.source.start.line}`,
        `\`@property ${at.params}\` redefines a token's inheritance and initial value from outside the token block, which changes what every rule reading it renders while looking like nothing at all. ${TOKENS_CSS} is where a token is defined.`,
      );
    }
  });
}
// Inside the token block a --folia-* fallback would be a second value for the same token, so it is
// rejected there too; the raw values themselves are what tokens.css exists to hold.
tokensRoot.walkDecls((decl) => checkVarsResolve(decl.value, TOKENS_CSS, decl.source.start.line));
tokensRoot.walkDecls((decl) => {
  if (decl.prop.startsWith("--folia-")) return;
  checkRawValues(decl, TOKENS_CSS);
});

// ------------------------------------------------------------------ the token metadata
function collect(node, path, out) {
  if (node === null || typeof node !== "object") return out;
  if (Object.prototype.hasOwnProperty.call(node, "$value")) {
    out.push({ path, node });
    return out;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    collect(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const tokens = [];
for (const file of (await readdir(TOKENS_JSON_DIR)).filter((f) => f.endsWith(".tokens.json"))) {
  const path = join(TOKENS_JSON_DIR, file);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    fail(path, `invalid JSON: ${e.message}`);
    continue;
  }
  for (const t of collect(parsed, "", [])) tokens.push({ file: path, ...t });
}

// ------------------------------------------------------------------ rule E's candidate families
//
// A value is only asked to become an alias where the variable it would alias means the same thing.
// Layout lengths follow the host grid, and controls follow its cursor convention.
// The --layer-* scale stays excluded: in-board stacking contexts are not app overlays.
const FAMILIES = {
  radius: /^--radius-/,
  cursor: /^--cursor(?:-link)?$/,
  icon: /^--icon-(?:xs|s|m|l|xl)(?:-stroke-width)?$/,
  length: /^--size-\d+-\d+$/,
  "border-width": /^--border-width$/,
  "font-size": /^--font-ui-/,
  "font-weight": /^--font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  "line-height": /^--line-height-/,
};

/** The categories a token may be filed under; anything else is a filing mistake, not a new family. */
const CATEGORIES = new Set([
  "border",
  "color",
  "cursor",
  "icon",
  "motion",
  "opacity",
  "radius",
  "runtime",
  "shadow",
  "size",
  "spacing",
  "typography",
  "zindex",
]);

/**
 * Which families a token's value is measured against, in order.
 *
 * The category file says what kind of thing the token is; the VALUE says which scale it could be
 * on. Neither is the key's spelling, deliberately: a rule that reads the key would answer
 * differently for two identical values in one file depending on what someone called them, which is
 * not a rule, it is a filing habit.
 *
 * A plain length falls through to Obsidian's `--size-*` grid wherever no narrower scale claims it,
 * because the spacing page says that grid is for "spacing and dimensions properties" — so a bare
 * length with no better home still has to answer for itself. Typography never falls through: a
 * 16px font size is not a 16px margin, whatever the two numbers have in common. A token that
 * genuinely must not follow the grid keeps `owned` and says `"despite"`.
 */
function familiesOf(token) {
  const category = basename(token.file).replace(".tokens.json", "");
  const value = token.node.$value;
  const isLength = new RegExp(
    String.raw`^` + NUMBER + String.raw`(px|em|rem|vh|vw|vmin|vmax)$`,
  ).test(value);
  const isNumber = new RegExp(String.raw`^` + NUMBER + String.raw`$`).test(value);
  // A bare number is measured against the two host scales made of bare numbers, whatever file it
  // sits in: a font weight filed under opacity is still a font weight. (`--layer-*` is the third
  // such scale and is deliberately absent — the note in tokens.css says why.)
  if (category === "icon") return ["icon"];
  if (category === "cursor") return ["cursor"];
  if (isNumber) return ["font-weight", "line-height"];
  if (!isLength) return [];
  // Typography never falls through to the grid: a 16px font size is not a 16px margin, whatever
  // the two numbers have in common.
  if (category === "typography") return ["font-size"];
  if (category === "radius") return ["radius", "length"];
  if (category === "border") return ["border-width", "length"];
  return ["length"];
}

const defaultsBy = new Map(
  Object.keys(FAMILIES).map((name) => [
    name,
    Object.entries(registry).filter(([n, v]) => FAMILIES[name].test(n) && v.default !== undefined),
  ]),
);

const variants = [];
for (const token of tokens) {
  if (token.node.themes === undefined) continue;
  if (
    !token.node.themes ||
    typeof token.node.themes !== "object" ||
    Array.isArray(token.node.themes)
  ) {
    fail(token.file, `${token.path}.themes must be an object keyed by light or dark.`);
    continue;
  }
  for (const [theme, variant] of Object.entries(token.node.themes)) {
    if (
      !themed.has(theme) ||
      !variant ||
      typeof variant !== "object" ||
      Object.keys(variant).some((key) => !["$value", "source"].includes(key))
    ) {
      fail(
        token.file,
        `${token.path}.themes.${theme} must contain only $value and source for light or dark.`,
      );
      continue;
    }
    variants.push({
      ...token,
      theme,
      path: `${token.path}.themes.${theme}`,
      node: { ...variant, cssVar: token.node.cssVar },
    });
  }
}

// ------------------------------------------------------------------ rules D + E + F
const columnTokens = [];
const backed = new Set();

for (const t of [...tokens, ...variants]) {
  const { file, path, node } = t;
  const at = `${file} (${path})`;
  if (/(^|\.)column\.\d+$/.test(path)) {
    columnTokens.push(t);
    if (node.cssVar)
      fail(
        at,
        "a column colour is checked against columnColors.ts, not declared as a CSS variable — drop its cssVar.",
      );
    continue;
  }
  const cssVar = node.cssVar;
  if (!cssVar) {
    fail(
      at,
      `no "cssVar" — every token outside color.column.* names the --folia-* declaration it describes.`,
    );
    continue;
  }
  if (!CATEGORIES.has(basename(file).replace(".tokens.json", ""))) {
    fail(
      at,
      `${basename(file)} is not one of the token categories (${[...CATEGORIES].join(", ")}). The category decides which host scale a value is measured against, so a new file is a new rule and has to be taught to the guard, not just created.`,
    );
  }
  const backingKey = t.theme ? `${t.theme}:${cssVar}` : cssVar;
  if (backed.has(backingKey)) {
    fail(
      at,
      `${cssVar} already has metadata elsewhere in ${TOKENS_JSON_DIR}. Two entries for one token means two reasons and two categories for the same value, and only one of them is being read.`,
    );
  }
  backed.add(backingKey);
  const source = node.source;
  const isAlias = typeof source?.alias === "string";
  const isOwned = source?.owned === true;
  if (isAlias === isOwned) {
    fail(
      at,
      `"source" must be either { "alias": "--some-host-variable" } or { "owned": true, "reason": "…" }.`,
    );
    continue;
  }
  const decl = (t.theme ? themed.get(t.theme) : declared).get(cssVar);
  if (!decl) {
    fail(
      at,
      `expects ${cssVar} in the ${t.theme ? `.theme-${t.theme} .folia-scope` : ".folia-scope"} block of ${TOKENS_CSS}, but it is not declared there.`,
    );
    continue;
  }
  if (decl.value !== node.$value) {
    fail(
      `${TOKENS_CSS}:${decl.line}`,
      `${cssVar} is ${JSON.stringify(decl.value)} but ${path} in ${file} says ${JSON.stringify(node.$value)} — one of the two is stale.`,
    );
    continue;
  }

  if (isAlias) {
    if (!hostKnows(source.alias)) {
      fail(
        at,
        `aliases ${source.alias}, which Obsidian does not document — record it in ${join(HOST_DIR, "observed.json")} or alias a documented variable.`,
      );
    }
    // A fallback does not stop a token being an alias — it is still that variable the board reads —
    // so the relationship stays recorded and the fallback is declared beside it. What the fallback
    // costs is that it can never be seen to fire, so it is asked to say what it is for, and to
    // agree with the documented default where there is one to agree with.
    const fallback = source.fallback;
    if (fallback === undefined) {
      if (decl.value !== `var(${source.alias})`) {
        fail(
          `${TOKENS_CSS}:${decl.line}`,
          `${cssVar} claims to alias ${source.alias} with nothing behind it, so its value must be exactly \`var(${source.alias})\`. If the fallback is deliberate, record it: "source": { "alias": "${source.alias}", "fallback": { "value": "…", "reason": "…" } }.`,
        );
      }
    } else {
      if (typeof fallback.value !== "string" || fallback.value.trim() === "") {
        fail(at, `declares a fallback with no "value".`);
      } else if (decl.value !== `var(${source.alias}, ${fallback.value})`) {
        fail(
          `${TOKENS_CSS}:${decl.line}`,
          `${cssVar} is ${JSON.stringify(decl.value)} but its metadata declares the fallback ${JSON.stringify(fallback.value)} — the CSS must read exactly \`var(${source.alias}, ${fallback.value})\`, or a reader is told one thing and the browser another.`,
        );
      }
      if (typeof fallback.reason !== "string" || fallback.reason.trim() === "") {
        fail(
          at,
          `declares a fallback with no "reason". A fallback is the branch nothing can observe — it only ever runs where the variable is missing — so the argument for it has to be written down or it cannot be reviewed at all.`,
        );
      }
      const documented = registry[source.alias]?.default;
      if (typeof documented === "string" && fallback.value !== documented) {
        fail(
          at,
          `falls back to ${JSON.stringify(fallback.value)} where Obsidian documents ${source.alias} as ${JSON.stringify(documented)}. A fallback is what the board renders when the app does not define the variable, so a value that disagrees with the documentation is a second opinion nobody chose. (A colour whose default differs between light and dark is recorded as an object and is exempt — there is no single value to agree with.)`,
        );
      }
    }
    continue;
  }

  if (!source.reason || typeof source.reason !== "string" || source.reason.trim() === "") {
    fail(at, `is owned, so it needs a non-empty "reason" saying what Obsidian has no answer for.`);
  }
  // An owned token may not BE a host variable, with or without something behind it: either shape
  // is the board reading that variable, which is the relationship this layer exists to show.
  const reads = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]+?)\s*)?\)$/i.exec(decl.value);
  if (reads && hostKnows(reads[1])) {
    fail(
      `${TOKENS_CSS}:${decl.line}`,
      reads[2] === undefined
        ? `${cssVar} is exactly \`var(${reads[1]})\`, which is an alias, not an owned value — say so with "source": { "alias": "${reads[1]}" }.`
        : `${cssVar} reads ${reads[1]} with a fallback behind it, which is still an alias — say so with "source": { "alias": "${reads[1]}", "fallback": { "value": "${reads[2]}", "reason": "…" } }, so the relationship is recorded and the fallback carries its argument.`,
    );
  }

  // Rule E
  const match = familiesOf(t)
    .flatMap((family) => defaultsBy.get(family))
    .find(([, entry]) => entry.default === node.$value);
  if (match && source.despite !== match[0]) {
    fail(
      `${TOKENS_CSS}:${decl.line}`,
      `${cssVar} owns ${node.$value}, which is exactly what Obsidian documents ${match[0]} as. Alias it: \`${cssVar}: var(${match[0]});\` with "source": { "alias": "${match[0]}" }. If the two only happen to be the same number and must not move together, keep it owned and say so: add "despite": "${match[0]}" and let the reason carry the argument.`,
    );
  }
  const category = basename(file).replace(".tokens.json", "");
  const layoutLength =
    ["spacing", "size", "runtime"].includes(category) &&
    new RegExp(`^${NUMBER}px$`, "i").test(node.$value);
  const nearestGrid =
    layoutLength &&
    defaultsBy
      .get("length")
      .reduce((nearest, candidate) =>
        Math.abs(parseFloat(candidate[1].default) - Math.abs(Number(node.$value.slice(0, -2)))) <
        Math.abs(parseFloat(nearest[1].default) - Math.abs(Number(node.$value.slice(0, -2))))
          ? candidate
          : nearest,
      );
  if (layoutLength && !match && source.despite !== nearestGrid[0]) {
    fail(
      at,
      `${cssVar} owns a layout length outside the host grid. Use a --size-* alias or arithmetic on the grid; an intentional exception needs "despite": "${nearestGrid[0]}" and a reason.`,
    );
  }
  if (
    source.despite !== undefined &&
    !match &&
    (!layoutLength || source.despite !== nearestGrid[0])
  ) {
    fail(
      at,
      `carries "despite": ${JSON.stringify(source.despite)}, but ${node.$value} is not what Obsidian documents that variable as any more. Drop the escape, or re-argue it against whatever the registry says now.`,
    );
  }
}

for (const [theme, declarations] of [[null, declared], ...themed]) {
  for (const [cssVar, decl] of declarations) {
    if (!backed.has(theme ? `${theme}:${cssVar}` : cssVar)) {
      fail(
        `${TOKENS_CSS}:${decl.line}`,
        `${cssVar}${theme ? ` (${theme})` : ""} has no metadata in ${TOKENS_JSON_DIR}.`,
      );
    }
  }
}

// Rule F — the column palette against its JavaScript source of truth.
{
  const hexes = columnTokens
    .sort((a, b) => Number(a.path.split(".").at(-1)) - Number(b.path.split(".").at(-1)))
    .map(({ node }) => node.$value);
  const src = await readFile(COLUMN_COLORS, "utf8");
  const array = /COLUMN_COLORS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!array) {
    fail(COLUMN_COLORS, "could not find the COLUMN_COLORS array.");
  } else {
    const code = [...array[1].matchAll(/["'`](#[0-9a-fA-F]{3,8})["'`]/g)].map((m) => m[1]);
    if (hexes.length !== code.length) {
      fail("color.column", `${hexes.length} tokens vs ${code.length} COLUMN_COLORS entries.`);
    } else {
      hexes.forEach((hex, i) => {
        if (hex !== code[i])
          fail(`color.column.${i + 1}`, `token ${hex} vs COLUMN_COLORS ${code[i]}.`);
      });
    }
  }
}

// ------------------------------------------------------------------------ report
if (errors.length) {
  console.error(`check-theme: FAIL (${errors.length})`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
const aliases = tokens.filter((t) => typeof t.node.source?.alias === "string").length;
const owned = tokens.filter((t) => t.node.source?.owned === true).length;
console.log(
  `check-theme: OK (${declared.size} tokens: ${aliases} aliases of host variables, ${owned} owned; ` +
    `${Object.keys(observed).length} observed host variable(s); ${columnTokens.length} column colours)`,
);
