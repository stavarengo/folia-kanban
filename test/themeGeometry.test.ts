import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

const entry = readFileSync("src/theme/index.css", "utf8");
const files = [...entry.matchAll(/@import "\.\/([^\"]+)"/g)].map((match) => match[1]);
const stylesheet = parse(files.map((file) => readFileSync(`src/theme/${file}`, "utf8")).join("\n"));
const declarations = (selector: string) => {
  const result: Record<string, string> = {};
  stylesheet.walkRules(selector, (rule) => {
    rule.walkDecls((decl) => {
      result[decl.prop] = decl.value;
    });
  });
  return result;
};

describe("icon geometry contract", () => {
  it.each([
    ".folia-menu-prio-none.folia-menu-prio-none",
    ".folia-menu-item.folia-menu-item",
    ".folia-chip",
    ".folia-filter-chip.folia-filter-chip",
    ".folia-mini.folia-mini",
    ".folia-swatch-none.folia-swatch-none",
    ".folia-column-count",
    ".folia-card-meta",
    ".folia-progress-label",
    ".folia-card-subitems-toggle.folia-card-subitems-toggle",
  ])("keeps compact icons at the matching extra-small size and stroke: %s", (selector) => {
    expect(declarations(selector)).toMatchObject({
      "--folia-icon-size": "var(--icon-xs)",
      "--folia-icon-stroke": "var(--icon-xs-stroke-width)",
    });
  });

  it("uses small defaults and a large empty-state illustration", () => {
    expect(declarations(".folia-scope")).toMatchObject({
      "--folia-icon-size": "var(--icon-s)",
      "--folia-icon-stroke": "var(--icon-s-stroke-width)",
    });
    expect(declarations(".folia-column-empty")).toMatchObject({
      "--folia-icon-size": "var(--icon-l)",
      "--folia-icon-stroke": "var(--icon-l-stroke-width)",
    });
  });

  it("assigns host icon shorthands only on Folia SVGs, never on Markdown ancestors", () => {
    const owners: string[] = [];
    stylesheet.walkRules((rule) => {
      rule.walkDecls(/^--icon-(size|stroke)$/, () => {
        owners.push(rule.selector);
      });
    });
    expect(owners).toEqual([".folia-icon", ".folia-icon"]);
    expect(declarations(".folia-icon")).toMatchObject({
      "--icon-size": "var(--folia-icon-size)",
      "--icon-stroke": "var(--folia-icon-stroke)",
      width: "var(--icon-size)",
      height: "var(--icon-size)",
      "stroke-width": "var(--icon-stroke)",
    });
  });
});

describe("composite dimensions", () => {
  it("keeps the drag overlay inset tied to both column borders and body paddings", () => {
    expect(declarations(".folia-column")["border"]).toContain("var(--folia-border-width)");
    expect(declarations(".folia-column-body")["padding"]).toBe("var(--folia-space-md)");
    expect(declarations(".folia-scope")["--folia-card-overlay-inset"]).toBe(
      "calc(2 * var(--folia-border-width) + 2 * var(--folia-space-md))",
    );
  });

  it("keeps small text independent of spacing and targets above their fixed floor", () => {
    const tokens = declarations(".folia-scope");
    expect(tokens["--folia-font-size-xxs"]).toBe("calc(var(--font-ui-smaller) * 5 / 6)");
    expect(tokens["--folia-font-size-xs"]).toBe("calc(var(--font-ui-smaller) * 11 / 12)");
    expect(tokens["--folia-hit-min"]).toBe("24px");
    expect(declarations(".folia-icon-btn.folia-icon-btn")).toMatchObject({
      "min-width": "var(--folia-hit-min)",
      "min-height": "var(--folia-hit-min)",
    });
    // The swatch holds the same floor, expressed once: its size follows the host colour input, and
    // Obsidian's 22px swatch is under the target, so the floor has to win rather than sit beside it.
    expect(declarations(".folia-swatch.folia-swatch")).toMatchObject({
      width: "max(var(--folia-hit-min), var(--swatch-width))",
      height: "max(var(--folia-hit-min), var(--swatch-height))",
    });
    for (const [name, step] of [
      ["sm", "2"],
      ["md", "1"],
    ]) {
      expect(tokens[`--folia-hit-${name}`]).toBe(
        `max(var(--folia-hit-min), calc(var(--input-height) - var(--size-4-${step})))`,
      );
    }
    expect(tokens["--folia-statusbar-clearance"]).toBe("32px");
  });
});
