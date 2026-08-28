import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The ratchet is a CLI script (scripts/audit-raw-values.mjs), not a module of pure functions, and
// it walks a fixed src/ tree by default. AUDIT_ROOT (see the script) redirects that tree to a
// throwaway fixture directory, which lets these tests drive the real CLI end-to-end — same code
// path as `pnpm audit:raw-values` — without depending on or mutating this repo's own findings.
const scriptPath = join(__dirname, "..", "scripts", "audit-raw-values.mjs");

function makeFixture(cssContent: string): string {
  const root = mkdtempSync(join(tmpdir(), "audit-raw-values-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "src", "styles.css"), cssContent);
  return root;
}

function run(root: string, args: string[] = []): { status: number; output: string } {
  try {
    const output = execFileSync("node", [scriptPath, ...args], {
      env: { ...process.env, AUDIT_ROOT: root },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, output: err.stdout + err.stderr };
  }
}

describe("audit-raw-values ratchet counts occurrences per file per snippet", () => {
  it("passes a snippet that occurs exactly as many times as allowlisted", () => {
    const root = makeFixture("a { width: 320px; } b { height: 320px; }");
    writeFileSync(
      join(root, "scripts", "raw-value-allowlist.json"),
      JSON.stringify({ findings: [{ file: "src/styles.css", snippet: "320px", count: 2 }] }),
    );
    const { status, output } = run(root);
    rmSync(root, { recursive: true, force: true });
    expect(status).toBe(0);
    expect(output).toMatch(/OK \(2 findings/);
  });

  it("fails a SECOND, unlisted copy of an already-allowlisted snippet (the bug this guards)", () => {
    const root = makeFixture("a { width: 320px; } b { height: 320px; }");
    writeFileSync(
      join(root, "scripts", "raw-value-allowlist.json"),
      JSON.stringify({ findings: [{ file: "src/styles.css", snippet: "320px", count: 1 }] }),
    );
    const { status, output } = run(root);
    rmSync(root, { recursive: true, force: true });
    expect(status).toBe(1);
    expect(output).toMatch(/FAIL/);
    expect(output).toMatch(/320px \(found 2, allowlisted 1\)/);
  });

  it("--update writes one entry per (file, snippet) with the observed occurrence count", () => {
    const root = makeFixture("a { width: 320px; } b { height: 320px; } c { width: 440px; }");
    run(root, ["--update"]);
    const written = JSON.parse(
      readFileSync(join(root, "scripts", "raw-value-allowlist.json"), "utf8"),
    );
    rmSync(root, { recursive: true, force: true });
    expect(written.findings).toEqual([
      { file: "src/styles.css", snippet: "320px", count: 2 },
      { file: "src/styles.css", snippet: "440px", count: 1 },
    ]);
  });

  it("a freshly written baseline always checks clean, by construction", () => {
    const root = makeFixture("a { width: 320px; } b { height: 320px; } c { width: 440px; }");
    run(root, ["--update"]);
    const { status, output } = run(root);
    rmSync(root, { recursive: true, force: true });
    expect(status).toBe(0);
    expect(output).toMatch(/OK \(3 findings/);
  });
});
