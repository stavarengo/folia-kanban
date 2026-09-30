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
    ".folia-scope .folia-chip",
    ".folia-scope .folia-filter-chip",
    ".folia-scope .folia-mini",
    ".folia-column-count",
    ".folia-card-meta",
    ".folia-progress-label",
    ".folia-scope .folia-card-subitems-toggle",
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

  it("reserves a card title's clearance from the cluster's own step, one step less without Mark done", () => {
    const tokens = declarations(".folia-scope");
    const flat = (value: string | undefined) => value?.replace(/\s+/g, " ");
    expect(declarations(".folia-card-actions")).toMatchObject({
      top: "var(--folia-space-sm)",
      right: "var(--folia-space-sm)",
      gap: "var(--folia-space-hair)",
      padding: "var(--folia-space-xxs)",
    });
    expect(tokens["--folia-card-action-step"]).toBe(
      "calc(var(--folia-hit-md) + var(--folia-space-hair))",
    );
    expect(flat(tokens["--folia-card-actions-reach"])).toBe(
      "calc( var(--folia-space-sm) + 2 * var(--folia-space-xxs) + 3 * var(--folia-card-action-step) )",
    );
    expect(declarations(".folia-card-title")["padding-right"]).toBe(
      "calc(var(--folia-card-actions-reach) - var(--folia-card-pad-x))",
    );
    expect(flat(declarations(".folia-card--no-complete .folia-card-title")["padding-right"])).toBe(
      "calc( var(--folia-card-actions-reach) - var(--folia-card-action-step) - var(--folia-card-pad-x) )",
    );
  });

  it("keeps small text independent of spacing and targets above their fixed floor", () => {
    const tokens = declarations(".folia-scope");
    expect(tokens["--folia-font-size-xxs"]).toBe("calc(var(--font-ui-smaller) * 5 / 6)");
    expect(tokens["--folia-font-size-xs"]).toBe("calc(var(--font-ui-smaller) * 11 / 12)");
    expect(tokens["--folia-hit-min"]).toBe("24px");
    for (const selector of [".folia-scope .folia-icon-btn", ".folia-scope .folia-swatch"]) {
      expect(declarations(selector)).toMatchObject({
        "min-width": "var(--folia-hit-min)",
        "min-height": "var(--folia-hit-min)",
      });
    }
    // The swatch follows the host colour input upward as well, and Obsidian ships one under the
    // target, so the floor has to win inside the size too rather than only beside it.
    expect(declarations(".folia-scope .folia-swatch")).toMatchObject({
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
  });
});

describe("the no-value choice", () => {
  it("is an empty slot, never a filled swatch", () => {
    expect(declarations(".folia-scope .folia-swatch-none")).toMatchObject({
      background: "transparent",
      border: "var(--folia-border-width) dashed var(--text-faint)",
    });
  });

  it("drops the swatch's inset hairline, which would draw a solid line inside the dashed edge", () => {
    expect(declarations(".folia-scope .folia-swatch-none")["box-shadow"]).toBe("none");
  });
});
