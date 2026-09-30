#!/usr/bin/env node
// The one guard over src/theme. The board reads Obsidian's documented CSS variables directly, and
// keeps a short list of its own values in src/theme/tokens.css. This checks that it stays that way:
//
//   A  every var(--x) the board reads, in the theme or in its code, is either a documented host
//      variable on the allowlist (src/theme/host/variables.json) or a --folia-* name tokens.css
//      declares
//   B  tokens.css holds one .folia-scope block, plus light/dark overrides of names it declares;
//      each --folia-* name there carries a reason on its line or in the comment right above it, is
//      read somewhere, and does not lead back to itself. The names after the comment that opens with
//      "Channels:" are channels; a component rule or the board's code may write those and no other
//      --folia-* name, and a component never on .folia-scope itself
//   C  no raw colour outside tokens.css
//   D  the allowlist is exactly the set of host variables the board reads, and each is one that
//      Obsidian at manifest.json's minAppVersion declares (src/theme/host/floor.json)
//   G  JSX buttons have scoped resting faces; inherited raised shadows are explicit exceptions
//   H  no rule removes the outline on :focus; a transparent one survives forced-colours mode
//
// In the board's code, only a `var(--x)` written out literally is seen. A name built at runtime or
// spelt with escapes is not, which is why the column palette is read by calling `columnAccent`
// rather than by scanning it; a new place that builds a variable name needs the same.
//
// Lengths, durations, cursors and other literals are allowed in component files: a value used once
// is clearer where it is used. A value that several rules must share, or that the board decides for
// itself against a published default, is a named token with its reason in tokens.css.
//
// Run: pnpm theme:check

import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";
import { checkButtons } from "./theme-buttons.mjs";
import {
  FLOOR,
  HOST_VARIABLES,
  THEME_DIR,
  THEME_ENTRY,
  codeTokens,
  hostReads,
  parseDecoded,
  themeFiles,
  varCalls,
} from "./theme-bundle.mjs";

const TOKENS_CSS = join(THEME_DIR, "tokens.css");

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));

const registry = (await json(HOST_VARIABLES)).variables;
const floor = await json(FLOOR);
const { minAppVersion } = await json("manifest.json");

// ------------------------------------------------------------------ the token block (rule B)
const tokensRoot = parseDecoded(await readFile(TOKENS_CSS, "utf8"), TOKENS_CSS);
/** name -> { value, line, channel } for the base block. */
const declared = new Map();
/** Scheme selector -> Map(name -> value) for the overrides. */
const overrides = new Map();
const CHANNELS = /^\s*Channels:/;
const SCHEMES = [".theme-light .folia-scope", ".theme-dark .folia-scope"];
const seenRules = new Set();
for (const node of tokensRoot.nodes) {
  if (node.type === "comment") continue;
  const selector = node.type === "rule" ? node.selector.trim() : null;
  if (selector !== ".folia-scope" && !SCHEMES.includes(selector)) {
    fail(
      `${TOKENS_CSS}:${node.source.start.line}`,
      "Only a .folia-scope rule and its .theme-light/.theme-dark overrides belong in the token file.",
    );
    continue;
  }
  if (seenRules.has(selector)) {
    fail(`${TOKENS_CSS}:${node.source.start.line}`, `${selector} is declared twice.`);
  }
  seenRules.add(selector);
  let channels = false;
  node.each((decl) => {
    if (decl.type === "comment" && CHANNELS.test(decl.text)) channels = true;
    if (decl.type === "comment") return;
    if (decl.type !== "decl") {
      fail(
        `${TOKENS_CSS}:${decl.source.start.line}`,
        `${selector} may hold only declarations. A nested rule or at-rule would change a token where it applies without any of these checks reading it.`,
      );
      return;
    }
    const where = `${TOKENS_CSS}:${decl.source.start.line}`;
    if (selector === ".folia-scope") {
      if (!decl.prop.startsWith("--")) {
        if (decl.prop !== "font-size")
          fail(where, `${decl.prop} is not a token. Only the board's base font-size travels here.`);
        return;
      }
      if (!decl.prop.startsWith("--folia-")) {
        fail(where, `${decl.prop} is Obsidian's to set, not the board's.`);
        return;
      }
      if (declared.has(decl.prop)) fail(where, `${decl.prop} is declared twice.`);
      declared.set(decl.prop, {
        value: decl.value,
        line: decl.source.start.line,
        channel: channels,
      });
      if (!hasReason(decl)) {
        fail(
          where,
          `${decl.prop} needs its reason: a comment on the same line or right above it, saying what Obsidian publishes nothing for. The reasons are what make this list reviewable.`,
        );
      }
    } else if (!decl.prop.startsWith("--folia-")) {
      fail(where, `${selector} may only override tokens.`);
    } else {
      if (!overrides.has(selector)) overrides.set(selector, new Map());
      overrides.get(selector).set(decl.prop, decl.value);
    }
  });
}
if (!seenRules.has(".folia-scope")) fail(TOKENS_CSS, "Missing the .folia-scope block.");
for (const selector of SCHEMES) {
  tokensRoot.walkRules(selector, (rule) =>
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith("--folia-") && !declared.has(decl.prop))
        fail(
          `${TOKENS_CSS}:${decl.source.start.line}`,
          `${decl.prop} is overridden for one scheme but has no base value in .folia-scope.`,
        );
    }),
  );
}

// A token that leads back to itself is invalid at computed-value time, and so is every property
// reading it. Checked for the base block and for each scheme's view of it.
const tokenReads = (value) => {
  const names = [];
  const visit = (text) => {
    for (const [name, fallback] of varCalls(text)) {
      if (name.startsWith("--folia-")) names.push(name);
      if (fallback !== null) visit(fallback);
    }
  };
  visit(value);
  return names;
};
const schemes = [["base", new Map()], ...overrides];
/** The scheme under which `start`, declared as `startValue`, leads back to itself, or null. */
function cycleOf(start, startValue) {
  for (const [scheme, changed] of schemes) {
    const value = (name) => changed.get(name) ?? declared.get(name)?.value;
    const seen = new Set();
    const queue = tokenReads(startValue ?? value(start));
    while (queue.length) {
      const next = queue.shift();
      if (next === start) return scheme;
      if (seen.has(next) || value(next) === undefined) continue;
      seen.add(next);
      queue.push(...tokenReads(value(next)));
    }
  }
  return null;
}
for (const [name, { line }] of declared) {
  const scheme = cycleOf(name);
  if (scheme)
    fail(
      `${TOKENS_CSS}:${line}`,
      `${name} leads back to itself${scheme === "base" ? "" : ` under ${scheme}`}, which makes it, and every property reading it, invalid.`,
    );
}

/**
 * A reason is a comment trailing the declaration on its own line, or the comment right before it
 * (a comment that heads a group of declarations counts for the first one only).
 */
function hasReason(decl) {
  const next = decl.next();
  if (next?.type === "comment" && next.source.start.line === decl.source.end.line) return true;
  const prev = decl.prev();
  if (prev?.type !== "comment" || prev.source.end.line < decl.source.start.line - 1) return false;
  // A comment trailing the declaration above belongs to that one.
  const before = prev.prev();
  return !(before?.type === "decl" && before.source.end.line === prev.source.start.line);
}

// ------------------------------------------------------------------ rules A and C
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

/** The value with every var() name blanked out, fallbacks kept: a fallback is live CSS. */
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

/** Rule C: a colour belongs to the theme, so the board writes one only in tokens.css. */
function checkColour(value, where) {
  const bare = stripVars(value);
  const say = (what) =>
    fail(
      where,
      `\`${value}\` — ${what}. Read the host variable that means this colour, or, if Obsidian publishes none, declare a token in ${TOKENS_CSS} with its reason.`,
    );
  const hex = bare.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) return say(`${hex[0]} is a colour literal`);
  const fn = bare.match(COLOR_FUNCTIONS);
  if (fn) return say(`${fn[0]}…) is a colour literal`);
  for (const word of bare.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (NAMED_COLORS.has(word)) return say(`\`${word}\` is a named colour`);
  }
}

/** Rule A for the --folia-* half; the host half is rule D, over the whole read set. */
function checkTokenReads(value, where) {
  for (const [name, fallback] of varCalls(value)) {
    if (name.startsWith("--folia-")) {
      if (!declared.has(name)) {
        fail(
          where,
          `var(${name}) resolves to nothing: ${TOKENS_CSS} does not declare it. Read the host variable that means this, write the value where it is used, or declare the token with its reason.`,
        );
      } else if (fallback !== null && declared.get(name).value !== "initial") {
        fail(
          where,
          `var(${name}, ${fallback}) carries a fallback for a token that is always declared, so the fallback is dead text. (A channel declared \`initial\` is the exception: that one really can be absent.)`,
        );
      }
    }
    if (fallback !== null) checkTokenReads(fallback, where);
  }
}

let imported = [];
try {
  imported = await themeFiles();
} catch (e) {
  for (const problem of e.problems ?? [e.message]) errors.push(problem);
}
const componentFiles = [THEME_ENTRY, ...imported].filter((f) => f !== TOKENS_CSS);
const componentRoots = [];
/** Every name some rule reads. */
const read = new Set();
const noteReads = (value) => {
  for (const [name, fallback] of varCalls(value)) {
    read.add(name);
    if (fallback !== null) noteReads(fallback);
  }
};
for (const file of componentFiles) {
  const root = parseDecoded(await readFile(file, "utf8"), file);
  componentRoots.push(root);
  root.walkDecls((decl) => {
    const where = `${file}:${decl.source.start.line}`;
    checkTokenReads(decl.value, where);
    checkColour(decl.value, where);
    noteReads(decl.value);
    const prop = decl.prop.toLowerCase();
    if (!prop.startsWith("--")) return;
    if (prop === "--icon-size" || prop === "--icon-stroke") return; // .folia-icon maps its channel pair onto the host shorthands
    const selector = decl.parent.selector ?? "";
    if (!declared.get(prop)?.channel) {
      fail(
        where,
        `${prop} is declared here, but a component may only write one of the channels ${TOKENS_CSS} declares. Write the value where it is used, or, if it really is data this rule writes, declare it among the channels.`,
      );
    } else if (selector.split(",").some((s) => s.trim() === ".folia-scope")) {
      fail(where, `${prop} on .folia-scope re-declares the token block for everything below it.`);
    } else if (/\.theme-(?:light|dark)\b/.test(selector)) {
      fail(where, `A scheme override of ${prop} belongs in ${TOKENS_CSS}.`);
    }
    // Conservative: the rule may match an element that also carries the scope block.
    else if (cycleOf(prop, decl.value)) {
      fail(
        where,
        `${prop} leads back to itself here, which makes it invalid wherever this rule applies.`,
      );
    }
  });
  root.walkAtRules((at) => {
    if (at.params) checkTokenReads(at.params, `${file}:${at.source.start.line}`);
    if (at.name === "property" && at.params.trim().startsWith("--folia-")) {
      fail(
        `${file}:${at.source.start.line}`,
        `\`@property ${at.params}\` redefines a token's inheritance and initial value from outside ${TOKENS_CSS}.`,
      );
    }
  });
}
tokensRoot.walkDecls((decl) => {
  checkTokenReads(decl.value, `${TOKENS_CSS}:${decl.source.start.line}`);
  noteReads(decl.value);
});

// A token read by nothing is a decision nobody is making any more.
const codeReads = await codeTokens();
for (const [name, at] of codeReads) {
  if (!declared.get(name)?.channel) {
    fail(
      at,
      `${name} is ${declared.has(name) ? "one of the board's own values, not a channel" : `not declared in ${TOKENS_CSS}`}, so the code must not write or read it by name. A misspelt channel is written and never read.`,
    );
  }
}
for (const [name, { line }] of declared) {
  if (!read.has(name) && !codeReads.has(name)) {
    fail(`${TOKENS_CSS}:${line}`, `${name} is declared but nothing reads it. Delete it.`);
  }
}

// ------------------------------------------------------------------ rule D: the allowlist
const reads = await hostReads();
const minimum = floor.version;
if (minimum !== minAppVersion) {
  fail(
    FLOOR,
    `lists what Obsidian ${minimum} declares, but manifest.json admits ${minAppVersion}. Regenerate it for ${minAppVersion} (see src/theme/README.md).`,
  );
}
const declaredAtFloor = new Set(floor.variables);
for (const [name, where] of reads) {
  const at = where[0];
  const entry = registry[name];
  if (!entry) {
    fail(
      at,
      `var(${name}) is not on the allowlist. If Obsidian documents it, run \`pnpm theme:sync <docs checkout>\` to add it; if not, the board may not read it.`,
    );
  } else if (entry.scope === "publish") {
    fail(
      at,
      `var(${name}) is documented for Obsidian Publish (${entry.pages.join(", ")}), not for the app this plugin runs inside.`,
    );
  } else if (!declaredAtFloor.has(name)) {
    fail(
      at,
      `var(${name}) is documented, but Obsidian ${minimum}, the oldest version manifest.json admits, does not declare it, so there the property would quietly inherit. Raise minAppVersion or read something older.`,
    );
  }
}
for (const name of Object.keys(registry)) {
  if (!reads.has(name)) {
    fail(
      HOST_VARIABLES,
      `${name} is on the allowlist but nothing reads it. Run \`pnpm theme:sync <docs checkout>\` to regenerate the list.`,
    );
  }
}

await checkButtons(componentRoots, fail);

// ------------------------------------------------------------------ rule H
// A field that hides its outline on focus signals focus with its border and `--folia-ring`, and
// forced-colours mode drops every box-shadow and repaints every border in one system colour. A
// transparent outline draws nothing until that mode repaints it in a system colour, which
// `outline: none` never is, so none is refused on a focus selector. The declaration is what is
// read, not whether it wins the cascade.
const FOCUS = /:focus(?:-visible)?(?![\w-])/;
const noOutline = (rule) =>
  rule.nodes.some(
    (n) => n.type === "decl" && /^outline(-style)?$/i.test(n.prop) && /^(none|0)$/i.test(n.value),
  );
for (const root of componentRoots) {
  root.walkRules((rule) => {
    if (rule.parent.type !== "root" || !noOutline(rule)) return;
    for (const s of rule.selectors.map((s) => s.replace(/\s+/g, " ").trim())) {
      if (!FOCUS.test(s.replace(/:not\([^)]*\)/g, ""))) continue;
      fail(
        `${relative(".", root.source.input.from)}:${rule.source.start.line}`,
        `\`${s}\` removes the outline on focus. Forced-colours mode drops the box-shadow and flattens the border that replace it, so the field would show no focus at all. Write \`outline: var(--folia-focus-ring-w) solid transparent\` instead: it draws nothing itself and is repainted in a system colour when colours are forced.`,
      );
    }
  });
}

// ------------------------------------------------------------------------ report
if (errors.length) {
  console.error(`check-theme: FAIL (${errors.length})`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
const channels = [...declared.values()].filter((t) => t.channel).length;
console.log(
  `check-theme: OK (${reads.size} documented host variables read; ${declared.size - channels} owned values and ${channels} channels in tokens.css)`,
);
