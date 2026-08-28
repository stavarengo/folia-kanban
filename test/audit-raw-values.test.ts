import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detect,
  findNovel,
  totalOccurrences,
  writeAllowlist,
  readAllowlist,
} from "../scripts/audit-raw-values.mjs";

// Importing the script above runs no side effect — it only defines functions, guarded behind an
// `isMain` check for its CLI block — so these tests call the ratchet's actual logic directly
// against throwaway fixture directories, never against (or in place of) this repo's own src/.

function makeFixture(cssContent: string): { root: string; srcDir: string } {
  const root = mkdtempSync(join(tmpdir(), "audit-raw-values-"));
  const srcDir = join(root, "src");
  mkdirSync(srcDir);
  writeFileSync(join(srcDir, "styles.css"), cssContent);
  return { root, srcDir };
}

describe("detect() counts occurrences per (file, snippet) pair", () => {
  it("counts a snippet that appears twice in the same file as count: 2", () => {
    const { root, srcDir } = makeFixture("a { width: 320px; } b { height: 320px; }");
    const findings = detect(srcDir, root);
    rmSync(root, { recursive: true, force: true });
    expect(findings).toEqual([{ file: "src/styles.css", snippet: "320px", count: 2 }]);
  });

  it("gives each distinct snippet its own entry", () => {
    const { root, srcDir } = makeFixture("a { width: 320px; } b { height: 440px; }");
    const findings = detect(srcDir, root);
    rmSync(root, { recursive: true, force: true });
    expect(findings).toEqual([
      { file: "src/styles.css", snippet: "320px", count: 1 },
      { file: "src/styles.css", snippet: "440px", count: 1 },
    ]);
  });
});

describe("findNovel() — the ratchet's core comparison", () => {
  it("passes a snippet whose observed count matches the allowlisted count", () => {
    const findings = [{ file: "src/styles.css", snippet: "320px", count: 2 }];
    const allowlist = [{ file: "src/styles.css", snippet: "320px", count: 2 }];
    expect(findNovel(findings, allowlist)).toEqual([]);
  });

  it("fails a SECOND, unlisted copy of an already-allowlisted snippet (the bug this guards)", () => {
    const findings = [{ file: "src/styles.css", snippet: "320px", count: 2 }];
    const allowlist = [{ file: "src/styles.css", snippet: "320px", count: 1 }];
    expect(findNovel(findings, allowlist)).toEqual(findings);
  });

  it("treats an unlisted (file, snippet) pair as fully novel", () => {
    const findings = [{ file: "src/styles.css", snippet: "999px", count: 1 }];
    expect(findNovel(findings, [])).toEqual(findings);
  });

  it("passes an observed count BELOW the allowlisted ceiling (paid-down debt stays fine)", () => {
    const findings = [{ file: "src/styles.css", snippet: "320px", count: 1 }];
    const allowlist = [{ file: "src/styles.css", snippet: "320px", count: 2 }];
    expect(findNovel(findings, allowlist)).toEqual([]);
  });

  it("throws on a malformed allowlist count instead of silently failing open", () => {
    const findings = [{ file: "src/styles.css", snippet: "320px", count: 5 }];
    const allowlist = [{ file: "src/styles.css", snippet: "320px", count: "not-a-number" }];
    expect(() => findNovel(findings, allowlist)).toThrow(/invalid allowlist count/);
  });

  it("throws on a negative or fractional allowlist count", () => {
    const findings = [{ file: "src/styles.css", snippet: "320px", count: 1 }];
    expect(() =>
      findNovel(findings, [{ file: "src/styles.css", snippet: "320px", count: -1 }]),
    ).toThrow();
    expect(() =>
      findNovel(findings, [{ file: "src/styles.css", snippet: "320px", count: 1.5 }]),
    ).toThrow();
  });
});

it("totalOccurrences sums every finding's count, not just the number of entries", () => {
  expect(
    totalOccurrences([
      { file: "a", snippet: "x", count: 3 },
      { file: "a", snippet: "y", count: 1 },
    ]),
  ).toBe(4);
});

describe("writeAllowlist()/readAllowlist() round-trip", () => {
  it("writes exactly the findings passed in, readable back unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-raw-values-"));
    const path = join(root, "allowlist.json");
    const findings = [{ file: "src/styles.css", snippet: "320px", count: 2 }];
    writeAllowlist(findings, path);
    const readBack = readAllowlist(path);
    rmSync(root, { recursive: true, force: true });
    expect(readBack).toEqual(findings);
  });

  it("readAllowlist returns null for a missing or invalid file", () => {
    expect(readAllowlist("/nonexistent/path/allowlist.json")).toBeNull();
  });
});

describe("--update produces a baseline that checks clean, by construction", () => {
  it("detect() + writeAllowlist() + detect() + findNovel() round-trips to zero novel findings", () => {
    const { root, srcDir } = makeFixture(
      "a { width: 320px; } b { height: 320px; } c { width: 440px; }",
    );
    const allowlistPath = join(root, "allowlist.json");
    const findings = detect(srcDir, root);
    writeAllowlist(findings, allowlistPath);
    const rebaselined = readAllowlist(allowlistPath);
    const recheck = detect(srcDir, root);
    rmSync(root, { recursive: true, force: true });
    expect(rebaselined).not.toBeNull();
    expect(findNovel(recheck, rebaselined ?? [])).toEqual([]);
  });
});

describe("the real CLI, run end-to-end against this repo's own tree", () => {
  const scriptPath = join(__dirname, "..", "scripts", "audit-raw-values.mjs");

  it("exits 0 against this repo's committed allowlist", () => {
    const output = execFileSync("node", [scriptPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toMatch(/^audit-raw-values: OK \(\d+ findings, all in allowlist\)/);
  });
});
