#!/usr/bin/env node
// The one guard over src/theme. It replaces the old tokens:check bijection and the raw-value
// ratchet with a rule the ratchet could never state: the --folia-* layer is a TRANSLATION of
// Obsidian's design foundations, so every token is either an alias of a variable Obsidian
// documents or an owned value that says in writing why Obsidian has no answer for it.
//
//   A  every var(--x) resolves — a --folia-* token, a documented host variable, or an observed one
//   B  src/theme/host/observed.json is the only home for a host variable the docs do not list
//   C  no raw design value outside src/theme/tokens.css
//   D  src/theme/tokens.css and src/theme/tokens/*.tokens.json describe the same set of tokens
//   E  an owned token whose value is already a documented default must alias that variable
//   F  the eight column hexes match src/ui/columnColors.ts
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
  if (!entry?.observedIn || !entry?.where) {
    fail(
      join(HOST_DIR, "observed.json"),
      `${name} needs both "observedIn" (the Obsidian version it was seen in) and "where" (where it was seen), so a later reader can re-check it.`,
    );
  }
}

const hostKnows = (name) => name in registry || name in observed;

// ------------------------------------------------------------------ the token block
const tokensCss = await readFile(TOKENS_CSS, "utf8");
const tokensRoot = postcss.parse(tokensCss, { from: TOKENS_CSS });

/** name → { value, line } for every --folia-* declared in the one .folia-scope rule. */
const declared = new Map();
{
  const scopes = [];
  tokensRoot.walkRules((rule) => {
    if (rule.selector.trim() === ".folia-scope") scopes.push(rule);
  });
  if (scopes.length !== 1) {
    fail(
      TOKENS_CSS,
      `${scopes.length} \`.folia-scope { … }\` rules; the token block must be the only one, or a declaration could hide in the second.`,
    );
  }
  for (const rule of scopes) {
    rule.walkDecls((d) => {
      if (!d.prop.startsWith("--folia-")) return;
      declared.set(d.prop, { value: d.value.trim(), line: d.source.start.line });
    });
  }
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
const DIMENSION =
  /(?<![\w.#-])-?\d*\.?\d+(px|em|rem|ex|ch|cap|ic|lh|rlh|vh|vw|vmin|vmax|[dsl]v(?:h|w|min|max|i|b)|cq[whibx]|cqmin|cqmax|cm|mm|in|pt|pc|q|ms|s|deg|rad|grad|turn)(?![\w%-])/i;
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

/** Walk the top-level var() calls of a value, yielding [name, fallbackText|null]. */
function* varCalls(value) {
  for (let i = 0; i < value.length; i++) {
    if (!value.startsWith("var(", i)) continue;
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

/** The value with every var() call replaced by a neutral placeholder, fallbacks included. */
function stripVars(value) {
  let out = "";
  let last = 0;
  for (const [, , start, end] of varCalls(value)) {
    out += value.slice(last, start) + " § ";
    last = end + 1;
  }
  return out + value.slice(last);
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
function checkRawValues(decl, where) {
  const line = decl.source.start.line;
  const prop = decl.prop;
  const bare = stripVars(decl.value);
  const say = (what, advice) =>
    fail(`${where}:${line}`, `\`${prop}: ${decl.value}\` — ${what}. ${advice}`);
  const TOKENISE = `Move the value into ${TOKENS_CSS} as a token named for what it is FOR, and read it here through var().`;

  if (prop.startsWith("--")) {
    // A component rule may RE-declare a token (the urgency cue swaps its colour per due state), but
    // it may not invent one: a name with no entry in the block is a token nobody can find.
    if (where !== TOKENS_CSS && !declared.has(prop)) {
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
  if (prop === "font-family" && !/^[\s\u00a7]*$/.test(bare)) {
    return say("a font stack is written out here", TOKENISE);
  }
  if (prop === "cursor" && !/^\s*§\s*$/.test(bare)) {
    return say(
      `\`${decl.value}\` is a cursor keyword`,
      `${TOKENISE} (Obsidian's own convention lives in --cursor and --cursor-link; which of Folia's controls follow it is a later decision, but the keyword still belongs in the token block.)`,
    );
  }
  if (NUMERIC_PROPS.has(prop)) {
    const number = bare.match(/(?<![\w.#-])-?\d*\.?\d+(?![\w.%-])/);
    // 0 and 1 on opacity are the ends of a fade, an animation state rather than a design value.
    const endpoint = prop === "opacity" && /^(0|1)$/.test(number?.[0] ?? "");
    if (number && !endpoint) return say(`${prop} is written as a number`, TOKENISE);
  }
  if (!NUMERIC_PROPS.has(prop) && !UNITLESS_OK.has(prop)) {
    // A bare number outside the properties above is almost always a length that lost its unit or a
    // value that should be named; `0` is the one that never carries design intent.
    // A number inside calc()/min()/max()/clamp() is arithmetic on values that are already tokens —
    // a multiplier, not a design value — and the raw-length scan above has already judged the
    // lengths in there.
    const outsideMath = bare.replace(
      /\b(?:calc|min|max|clamp)\([^()]*(?:\([^()]*\)[^()]*)*\)/g,
      " \u00a7 ",
    );
    const number = outsideMath
      .match(/(?<![\w.#(-])-?\d*\.?\d+(?![\w.%-])/g)
      ?.filter((n) => Number(n) !== 0);
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
const componentFiles = [THEME_ENTRY, ...(await themeFiles())].filter((f) => f !== TOKENS_CSS);
for (const file of componentFiles) {
  const css = await readFile(file, "utf8");
  const root = postcss.parse(css, { from: file });
  root.walkDecls((decl) => {
    checkVarsResolve(decl.value, file, decl.source.start.line);
    checkRawValues(decl, file);
  });
  root.walkAtRules((at) => {
    if (at.params) checkVarsResolve(at.params, file, at.source.start.line);
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
// The families below are the ones the owner's Phase 0 decision names: the 4px grid, the radius
// ladder, the UI font sizes, the weight scale, the line heights and the border width. Three
// families are deliberately absent, each because adopting it is a decision of its own and a later
// phase: the cursor pair (--cursor/--cursor-link — Obsidian's arrow-on-controls convention, audit
// 02-28), the icon sizes (audit 02-14) and the --layer-* scale, whose numbers collide with Folia's
// in-board rungs by coincidence and not by meaning (audit 02-25, and the note on those rungs in
// tokens.css). Aliasing any of them here would be a visual and semantic change wearing Phase 0's
// clothes.
const FAMILIES = {
  radius: /^--radius-/,
  length: /^--size-\d+-\d+$/,
  "border-width": /^--border-width$/,
  "font-size": /^--font-ui-/,
  "font-weight": /^--font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  "line-height": /^--line-height-/,
};

/** Which family a token's value should be measured against, from what the token is FOR. */
function familyOf(token) {
  const category = basename(token.file).replace(".tokens.json", "");
  if (category === "radius") return "radius";
  if (category === "border") return token.path.startsWith("width") ? "border-width" : null;
  if (category === "typography") {
    if (token.path.startsWith("weight")) return "font-weight";
    if (token.path.startsWith("line-height")) return "line-height";
    if (token.path.startsWith("font-size")) return "font-size";
    return null;
  }
  if (category === "spacing" || category === "size") return "length";
  return null;
}

const defaultsBy = new Map(
  Object.keys(FAMILIES).map((name) => [
    name,
    Object.entries(registry).filter(([n, v]) => FAMILIES[name].test(n) && v.default !== undefined),
  ]),
);

// ------------------------------------------------------------------ rules D + E + F
const columnTokens = [];
const backed = new Set();

for (const t of tokens) {
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
  backed.add(cssVar);
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
  const decl = declared.get(cssVar);
  if (!decl) {
    fail(
      at,
      `expects ${cssVar} in the .folia-scope block of ${TOKENS_CSS}, but it is not declared there.`,
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
    if (decl.value !== `var(${source.alias})`) {
      fail(
        `${TOKENS_CSS}:${decl.line}`,
        `${cssVar} claims to alias ${source.alias}, so its value must be exactly \`var(${source.alias})\` — a fallback or a second value makes it an owned token, which is fine as long as it says so.`,
      );
    }
    continue;
  }

  if (!source.reason || typeof source.reason !== "string" || source.reason.trim() === "") {
    fail(at, `is owned, so it needs a non-empty "reason" saying what Obsidian has no answer for.`);
  }
  const bareAlias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(decl.value);
  if (bareAlias && hostKnows(bareAlias[1])) {
    fail(
      `${TOKENS_CSS}:${decl.line}`,
      `${cssVar} is exactly \`var(${bareAlias[1]})\`, which is an alias, not an owned value — say so with "source": { "alias": "${bareAlias[1]}" }.`,
    );
  }

  // Rule E
  const family = familyOf(t);
  if (family) {
    for (const [name, entry] of defaultsBy.get(family)) {
      if (entry.default === node.$value) {
        fail(
          `${TOKENS_CSS}:${decl.line}`,
          `${cssVar} owns ${node.$value}, which is exactly what Obsidian documents ${name} as. Alias it: \`${cssVar}: var(${name});\` with "source": { "alias": "${name}" }.`,
        );
        break;
      }
    }
  }
}

for (const [cssVar, decl] of declared) {
  if (!backed.has(cssVar)) {
    fail(
      `${TOKENS_CSS}:${decl.line}`,
      `${cssVar} has no metadata in ${TOKENS_JSON_DIR} — a token without a recorded source is neither an alias nor an owned value, which is the one thing this layer does not allow.`,
    );
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
  `check-theme: OK (${declared.size} tokens: ${aliases} aliases of documented variables, ${owned} owned; ` +
    `${Object.keys(observed).length} observed host variable(s); ${columnTokens.length} column colours)`,
);
