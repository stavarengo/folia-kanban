import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const GATE = "src/obsidian/compat.ts";
const OTHER = "src/obsidian/vaultRepo.ts";

const unguarded =
  'import type { ButtonComponent } from "obsidian";\n' +
  "export const red = (b: ButtonComponent): void => {\n  b.setDestructive();\n};\n";
const guarded =
  'import { requireApiVersion, type ButtonComponent } from "obsidian";\n' +
  "export const red = (b: ButtonComponent): void => {\n" +
  '  if (requireApiVersion("1.13.0")) b.setDestructive();\n  else b.setWarning();\n};\n';

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  expect(result?.fatalErrorCount).toBe(0);
  return result?.messages.map((m) => m.ruleId) ?? [];
}

// The first lint builds the type-checked program the rule needs, which takes seconds.
describe("newer Obsidian APIs go through the one version gate", { timeout: 30_000 }, () => {
  it.each([GATE, OTHER])("rejects an unguarded 1.13 call in %s", async (file) => {
    expect(await ruleIds(unguarded, file)).toContain("obsidianmd/no-unsupported-api");
  });

  it("rejects a guard written outside the gate file", async () => {
    const ids = await ruleIds(guarded, OTHER);
    expect(ids).toContain("no-restricted-syntax");
    expect(ids).not.toContain("obsidianmd/no-unsupported-api");
  });

  it("rejects the gate reached through a namespace import outside the gate file", async () => {
    const code =
      'import * as Obsidian from "obsidian";\n' +
      'export const newer = (): boolean => Obsidian.requireApiVersion("1.13.0");\n' +
      'export const newest = (): boolean => Obsidian["requireApiVersion"]("1.13.1");\n';
    const ids = await ruleIds(code, OTHER);
    expect(ids.filter((id) => id === "no-restricted-syntax")).toHaveLength(2);
  });

  it("accepts the guarded call in the gate file", async () => {
    const ids = await ruleIds(guarded, GATE);
    expect(ids).not.toContain("no-restricted-syntax");
    expect(ids).not.toContain("obsidianmd/no-unsupported-api");
  });
});

describe("tooltips in src/ui are Obsidian's", { timeout: 30_000 }, () => {
  const UI = "src/ui/Toolbar.tsx";

  it("rejects a title attribute", async () => {
    const code = 'export const Toolbar = () => <span title="Priority">A</span>;\n';
    expect(await ruleIds(code, UI)).toContain("no-restricted-syntax");
  });

  it("accepts the same hint as an aria-label", async () => {
    const code = 'export const Toolbar = () => <span aria-label="Priority">A</span>;\n';
    expect(await ruleIds(code, UI)).not.toContain("no-restricted-syntax");
  });

  it("leaves a component's own title prop alone", async () => {
    const code =
      "const Section = (p: { title: string }) => <h3>{p.title}</h3>;\n" +
      'export const Toolbar = () => <Section title="Due" />;\n';
    expect(await ruleIds(code, UI)).not.toContain("no-restricted-syntax");
  });

  it("still rejects a version guard written there", async () => {
    expect(await ruleIds(guarded, UI)).toContain("no-restricted-syntax");
  });
});
