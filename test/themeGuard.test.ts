import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  cpSync("src", join(fixture, "src"), { recursive: true });
  cpSync("manifest.json", join(fixture, "manifest.json"));
  cpSync("docs/decisions.md", join(fixture, "docs/decisions.md"));
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

const accept = () => {
  const result = spawnSync(process.execPath, [guard], { cwd: fixture, encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};
const json = (path: string, change: (data: Record<string, unknown>) => void) =>
  edit(path, (s) => {
    const data = JSON.parse(s) as Record<string, unknown>;
    change(data);
    return JSON.stringify(data, null, 2);
  });
type Registry = { variables: Record<string, { scope: string }> };
type Floor = { version: string; variables: string[] };

describe("theme guard owned values", () => {
  it("accepts the shipped theme", accept);

  it("refuses a --folia-* read that tokens.css does not declare", () => {
    edit("src/theme/cards.css", (s) =>
      s.replace("var(--folia-cue-thickness)", "var(--folia-strip)"),
    );
    reject("var(--folia-strip) resolves to nothing");
  });

  it("refuses an owned value without its reason", () => {
    edit("src/theme/tokens.css", (s) => s.replace(" /* the pointer outline on hover */", ""));
    reject("--folia-control-outline needs its reason");
  });

  it("refuses a token nothing reads", () => {
    edit("src/theme/tokens.css", (s) =>
      s.replace(
        "  --folia-dur: 170ms;",
        "  --folia-dur-slow: 400ms; /* unused */\n  --folia-dur: 170ms;",
      ),
    );
    reject("--folia-dur-slow is declared but nothing reads it");
  });

  it("refuses a component inventing a --folia-* name", () => {
    edit("src/theme/cards.css", (s) => s + "\n.folia-card { --folia-lift: 2px; }\n");
    reject("--folia-lift is declared here, but a component may only write one of the channels");
  });

  it("refuses a component overriding one of the board's own values", () => {
    edit("src/theme/cards.css", (s) => s + "\n.folia-card-actions { --folia-hit-md: 1px; }\n");
    reject("--folia-hit-md is declared here, but a component may only write one of the channels");
  });

  it("refuses a --folia-* name in code that is not a channel", () => {
    edit("src/ui/Column.tsx", (s) => s.replace('"--folia-col-accent"', '"--folia-col-acccent"'));
    reject("--folia-col-acccent is not declared");
  });

  it("refuses a token that reads itself", () => {
    edit("src/theme/tokens.css", (s) =>
      s.replace("calc(var(--input-height) - var(--size-4-1))", "var(--folia-hit-md)"),
    );
    reject("--folia-hit-md leads back to itself");
  });

  it("refuses a token that leads back to itself through another", () => {
    edit("src/theme/tokens.css", (s) =>
      s
        .replace("calc(var(--input-height) - var(--size-4-2))", "var(--folia-hit-md)")
        .replace("calc(var(--input-height) - var(--size-4-1))", "var(--folia-hit-sm)"),
    );
    reject("--folia-hit-sm leads back to itself");
  });

  it("refuses a channel a component writes in terms of itself", () => {
    edit(
      "src/theme/cards.css",
      (s) =>
        s +
        '\n.folia-card[data-urgency="overdue"] { --folia-urgency-tint: var(--folia-urgency-tint); }\n',
    );
    reject("--folia-urgency-tint leads back to itself here");
  });

  it("refuses a cycle that only a scheme override closes", () => {
    edit("src/theme/tokens.css", (s) =>
      s
        .replace(
          "--folia-shadow-pop: 0 6px 20px rgba(0, 0, 0, 0.28);",
          "--folia-shadow-pop: var(--folia-shadow-overlay);",
        )
        .replace(
          "  --folia-shadow-overlay: 0 12px 32px rgba(0, 0, 0, 0.24);",
          "  --folia-shadow-overlay: var(--folia-shadow-pop);",
        )
        .replace("  --folia-shadow-pop: 0 4px 12px rgba(0, 0, 0, 0.14);\n", ""),
    );
    reject("under .theme-light .folia-scope");
  });

  it("accepts a component writing a channel tokens.css declares", () => {
    edit(
      "src/theme/cards.css",
      (s) => s + "\n.folia-card { --folia-urgency-tint: transparent; }\n",
    );
    accept();
  });

  it("refuses a channel re-declared on .folia-scope", () => {
    edit(
      "src/theme/cards.css",
      (s) => s + "\n.folia-scope { --folia-urgency-tint: transparent; }\n",
    );
    reject("re-declares the token block");
  });

  it("refuses a scheme override outside tokens.css", () => {
    edit(
      "src/theme/cards.css",
      (s) => s + "\n.theme-light .folia-card { --folia-urgency-tint: transparent; }\n",
    );
    reject("belongs in src/theme/tokens.css");
  });

  it("refuses a rule nested inside the token block", () => {
    edit("src/theme/tokens.css", (s) =>
      s.replace(
        "  font-size: var(--font-ui-small);",
        "  font-size: var(--font-ui-small);\n  @media (min-width: 1px) {\n    --folia-shadow-card: var(--folia-shadow-card);\n  }",
      ),
    );
    reject("may hold only declarations");
  });

  it("refuses a scheme override of a name with no base value", () => {
    edit("src/theme/tokens.css", (s) =>
      s.replace(
        ".theme-light .folia-scope {",
        ".theme-light .folia-scope {\n  --folia-glow: none;",
      ),
    );
    reject("--folia-glow is overridden for one scheme but has no base value");
  });

  it("refuses a dead fallback on a token that is always declared", () => {
    edit("src/theme/cards.css", (s) =>
      s.replace("var(--folia-cue-thickness)", "var(--folia-cue-thickness, 3px)"),
    );
    reject("carries a fallback for a token that is always declared");
  });

  it.each(["#ff0000", "rgb(0 0 0)", "rebeccapurple"])(
    "refuses the raw colour %s outside tokens.css",
    (colour) => {
      edit("src/theme/cards.css", (s) => s + `\n.folia-card { outline-color: ${colour}; }\n`);
      reject("colour");
    },
  );

  it("accepts a length written where it is used", () => {
    edit("src/theme/cards.css", (s) => s + "\n.folia-card { margin-block: 7px; }\n");
    accept();
  });
});

describe("theme guard host allowlist", () => {
  it("refuses a host variable that is not on the allowlist", () => {
    edit("src/theme/cards.css", (s) => s + "\n.folia-card { color: var(--shadow-s); }\n");
    reject("var(--shadow-s) is not on the allowlist");
  });

  it("reads a var() call spelt with escapes", () => {
    edit("src/theme/cards.css", (s) => s + "\n.folia-card { color: v\\61 r(--shadow-s); }\n");
    reject("var(--shadow-s) is not on the allowlist");
  });

  it("reads var() calls in the board's code as well as in the stylesheet", () => {
    edit("src/ui/BoardDragOverlay.tsx", (s) =>
      s.replace('opacity: "0.5"', 'opacity: "var(--anim-opacity)"'),
    );
    reject("var(--anim-opacity) is not on the allowlist");
  });

  it("reads the column palette through columnAccent", () => {
    edit("src/ui/columnColors.ts", (s) => s.replace('  "yellow",', '  "yellow",\n  "teal",'));
    reject("var(--color-teal) is not on the allowlist");
  });

  it("refuses a variable documented only for Publish", () => {
    json("src/theme/host/variables.json", (d) => {
      (d as Registry).variables["--background-primary"]!.scope = "publish";
    });
    reject("documented for Obsidian Publish");
  });

  it("refuses an allowlist entry nothing reads", () => {
    json("src/theme/host/variables.json", (d) => {
      (d as Registry).variables["--shadow-s"] = { scope: "app" };
    });
    reject("--shadow-s is on the allowlist but nothing reads it");
  });

  it("refuses a variable the oldest supported Obsidian does not declare", () => {
    json("src/theme/host/floor.json", (d) => {
      const floor = d as Floor;
      floor.variables = floor.variables.filter((v) => v !== "--background-primary");
    });
    reject("var(--background-primary) is documented, but Obsidian");
  });

  it("refuses a floor list for another version than minAppVersion", () => {
    json("manifest.json", (d) => {
      d["minAppVersion"] = "1.12.0";
    });
    reject("manifest.json admits 1.12.0");
  });
});

describe("theme button contract", () => {
  it("rejects a face rule that loses its scope", () => {
    edit("src/theme/base.css", (s) => s.replace(".folia-scope .folia-link {", ".folia-link {"));
    reject("needs .folia-scope");
  });

  it.each(["folia-btn", "folia-card-action", "folia-host-control"])(
    "rejects an unscoped face rule on the host button class %s",
    (name) => {
      edit("src/theme/buttons.css", (s) => s + `\n.${name} { background: transparent; }\n`);
      reject("needs .folia-scope");
    },
  );

  it("rejects a button without its own class", () => {
    edit("src/ui/AddColumn.tsx", (s) => s.replace('className="folia-add-column"', 'className=""'));
    reject("Every button branch needs");
  });

  it("rejects a button that is not one of the recorded hand-drawn groups", () => {
    edit(
      "src/ui/AddColumn.tsx",
      (s) => s + '\nconst probe = <button className="folia-btn">Add</button>;\n',
    );
    reject("Use HostButton or HostIconButton, or record the group");
  });

  it("rejects a hand-drawn group whose decision entry is gone", () => {
    edit("docs/decisions.md", (s) =>
      s.replace("## In-text links and disclosures stay hand-drawn", "## Links"),
    );
    reject('The hand-drawn button group "In-text links and disclosures stay hand-drawn"');
  });

  it("checks both branches of a conditional class", () => {
    edit(
      "src/ui/AddColumn.tsx",
      (s) => s + '\nconst probe = <button className={flag ? "folia-link" : ""} />;\n',
    );
    reject("Every button branch needs");
  });

  it("requires an explicit resting shadow for a flat control", () => {
    edit("src/theme/base.css", (s) =>
      s.replace(
        ".folia-scope .folia-link {\n  box-shadow: none;\n",
        ".folia-scope .folia-link {\n",
      ),
    );
    reject("needs a scoped resting rule for box-shadow");
  });

  it("checks face rules for runtime class families", () => {
    edit(
      "src/ui/Toolbar.tsx",
      (s) =>
        s +
        '\nexport const Toned = (t: string) => <button className={"folia-link folia-tone-" + t} />;\n',
    );
    edit("src/theme/chips.css", (s) => s + "\n.folia-tone-new { background: transparent; }\n");
    reject("needs .folia-scope");
  });

  it("rejects rules that reach host-rendered buttons", () => {
    edit("src/theme/buttons.css", (s) => s + "\n.folia-scope button:disabled { opacity: 0.5; }\n");
    reject("not a bare button that reaches rendered Markdown");
  });

  it("accepts a rule that styles the rendered Markdown's own button inside its container", () => {
    edit(
      "src/theme/detail-panel.css",
      (s) => s + "\n.folia-desc-rendered pre > button:focus { color: var(--text-normal); }\n",
    );
    const result = spawnSync(process.execPath, [guard], { cwd: fixture, encoding: "utf8" });
    expect(result.stderr).not.toContain("not a bare button that reaches rendered Markdown");
    expect(result.status).toBe(0);
  });

  it.each([
    ".folia-scope :not(.folia-desc-rendered) button",
    ".folia-scope :has(.folia-comment-text) button",
    ".folia-scope :is(.folia-desc-rendered, .folia-btn) button",
  ])("rejects a button rule that only names the rendered Markdown containers: %s", (selector) => {
    edit(
      "src/theme/detail-panel.css",
      (s) => s + `\n${selector}:focus { color: var(--text-normal); }\n`,
    );
    reject("not a bare button that reaches rendered Markdown");
  });

  it.each([
    ".folia-card-action:hover",
    ".folia-detail-action:hover",
    ".folia-action-done:hover",
    ".folia-action-delete:hover",
    ".folia-card-action:is(:hover, :focus)",
  ])("rejects a later %s colour that would repaint Mark done or Delete", (selector) => {
    edit("src/theme/index.css", (s) => s + `\n@import "./late.css";\n`);
    writeFileSync(
      join(fixture, "src/theme/late.css"),
      `.folia-scope ${selector} { color: var(--text-normal); }\n`,
    );
    reject("would repaint its hover");
  });

  it("rejects a spread that can replace a button's class", () => {
    edit(
      "src/ui/AddColumn.tsx",
      (s) => s + '\nconst probe = <button className="folia-link" {...props} />;\n',
    );
    reject("A spread after a button's className");
  });

  it("rejects a host button whose class cannot be read", () => {
    edit(
      "src/ui/AddColumn.tsx",
      (s) => s + '\nconst probe = <HostButton className={face} text="x" onClick={go} />;\n',
    );
    reject("A host button's className must be written out");
  });

  it("rejects a spread on a host button, which can carry a class of its own", () => {
    edit(
      "src/ui/AddColumn.tsx",
      (s) => s + '\nconst probe = <HostIconButton className="folia-action-done" {...props} />;\n',
    );
    reject("A spread on a host button");
  });

  it("checks buttons outside src/ui too", () => {
    writeFileSync(
      join(fixture, "src/elsewhere.tsx"),
      'export const probe = <button className="folia-btn">x</button>;\n',
    );
    reject("Every button branch needs");
  });

  it("requires the Mark done hover colour", () => {
    edit("src/theme/card-quick-actions.css", (s) =>
      s.replace(/\.folia-scope \.folia-action-done:hover[^\n]*\n/, ""),
    );
    reject("folia-action-done:hover");
  });

  it.each([
    ":is(button)",
    ":where(button)",
    ":is(.folia-btn, button)",
    ":where(:is(button, .folia-btn))",
    ":is(.host-markdown button)",
  ])("rejects a wrapped host-button subject: %s", (selector) => {
    edit(
      "src/theme/buttons.css",
      (s) => s + `\n.folia-scope ${selector}:disabled { opacity: 0.5; }\n`,
    );
    reject("not a bare button that reaches rendered Markdown");
  });

  it("still checks a Folia face hidden inside a selector wrapper", () => {
    edit("src/theme/buttons.css", (s) => s + "\n:is(.folia-link) { background: transparent; }\n");
    reject("needs .folia-scope and a direct Folia subject class");
  });

  it.each([
    "@media (width: 0px)",
    "@supports (display: unknown)",
    "@container (width: 0px)",
    "@layer conditional",
  ])("does not credit a resting face nested in %s", (condition) => {
    const face = [
      "  box-shadow: none;\n",
      "  background: transparent;\n",
      "  color: var(--folia-link-color);\n",
    ];
    edit(
      "src/theme/base.css",
      (s) =>
        face.reduce((css, line) => css.replace(line, ""), s) +
        `\n${condition} { .folia-scope .folia-link { ${face.join("")} } }\n`,
    );
    reject("needs a scoped resting rule for background, color, box-shadow");
  });

  it.each(["hover", "active"])("requires the filter chip %s outline consumer", (state) => {
    edit("src/theme/buttons.css", (s) =>
      s.replace(`.folia-filter-chip:${state}:`, `.folia-swatch-none:${state}:`),
    );
    reject("Button signal .folia-scope .folia-filter-chip");
  });

  it("requires the pressed ring to sit deeper than the hover ring", () => {
    edit("src/theme/buttons.css", (s) =>
      s.replace(
        "  outline-offset: calc(-1 * 2 * var(--folia-border-width-thick));",
        "  outline-offset: calc(-1 * var(--folia-border-width-thick));",
      ),
    );
    reject("needs outline-offset: calc(-1 * 2 * var(--folia-border-width-thick))");
  });

  it.each([
    ["--folia-control-outline", "none"],
    ["--folia-border-width-thick", "0px"],
  ])("protects owned signal %s from being zeroed", (name, value) => {
    edit("src/theme/tokens.css", (s) =>
      s.replace(new RegExp(`${name}: [^;]+;`), `${name}: ${value};`),
    );
    reject(`Owned button signal ${name} must retain`);
  });
});

describe("theme guard forced-colours focus", () => {
  it("rejects a focus rule that removes the outline", () => {
    edit("src/theme/base.css", (s) => s + "\n.folia-new-field:focus {\n  outline: none;\n}\n");
    reject("`.folia-new-field:focus` removes the outline on focus");
  });
});
