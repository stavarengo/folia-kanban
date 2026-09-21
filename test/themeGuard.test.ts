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
