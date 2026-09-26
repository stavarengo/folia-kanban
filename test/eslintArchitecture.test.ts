import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const restrictedPackages = async (file: string) => {
  const config = await new ESLint().calculateConfigForFile(file);
  const [severity, options] = config?.rules?.["no-restricted-imports"] ?? [];
  const paths: { name: string }[] = options?.paths ?? [];
  return { severity, names: paths.map((p) => p.name) };
};

describe("obsidian import fence", () => {
  it.each(["src/model/card.ts", "src/ui/App.tsx", "src/mcp/tools.ts"])(
    "forbids the obsidian package in %s",
    async (file) => {
      const { severity, names } = await restrictedPackages(file);
      expect(severity).toBe(2);
      expect(names).toContain("obsidian");
    },
  );

  it.each(["src/obsidian/vaultRepo.ts", "src/main.ts"])(
    "leaves %s free to import it",
    async (file) => {
      expect((await restrictedPackages(file)).names).not.toContain("obsidian");
    },
  );
});
