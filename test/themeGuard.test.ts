import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const guard = resolve("scripts/check-theme.mjs");
let fixture: string;
const edit = (path: string, change: (source: string) => string) => {
  const file = join(fixture, path);
  writeFileSync(file, change(readFileSync(file, "utf8")));
};
const reject = (message: string) => {
  const result = spawnSync(process.execPath, [guard], { cwd: fixture, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
};

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "folia-theme-"));
  cpSync("src/theme", join(fixture, "src/theme"), { recursive: true });
  mkdirSync(join(fixture, "src/ui"));
  cpSync("src/ui/columnColors.ts", join(fixture, "src/ui/columnColors.ts"));
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe("theme guard scheme overrides", () => {
  it("accepts the shipped light overrides and an explicit dark override", () => {
    edit(
      "src/theme/tokens.css",
      (s) => s + "\n.theme-dark .folia-scope { --folia-shadow-card: none; }\n",
    );
    edit("src/theme/tokens/shadow.tokens.json", (s) =>
      s.replace(
        '"themes": {',
        '"themes": { "dark": { "$value": "none", "source": { "owned": true, "reason": "Flat cards in this fixture." } },',
      ),
    );
    expect(execFileSync(process.execPath, [guard], { cwd: fixture, encoding: "utf8" })).toContain(
      "check-theme: OK",
    );
  });

  it.each([
    ".theme-light",
    ".theme-light .folia-card",
    ".theme-light.folia-scope",
    ".theme-custom .folia-scope",
  ])("rejects unsupported token selector %s", (selector) => {
    edit("src/theme/tokens.css", (s) => s.replace(".theme-light .folia-scope {", `${selector} {`));
    reject("Only .folia-scope");
  });

  it("rejects theme overrides in component files even when they only alias tokens", () => {
    edit(
      "src/theme/cards.css",
      (s) => s + "\n.theme-light .folia-card { --folia-shadow-card: var(--folia-shadow-pop); }\n",
    );
    reject("Theme token overrides belong only in tokens.css");
  });

  it("requires metadata for every scheme declaration", () => {
    edit("src/theme/tokens/shadow.tokens.json", (s) => s.replace('"light":', '"dark":'));
    reject("--folia-shadow-card (light) has no metadata");
  });

  it("checks scheme values against metadata", () => {
    edit("src/theme/tokens.css", (s) => s.replace("0 1px 1px rgba(0, 0, 0, 0.08)", "none"));
    reject("one of the two is stale");
  });

  it("rejects a cycle introduced only by a scheme override", () => {
    edit("src/theme/tokens.css", (s) =>
      s.replace("0 1px 1px rgba(0, 0, 0, 0.08)", "var(--folia-shadow-card-selected)"),
    );
    reject("is a cycle");
  });

  it.each([
    ["--folia-new: none;", "has no base declaration"],
    ["color: red;", "may only redeclare --folia-*"],
    ["--folia-shadow-card: none;", "is declared twice"],
    ["--folia-shadow-pop: none !important;", "may not use !important"],
    ["& { --folia-shadow-card: none; }", "flat lists of declarations"],
  ])("rejects invalid theme declaration %s", (declaration, message) => {
    edit("src/theme/tokens.css", (s) =>
      s.replace(".theme-light .folia-scope {", `.theme-light .folia-scope { ${declaration}`),
    );
    reject(message);
  });

  it("rejects duplicate scheme rules", () => {
    edit("src/theme/tokens.css", (s) => s + "\n.theme-light .folia-scope {}\n");
    reject("Duplicate token rule");
  });
});

describe("theme guard adopted foundations", () => {
  it.each(["9px", "9e0px", ".9px", "9PX"])(
    "rejects an off-grid owned layout length %s",
    (value) => {
      edit("src/theme/tokens.css", (s) =>
        s.replace("--folia-gap: var(--size-4-2)", `--folia-gap: ${value}`),
      );
      edit("src/theme/tokens/spacing.tokens.json", (s) =>
        s.replace(
          /"\$value": "var\(--size-4-2\)",\s*"cssVar": "--folia-gap",\s*"source": \{[^}]+\}/,
          `"$value": "${value}", "cssVar": "--folia-gap", "source": { "owned": true, "reason": "Regression fixture." }`,
        ),
      );
      reject("outside the host grid");
    },
  );

  it("requires aliases for cursor defaults", () => {
    edit("src/theme/tokens.css", (s) =>
      s.replace("--folia-cursor-control: var(--cursor)", "--folia-cursor-control: default"),
    );
    edit("src/theme/tokens/cursor.tokens.json", (s) =>
      s
        .replace('"$value": "var(--cursor)"', '"$value": "default"')
        .replace('"alias": "--cursor"', '"owned": true, "reason": "Regression fixture."'),
    );
    reject("Alias it:");
  });

  it("rejects literal icon sizing in container rules", () => {
    edit("src/theme/chips.css", (s) =>
      s.replace("--folia-icon-size: var(--icon-xs)", "--folia-icon-size: 15px"),
    );
    reject("15px is a raw length");
  });
  it("requires icon aliases through the icon token family", () => {
    edit("src/theme/tokens.css", (s) =>
      s.replace("--folia-icon-size: var(--icon-s)", "--folia-icon-size: 14px"),
    );
    edit("src/theme/tokens/icon.tokens.json", (s) =>
      s
        .replace('"$value": "var(--icon-s)"', '"$value": "14px"')
        .replace('"alias": "--icon-s"', '"owned": true, "reason": "Regression fixture."'),
    );
    reject("Alias it: `--folia-icon-size: var(--icon-xs);");
  });
});

describe("theme guard dependency parsing", () => {
  const functions = ["var", "VAR", String.raw`v\61 r`];
  const setSchemeShadow = (scheme: string, value: string) => {
    edit("src/theme/tokens.css", (s) =>
      scheme === "light"
        ? s.replace("0 1px 1px rgba(0, 0, 0, 0.08)", value)
        : s + `\n.theme-dark .folia-scope { --folia-shadow-card: ${value}; }\n`,
    );
    edit("src/theme/tokens/shadow.tokens.json", (s) => {
      const metadata = JSON.parse(s) as {
        card: {
          themes: Record<string, { $value: string; source: { owned: boolean; reason: string } }>;
        };
      };
      metadata.card.themes[scheme] = {
        $value: value,
        source: { owned: true, reason: "Dependency regression fixture." },
      };
      return JSON.stringify(metadata);
    });
  };

  it.each(functions)("rejects base cycles spelled with %s()", (fn) => {
    edit("src/theme/tokens.css", (s) =>
      s.replace(
        "--folia-shadow-card: 0 1px 2px rgba(0, 0, 0, 0.16)",
        `--folia-shadow-card: ${fn}(--folia-shadow-card-selected)`,
      ),
    );
    edit("src/theme/tokens/shadow.tokens.json", (s) =>
      s.replace(
        JSON.stringify("0 1px 2px rgba(0, 0, 0, 0.16)"),
        JSON.stringify(`${fn}(--folia-shadow-card-selected)`),
      ),
    );
    reject("is a cycle in the base scheme");
  });

  it.each(functions)("rejects direct component cycles spelled with %s()", (fn) => {
    edit(
      "src/theme/cards.css",
      (s) => s + `\n.folia-card { --folia-accent: ${fn}(--folia-accent); }\n`,
    );
    reject("reads itself directly");
  });

  it.each(functions)("finds cycle edges inside fallback arguments spelled with %s()", (fn) => {
    const value = `var(--interactive-accent, ${fn}(--folia-shadow-card-selected))`;
    setSchemeShadow("light", value);
    reject("is a cycle in the light scheme");
  });

  for (const scheme of ["light", "dark"]) {
    it.each(functions)(`rejects a ${scheme}/component cycle with a %s() scheme edge`, (fn) => {
      setSchemeShadow(scheme, `${fn}(--folia-accent)`);
      edit(
        "src/theme/column-menu.css",
        (s) => s + "\n.folia-menu.folia-menu { --folia-accent: var(--folia-shadow-card); }\n",
      );
      reject(`through the ${scheme} token map`);
    });

    it.each(functions)(`rejects a ${scheme}/component cycle with a %s() component edge`, (fn) => {
      setSchemeShadow(scheme, "var(--folia-accent)");
      edit(
        "src/theme/column-menu.css",
        (s) => s + `\n.folia-menu.folia-menu { --folia-accent: ${fn}(--folia-shadow-card); }\n`,
      );
      reject(`through the ${scheme} token map`);
    });
  }

  it("accepts a component reference when no scheme leads back to the overridden token", () => {
    setSchemeShadow("light", "var(--folia-card-bg)");
    edit(
      "src/theme/column-menu.css",
      (s) => s + "\n.folia-menu.folia-menu { --folia-accent: var(--folia-shadow-card); }\n",
    );
    expect(execFileSync(process.execPath, [guard], { cwd: fixture, encoding: "utf8" })).toContain(
      "check-theme: OK",
    );
  });
});

describe("theme guard fallbacks", () => {
  /** Turn a bare alias into one with a fallback, in both the CSS and the metadata, so the only
   *  thing under test is whether the guard accepts that fallback. */
  const giveFallback = (cssVar: string, alias: string, key: string, value: string) => {
    edit("src/theme/tokens.css", (s) =>
      s.replace(`${cssVar}: var(${alias});`, `${cssVar}: var(${alias}, ${value});`),
    );
    edit("src/theme/tokens/color.tokens.json", (s) =>
      s.replace(
        `"${key}": {\n    "$value": "var(${alias})",\n    "cssVar": "${cssVar}",\n    "source": {\n      "alias": "${alias}"\n    }\n  }`,
        `"${key}": {\n    "$value": "var(${alias}, ${value})",\n    "cssVar": "${cssVar}",\n    "source": {\n      "alias": "${alias}",\n      "fallback": { "value": "${value}", "reason": "A sentence that sounds like an argument." }\n    }\n  }`,
      ),
    );
  };

  it("refuses a literal fallback on a variable whose default differs by scheme", () => {
    // The audit's 02-03: one value cannot stand in for a light/dark pair, so whatever is written is
    // guaranteed wrong in one of the two modes the branch could ever fire in.
    giveFallback("--folia-danger", "--color-red", "danger", "#e5534b");
    reject("documents --color-red per scheme");
  });

  it("refuses a literal fallback on a variable Obsidian publishes no default for", () => {
    // The hole a reviewer found: only six of the variables this layer reads document a per-scheme
    // default, so a rule that only caught those let the worst of the nine literals straight back in
    // — `var(--text-on-accent, #fff)`, whose whole danger is freezing white for a pale accent.
    giveFallback("--folia-on-accent", "--text-on-accent", "on-accent", "#fff");
    reject("publishes no default for --text-on-accent to agree with");
  });

  it("keeps accepting a fallback that is another var(), which is not a second opinion", () => {
    expect(execFileSync(process.execPath, [guard], { cwd: fixture, encoding: "utf8" })).toContain(
      "check-theme: OK",
    );
  });
});

describe("theme guard column palette", () => {
  it("refuses a palette name that resolves to a variable Obsidian does not document", () => {
    edit("src/ui/columnColors.ts", (s) =>
      s.replace("var(--color-${name})", "var(--colour-${name})"),
    );
    reject("which Obsidian does not document");
  });

  it("refuses a resolver that paints more than the one variable it claims to", () => {
    // `var(--color-red) var(--invented)` computes to an invalid colour on every board. Reading only
    // the first var() out of the template let that pass while the guard reported OK.
    edit("src/ui/columnColors.ts", (s) =>
      s.replace("var(--color-${name})", "var(--color-${name}) var(--totally-made-up)"),
    );
    reject("could not find the");
  });
});
