import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const eslint = new ESLint();
const importObsidian = (filePath: string) =>
  eslint.lintText(
    'import { normalizePath } from "obsidian";\nexport const path = normalizePath;\n',
    {
      filePath,
    },
  );
const readActiveGlobals = (filePath: string) =>
  eslint.lintText(
    "export const all = [activeDocument.body, activeWindow.innerWidth, window.activeDocument, globalThis.activeWindow, self.activeDocument];\n",
    { filePath },
  );

// The first lint builds the TypeScript program the type-aware rules need, which under a loaded
// full run can take longer than one case is allowed. Paid once here, each case times only itself.
beforeAll(() => eslint.lintText("", { filePath: "src/model/card.ts" }), 60_000);

describe("obsidian import fence", () => {
  it.each(["src/model/card.ts", "src/ui/App.tsx", "src/mcp/tools.ts", "src/settings.ts"])(
    "rejects the obsidian package in %s",
    async (file) => {
      const [result] = await importObsidian(file);
      expect(result?.messages.map((m) => m.ruleId)).toContain("no-restricted-imports");
    },
  );

  it.each(["src/obsidian/vaultRepo.ts", "src/main.ts", "src/view.tsx"])(
    "leaves %s free to import it",
    async (file) => {
      const [result] = await importObsidian(file);
      expect(result?.fatalErrorCount).toBe(0);
      expect(result?.messages.map((m) => m.ruleId)).not.toContain("no-restricted-imports");
    },
  );
});

describe("obsidian active-window globals fence", () => {
  const fenceRules = ["no-restricted-globals", "no-restricted-properties"];

  it.each(["src/model/card.ts", "src/ui/context.ts", "src/mcp/tools.ts", "src/settings.ts"])(
    "rejects activeDocument and activeWindow in %s",
    async (file) => {
      const [result] = await readActiveGlobals(file);
      // The model and MCP also ban `window` itself (the DOM fence below); only this fence counts.
      const banned = result?.messages.filter(
        (m) => fenceRules.includes(m.ruleId ?? "") && m.message.includes("focused window"),
      );
      expect(banned?.map((m) => [m.ruleId, m.severity])).toEqual([
        ["no-restricted-globals", 2],
        ["no-restricted-globals", 2],
        ["no-restricted-properties", 2],
        ["no-restricted-properties", 2],
        ["no-restricted-properties", 2],
      ]);
    },
  );

  it.each(["src/obsidian/vaultRepo.ts", "src/main.ts", "src/view.tsx"])(
    "leaves %s free to use them",
    async (file) => {
      const [result] = await readActiveGlobals(file);
      expect(result?.fatalErrorCount).toBe(0);
      expect(result?.messages.filter((m) => fenceRules.includes(m.ruleId ?? ""))).toEqual([]);
    },
  );
});

const ruleIdsOf = async (code: string, filePath: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  expect(result?.fatalErrorCount).toBe(0);
  return result?.messages.map((m) => m.ruleId) ?? [];
};

describe("app-supplied modules fence", () => {
  const appModules =
    'import { ipcRenderer } from "electron";\n' +
    'import type { WebContents } from "electron/main";\n' +
    'import { EditorView } from "@codemirror/view";\n' +
    'import type { Tree } from "@lezer/common";\n' +
    "export const all = (w: WebContents, t: Tree) => [ipcRenderer, EditorView, w, t];\n";

  it.each(["src/model/card.ts", "src/ui/App.tsx", "src/mcp/tools.ts", "src/settings.ts"])(
    "rejects electron, CodeMirror and Lezer in %s",
    async (file) => {
      const ids = await ruleIdsOf(appModules, file);
      expect(ids.filter((id) => id === "no-restricted-imports")).toHaveLength(4);
    },
  );

  it.each(["src/obsidian/vaultRepo.ts", "src/main.ts", "src/view.tsx"])(
    "leaves %s free to import them",
    async (file) => {
      expect(await ruleIdsOf(appModules, file)).not.toContain("no-restricted-imports");
    },
  );
});

describe("Node and DOM globals fence", () => {
  const nodeGlobals =
    "export const all = [process.env, Buffer.from(''), global, require('x'), __dirname];\n";
  const domGlobals =
    "export const all = [document.body, window.innerWidth, localStorage.length, navigator.language];\n";
  // Obsidian's preset already bans localStorage everywhere in src, so the allowed cases leave it out.
  const pageGlobals =
    "export const page = [document.body, window.innerWidth, navigator.language];\n";
  const restricted = async (code: string, file: string) =>
    (await ruleIdsOf(code, file)).filter((id) => id === "no-restricted-globals").length;

  it.each(["src/model/card.ts", "src/ui/App.tsx", "src/mcp/tools.ts", "src/settings.ts"])(
    "rejects Node globals in %s",
    async (file) => {
      expect(await restricted(nodeGlobals, file)).toBe(5);
    },
  );

  it.each(["src/model/card.ts", "src/mcp/tools.ts"])("rejects DOM globals in %s", async (file) => {
    expect(await restricted(domGlobals, file)).toBe(4);
  });

  it.each(["src/model/card.ts", "src/mcp/tools.ts"])(
    "rejects them reached through self and globalThis in %s",
    async (file) => {
      const qualified =
        "export const all = [self.document.title, globalThis.navigator, self.process, globalThis.Buffer];\n";
      const ids = await ruleIdsOf(qualified, file);
      expect(ids.filter((id) => id === "no-restricted-properties")).toHaveLength(4);
    },
  );

  it.each(["src/model/card.ts", "src/mcp/tools.ts"])(
    "rejects an alias of self or globalThis in %s",
    async (file) => {
      const aliased =
        "const scope = self;\nconst root = globalThis;\nexport const all = [scope.document, root.navigator];\n";
      const ids = await ruleIdsOf(aliased, file);
      expect(ids.filter((id) => id === "no-restricted-globals")).toHaveLength(2);
    },
  );

  it("rejects Node globals reached through globalThis in the UI, not the DOM", async () => {
    const qualified = "export const all = [globalThis.process, self.document.title];\n";
    const ids = await ruleIdsOf(qualified, "src/ui/App.tsx");
    expect(ids.filter((id) => id === "no-restricted-properties")).toHaveLength(1);
  });

  it.each(["src/model/card.ts", "src/mcp/tools.ts"])(
    "does not steer %s toward window through the preset's own advice",
    async (file) => {
      const ids = await ruleIdsOf("export const t = setTimeout(() => {}, 1);\n", file);
      expect(ids).not.toContain("obsidianmd/prefer-window-timers");
    },
  );

  it("leaves the UI free to use the DOM", async () => {
    expect(await restricted(pageGlobals, "src/ui/App.tsx")).toBe(0);
  });

  it.each(["src/obsidian/vaultRepo.ts", "src/main.ts"])(
    "leaves %s free to use both",
    async (file) => {
      expect(await restricted(nodeGlobals + pageGlobals, file)).toBe(0);
    },
  );
});

describe("scripts/ is linted", () => {
  it("runs the recommended rules on a script, with Node and browser globals", async () => {
    const [result] = await eslint.lintText(
      "export const run = () => [process.argv, window.innerWidth, undeclaredThing];\n",
      { filePath: "scripts/some-guard.mjs" },
    );
    expect(result?.warningCount).toBe(0);
    expect(result?.messages.map((m) => [m.ruleId, m.message])).toEqual([
      ["no-undef", "'undeclaredThing' is not defined."],
    ]);
  });
});
