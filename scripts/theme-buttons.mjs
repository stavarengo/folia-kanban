import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postcss from "postcss";
import ts from "typescript";

// Unknown expressions cannot supply the stable base class a button needs. Conditional branches
// stay separate so a styled branch cannot hide an unstyled one.
function classValues(node) {
  if (!node) return [""];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isJsxExpression(node)) return classValues(node.expression);
  if (ts.isParenthesizedExpression(node)) return classValues(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...classValues(node.whenTrue), ...classValues(node.whenFalse)];
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return classValues(node.left).flatMap((a) => classValues(node.right).map((b) => a + b));
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (values, span) =>
        values.flatMap((a) => classValues(span.expression).map((b) => a + b + span.literal.text)),
      [node.head.text],
    );
  }
  return ["?"];
}

function subject(selector) {
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(char)) start = i + 1;
  }
  return selector.slice(start);
}

export async function checkButtons(roots, fail) {
  const buttons = [];
  const families = new Set();
  for (const file of (await readdir("src/ui", { recursive: true })).filter((f) =>
    f.endsWith(".tsx"),
  )) {
    const path = join("src/ui", file);
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === "button"
      ) {
        const attr = node.attributes.properties.find(
          (p) => ts.isJsxAttribute(p) && p.name.getText(source) === "className",
        );
        for (const value of classValues(attr?.initializer)) {
          for (const part of value.split(/\s+/)) {
            if (/^folia-[\w-]+\?$/.test(part)) families.add(part.slice(0, -1));
          }
          const classes = value.split(/\s+/).filter((c) => /^folia-[\w-]+$/.test(c));
          const where = `${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
          if (!classes.length)
            fail(
              where,
              "Every button branch needs a static folia-* base class with a scoped face rule.",
            );
          buttons.push({ classes, where });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  if (!buttons.length)
    fail("src/ui", "Button guard found no JSX buttons; check the source location.");
  const names = new Set(buttons.flatMap((b) => b.classes));
  const bases = [];
  for (const root of roots)
    root.walkRules((rule) => {
      const face = new Set(
        rule.nodes
          .filter((n) => n.type === "decl")
          .map((d) => (d.prop === "background-color" ? "background" : d.prop))
          .filter((p) => ["background", "color", "box-shadow"].includes(p)),
      );
      for (const selector of postcss.list.comma(rule.selector)) {
        const own = subject(selector);
        const classes = [...own.matchAll(/\.(folia-[\w-]+)/g)].map((m) => m[1]);
        const where = `${root.source.input.file}:${rule.source.start.line}`;
        if (/^button(?:\W|$)/.test(own) && !classes.length)
          fail(
            where,
            "Select Folia buttons by their own class, not a bare button that reaches rendered Markdown.",
          );
        if (
          !classes.some(
            (c) => names.has(c) || [...families].some((family) => c.startsWith(family)),
          ) ||
          !face.size
        )
          continue;
        if (!/^\.folia-scope\s+/.test(selector) || !/^\.folia-[\w-]+/.test(own)) {
          fail(
            where,
            `Button face rule \`${selector}\` needs .folia-scope and a direct Folia subject class to beat the host face.`,
          );
        }
        const match = /^\.folia-scope\s+((?:\.[\w-]+)+)$/.exec(selector);
        if (match) bases.push({ classes: match[1].slice(1).split("."), face });
      }
    });
  // These raised controls deliberately inherit the host shadow. Every flat control must say so
  // in its own resting rule; a state-only reset does not cover the resting face.
  const hostShadow = new Set(["folia-btn", "folia-filter-chip", "folia-column-add"]);
  for (const button of buttons) {
    const covered = new Set();
    for (const base of bases)
      if (base.classes.every((c) => button.classes.includes(c))) {
        for (const prop of base.face) covered.add(prop);
      }
    if (button.classes.some((c) => hostShadow.has(c))) covered.add("box-shadow");
    const missing = ["background", "color", "box-shadow"].filter((p) => !covered.has(p));
    if (missing.length)
      fail(
        button.where,
        `Button ${button.classes.join(" ")} needs a scoped resting rule for ${missing.join(", ")}.`,
      );
  }
}
