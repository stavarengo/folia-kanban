import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
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

const realScriptPath = join(__dirname, "..", "scripts", "audit-raw-values.mjs");

/**
 * A throwaway copy of the real, UNMODIFIED script deployed at `<root>/scripts/audit-raw-values.mjs`
 * alongside a fixture `src/`, so the actual CLI (`root` computed from its own file location, same
 * as in production) can be exercised end-to-end — including its exit code and stdout/stderr — with
 * no env var, flag, or other override standing in for the real thing. This is deliberately more
 * work than an override would be: the whole point of removing AUDIT_ROOT was that the shipped
 * script takes no parameter that could redirect what it scans.
 */
function makeCliFixture(cssContent: string): { root: string; scriptPath: string } {
  const { root } = makeFixture(cssContent);
  const scriptsDir = join(root, "scripts");
  mkdirSync(scriptsDir);
  const scriptPath = join(scriptsDir, "audit-raw-values.mjs");
  copyFileSync(realScriptPath, scriptPath);
  return { root, scriptPath };
}

function runCli(
  scriptPath: string,
  args: string[] = [],
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, stdout: err.stdout, stderr: err.stderr };
  }
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
  it("exits 0 against this repo's committed allowlist", () => {
    const { stdout, status } = runCli(realScriptPath);
    expect(status).toBe(0);
    expect(stdout).toMatch(
      /^audit-raw-values: OK \(\d+ occurrences, all within what the allowlist tolerates\)/,
    );
  });
});

describe("the real CLI, run end-to-end against a fixture tree (own copy of the script, no override)", () => {
  it("exits 0 and reports OK when the allowlist covers every occurrence", () => {
    const { root, scriptPath } = makeCliFixture("a { width: 320px; }");
    writeFileSync(
      join(root, "scripts", "raw-value-allowlist.json"),
      JSON.stringify({ findings: [{ file: "src/styles.css", snippet: "320px", count: 1 }] }),
    );
    const { status, stdout } = runCli(scriptPath);
    rmSync(root, { recursive: true, force: true });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^audit-raw-values: OK \(1 occurrences/);
  });

  it("exits 1 and names the offending value when a count is exceeded", () => {
    const { root, scriptPath } = makeCliFixture("a { width: 320px; } b { height: 320px; }");
    writeFileSync(
      join(root, "scripts", "raw-value-allowlist.json"),
      JSON.stringify({ findings: [{ file: "src/styles.css", snippet: "320px", count: 1 }] }),
    );
    const { status, stderr } = runCli(scriptPath);
    rmSync(root, { recursive: true, force: true });
    expect(status).toBe(1);
    expect(stderr).toMatch(/FAIL — 1 value\(s\) exceed what the allowlist tolerates/);
    expect(stderr).toContain("320px (found 2, allowlisted 1)");
  });

  it("exits 1 with a clear message when the allowlist file is missing", () => {
    const { root, scriptPath } = makeCliFixture("a { width: 320px; }");
    const { status, stderr } = runCli(scriptPath);
    rmSync(root, { recursive: true, force: true });
    expect(status).toBe(1);
    expect(stderr).toMatch(/missing or invalid/);
  });

  it("--update writes a baseline to the fixture's own allowlist file, and a rerun then passes", () => {
    const { root, scriptPath } = makeCliFixture("a { width: 320px; } b { width: 320px; }");
    const allowlistPath = join(root, "scripts", "raw-value-allowlist.json");
    const first = runCli(scriptPath, ["--update"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/wrote baseline with 1 entries \(2 occurrences\)/);
    const written = JSON.parse(readFileSync(allowlistPath, "utf8"));
    expect(written.findings).toEqual([{ file: "src/styles.css", snippet: "320px", count: 2 }]);
    const second = runCli(scriptPath);
    rmSync(root, { recursive: true, force: true });
    expect(second.status).toBe(0);
  });
});
