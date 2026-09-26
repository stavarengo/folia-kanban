import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const importObsidian = (filePath: string) =>
  eslint.lintText(
    'import { normalizePath } from "obsidian";\nexport const path = normalizePath;\n',
    {
      filePath,
    },
  );

describe("obsidian import fence", () => {
  it.each(["src/model/card.ts", "src/ui/App.tsx", "src/mcp/tools.ts"])(
    "rejects the obsidian package in %s",
    async (file) => {
      const [result] = await importObsidian(file);
      expect(result?.messages.map((m) => m.ruleId)).toContain("no-restricted-imports");
    },
  );

  it.each(["src/obsidian/vaultRepo.ts", "src/boardNote.ts", "src/view.tsx"])(
    "leaves %s free to import it",
    async (file) => {
      const [result] = await importObsidian(file);
      expect(result?.messages.map((m) => m.ruleId)).not.toContain("no-restricted-imports");
    },
  );
});
