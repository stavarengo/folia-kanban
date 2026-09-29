// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type IConfiguration, type ICruiseResult } from "dependency-cruiser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const config = createRequire(import.meta.url)("../.dependency-cruiser.cjs") as IConfiguration;

/**
 * A small tree laid out like src/ and test/, where each file either crosses one boundary or is a
 * control that must stay allowed. It is written under the repo's own tmp/ so that the npm
 * packages resolve exactly as they do from src/, and so that nothing the verify run lints,
 * type-checks or cruises ever sees it.
 */
const tree: Record<string, string> = {
  "src/main.ts": "export const main = 1;\n",
  "src/view.tsx": "export const view = 1;\n",
  "src/bindAddress.ts": "export const bind = 1;\n",
  "src/settings.ts": 'export { bind } from "./bindAddress";\nexport type Settings = { a: 1 };\n',
  "src/obsidian/adapter.ts": [
    'import { Plugin } from "obsidian";',
    'import { shell } from "electron";',
    'export const adapter = async () => [Plugin, shell, await import("http")];',
    "",
  ].join("\n"),
  "src/model/io.ts":
    'import { readFileSync } from "node:fs";\nexport const io = async () => [readFileSync, await import("path")];\n',
  "src/mcp/store.ts": 'export const store = () => import("node:sqlite");\n',
  "src/ui/stats.ts": 'import type { Stats } from "fs";\nexport type S = Stats;\n',
  "src/frontmatter.ts": 'export const parse = () => import("yaml");\n',
  "src/model/yamlDoc.ts": 'import type { Document } from "yaml";\nexport type Doc = Document;\n',
  "src/model/typed.ts": 'export type App = import("obsidian").App;\n',
  "src/mcp/lazy.ts": 'export const load = () => import("@codemirror/view");\n',
  "src/model/b.ts": "export const b = 1;\n",
  "src/model/a.ts": [
    'import { b } from "./b";',
    'import { z } from "zod";',
    'import type { Settings } from "../settings";',
    'import { useState } from "react";',
    'import { fake } from "../../test/fake";',
    'export const a = async (s: Settings) => [b, z, s, useState, fake, await import("@dnd-kit/core")];',
    "",
  ].join("\n"),
  "src/mcp/tools.ts": [
    'import { b } from "../model/b";',
    'import { bind } from "../bindAddress";',
    'import type { Root } from "react-dom/client";',
    "export const tools = (r: Root) => [b, bind, r];",
    "",
  ].join("\n"),
  "src/ui/App.tsx": [
    'import type { Settings } from "../settings";',
    'import { hop } from "./hop";',
    "export const App = (s: Settings) => [s, hop];",
    "",
  ].join("\n"),
  "src/ui/hop.ts":
    'import type { main } from "../main";\nexport const hop = (m: typeof main) => m;\n',
  "src/toolsLink.ts":
    'import type { tools } from "./mcp/tools";\nexport type Tools = typeof tools;\n',
  "src/ui/Bridge.ts": [
    'import { adapter } from "../obsidian/adapter";',
    'import type { Tools } from "../toolsLink";',
    "export const bridge = (t: Tools) => [adapter, t];",
    "",
  ].join("\n"),
  "src/ui/Modal.tsx": 'import { view } from "../view";\nexport const Modal = view;\n',
  "test/fake.ts": "export const fake = 1;\n",
  // An installed copy of an app-supplied module, which resolves into node_modules.
  "node_modules/@codemirror/view/package.json":
    '{ "name": "@codemirror/view", "main": "index.js" }\n',
  "node_modules/@codemirror/view/index.js": "export const EditorView = 1;\n",
};

let fixtureDir = "";
let violations: string[] = [];

beforeAll(async () => {
  mkdirSync(join(repoRoot, "tmp"), { recursive: true });
  fixtureDir = mkdtempSync(join(repoRoot, "tmp", "boundaries-"));
  for (const [path, source] of Object.entries(tree)) {
    mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
    writeFileSync(join(fixtureDir, path), source);
  }
  // The repo's tsconfig does not describe the fixture tree; type-only imports are found without it.
  const { tsConfig, ...options } = config.options ?? {};
  expect(tsConfig).toBeDefined();
  const { output } = await cruise(["src"], {
    ...options,
    baseDir: fixtureDir,
    validate: true,
    ruleSet: { forbidden: config.forbidden ?? [] },
  });
  violations = (output as ICruiseResult).summary.violations
    .filter((v) => v.rule.severity === "error")
    .map((v) => `${v.rule.name}: ${v.from} → ${v.to.replace(/^.*node_modules\//, "npm:")}`)
    .sort();
}, 60_000);

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe("architecture boundaries (dependency-cruiser)", () => {
  it("fails every deliberate crossing and nothing else", () => {
    expect(violations).toEqual([
      // G1: the model and MCP are allow-lists within src, type-only imports included.
      "mcp-is-a-port-consumer: src/mcp/tools.ts → src/bindAddress.ts",
      "model-and-mcp-stay-off-the-ui-stack: src/mcp/tools.ts → npm:react-dom/client.js",
      "model-and-mcp-stay-off-the-ui-stack: src/model/a.ts → npm:@dnd-kit/core/dist/index.js",
      "model-and-mcp-stay-off-the-ui-stack: src/model/a.ts → npm:react/index.js",
      "model-is-pure-domain: src/model/a.ts → src/settings.ts",
      // Node's modules stay in the adapter and shell, `node:`-prefixed, dynamic and type-only too;
      // the adapter's own lazy import("http") stays allowed.
      "node-builtins-stay-in-adapter-and-shell: src/mcp/store.ts → node:sqlite",
      "node-builtins-stay-in-adapter-and-shell: src/model/io.ts → fs",
      "node-builtins-stay-in-adapter-and-shell: src/model/io.ts → path",
      "node-builtins-stay-in-adapter-and-shell: src/ui/stats.ts → fs",
      // Obsidian and what it supplies stay behind the adapter and the shell, including an inline
      // import() type, a dynamic import and a path through the adapter, installed or not.
      "only-adapter-and-shell-reach-the-app: src/mcp/lazy.ts → npm:@codemirror/view/index.js",
      "only-adapter-and-shell-reach-the-app: src/model/typed.ts → obsidian",
      "only-adapter-and-shell-reach-the-app: src/ui/Bridge.ts → electron",
      "only-adapter-and-shell-reach-the-app: src/ui/Bridge.ts → obsidian",
      // G7: shipped code never imports test/.
      "src-never-imports-test: src/model/a.ts → test/fake.ts",
      // yaml is test-only: shipped code may not import it anywhere, type-only or dynamically.
      "src-never-imports-yaml: src/frontmatter.ts → npm:yaml/dist/index.js",
      "src-never-imports-yaml: src/model/yamlDoc.ts → npm:yaml/dist/index.js",
      // G2: the UI reaches none of the adapter, MCP or the shell, directly or through type-only
      // hops (Bridge → toolsLink.ts → mcp, App → hop → main.ts).
      "ui-never-reaches-adapter-mcp-or-shell: src/ui/App.tsx → src/main.ts",
      "ui-never-reaches-adapter-mcp-or-shell: src/ui/Bridge.ts → src/mcp/tools.ts",
      "ui-never-reaches-adapter-mcp-or-shell: src/ui/Bridge.ts → src/obsidian/adapter.ts",
      "ui-never-reaches-adapter-mcp-or-shell: src/ui/Modal.tsx → src/view.tsx",
      "ui-never-reaches-adapter-mcp-or-shell: src/ui/hop.ts → src/main.ts",
    ]);
  });
});
