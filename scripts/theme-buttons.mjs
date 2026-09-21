import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import ts from "typescript";

// Unknown expressions cannot supply the stable base class a button needs. Conditional branches
// stay separate so a styled branch cannot hide an unstyled one.
function classValues(node, literalReturns) {
  if (!node) return [""];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isJsxExpression(node)) return classValues(node.expression, literalReturns);
  if (ts.isParenthesizedExpression(node)) return classValues(node.expression, literalReturns);
  if (ts.isConditionalExpression(node)) {
    return [
      ...classValues(node.whenTrue, literalReturns),
      ...classValues(node.whenFalse, literalReturns),
    ];
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return classValues(node.left, literalReturns).flatMap((a) =>
      classValues(node.right, literalReturns).map((b) => a + b),
    );
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
    return literalReturns.get(node.expression.text) ?? ["?"];
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (values, span) =>
        values.flatMap((a) =>
          classValues(span.expression, literalReturns).map((b) => a + b + span.literal.text),
        ),
      [node.head.text],
    );
  }
  return ["?"];
}

// Only a class on the subject itself restricts every branch of :is() / :where().
function subjectNodes(selector) {
  const nodes = selector.nodes;
  const lastCombinator = nodes.findLastIndex((node) => node.type === "combinator");
  return nodes.slice(lastCombinator + 1);
}

function hasButtonSubject(nodes) {
  return nodes.some((node) => {
    if (node.type === "tag") return node.value.toLowerCase() === "button";
    if (node.type !== "pseudo" || ![":is", ":where", ":matches"].includes(node.value.toLowerCase()))
      return false;
    return node.nodes.some((branch) => hasButtonSubject(subjectNodes(branch)));
  });
}

export async function checkButtons(roots, fail) {
  // This declared finite return type supplies the dynamic priority face. Typecheck enforces the
  // function's implementation; the guard checks every tone, including the muted fallback.
  const cardView = ts.createSourceFile(
    "cardView.ts",
    await readFile("src/ui/cardView.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const toneType = cardView.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === "ChipTone",
  )?.type;
  const priorityReturn = cardView.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "priorityTone",
  )?.type;
  const tones = toneType && ts.isUnionTypeNode(toneType) ? toneType.types : [];
  const literalReturns = new Map();
  if (
    priorityReturn?.getText(cardView) !== "ChipTone" ||
    !tones.length ||
    tones.some((node) => !ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal))
  )
    fail(
      "src/ui/cardView.ts",
      "priorityTone must declare the finite ChipTone string union for button face coverage.",
    );
  else
    literalReturns.set(
      "priorityTone",
      tones.map((node) => node.literal.text),
    );
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
        for (const value of classValues(attr?.initializer, new Map()))
          for (const part of value.split(/\s+/))
            if (/^folia-[\w-]+\?$/.test(part)) families.add(part.slice(0, -1));
        for (const value of classValues(attr?.initializer, literalReturns)) {
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
  const orderedSelectors = [];
  const unconditionalRules = new Map();
  for (const root of roots)
    root.walkRules((rule) => {
      const face = new Set(
        rule.nodes
          .filter((n) => n.type === "decl")
          .map((d) => (d.prop === "background-color" ? "background" : d.prop))
          .filter((p) => ["background", "color", "box-shadow"].includes(p)),
      );
      for (const selector of postcss.list.comma(rule.selector)) {
        orderedSelectors.push(selector);
        if (rule.parent.type === "root") {
          const declarations = unconditionalRules.get(selector) ?? new Map();
          for (const node of rule.nodes)
            if (node.type === "decl") declarations.set(node.prop, node.value);
          unconditionalRules.set(selector, declarations);
        }
        const nodes = subjectNodes(selectorParser().astSync(selector).first);
        const own = nodes.map((node) => node.toString()).join("");
        const classes = [];
        for (const node of nodes) {
          if (node.type === "class") classes.push(node.value);
          node.walkClasses?.((child) => classes.push(child.value));
        }
        const hasDirectClass = nodes.some(
          (node) => node.type === "class" && node.value.startsWith("folia-"),
        );
        const where = `${root.source.input.file}:${rule.source.start.line}`;
        if (hasButtonSubject(nodes) && !hasDirectClass)
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
        if (match && rule.parent.type === "root")
          bases.push({ classes: match[1].slice(1).split("."), face });
      }
    });
  // These equal-specificity hover colours must follow the shared icon hover face.
  const iconHover = ".folia-scope .folia-icon-btn:hover:where(:not(:disabled))";
  for (const action of ["done", "delete"]) {
    const refinement = `.folia-scope .folia-action-${action}:hover:where(:not(:disabled))`;
    if (
      orderedSelectors.lastIndexOf(iconHover) < 0 ||
      orderedSelectors.lastIndexOf(refinement) <= orderedSelectors.lastIndexOf(iconHover)
    )
      fail("src/theme/index.css", `${refinement} must follow the base icon hover rule.`);
  }
  // Pin the two owned signals and their consumers, not arbitrary state interactions.
  const requireSignal = (selector, property, value) => {
    if (unconditionalRules.get(selector)?.get(property) !== value)
      fail("src/theme", `Button signal ${selector} needs ${property}: ${value}.`);
  };
  const pointerClasses = [
    "folia-btn",
    "folia-filter-chip",
    "folia-add-column",
    "folia-column-add",
    "folia-menu-item",
    "folia-filter-suggest-item",
    "folia-menu-column",
    "folia-menu-prio",
  ];
  for (const name of pointerClasses) {
    for (const state of ["hover", "active"]) {
      const excluded =
        name === "folia-add-column"
          ? ":disabled, :focus-visible, .is-editing"
          : ":disabled, :focus-visible";
      const selector = `.folia-scope .${name}:${state}:where(:not(${excluded}))`;
      requireSignal(selector, "outline", "var(--folia-control-outline)");
      // Pressed differs from hovered in where the ring sits as well as how thick it is, and both
      // offsets are negative so the ring always paints on the control's own face, where its
      // currentColor is answerable to the label's contrast rather than to the surface behind.
      requireSignal(
        selector,
        "outline-offset",
        state === "active"
          ? "calc(-1 * 2 * var(--folia-border-width-thick))"
          : "calc(-1 * var(--folia-border-width-thick))",
      );
      if (state === "active")
        requireSignal(selector, "outline-width", "var(--folia-border-width-thick)");
    }
  }
  requireSignal(
    ".folia-scope .folia-filter-suggest-item.is-active",
    "box-shadow",
    "var(--folia-suggestion-marker)",
  );
  const signalTokens = new Map([
    ["--folia-control-outline", "1px solid currentColor"],
    ["--folia-border-width-thick", "2px"],
    ["--folia-suggestion-marker", "inset var(--folia-border-width-thick) 0 0 var(--text-normal)"],
  ]);
  const tokens = postcss.parse(await readFile("src/theme/tokens.css", "utf8"));
  tokens.walkDecls((decl) => {
    if (signalTokens.has(decl.prop) && decl.value !== signalTokens.get(decl.prop))
      fail(
        "src/theme/tokens.css",
        `Owned button signal ${decl.prop} must retain ${signalTokens.get(decl.prop)}.`,
      );
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
