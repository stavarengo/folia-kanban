// The Folia Mod: what reaches the vault, and what its scripts do when Claude Code runs them. The
// scripts run for real, through `/bin/sh`, against card files in a temporary folder.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FOLIA_MOD_FILES, writeFoliaMod, type ModStore } from "../src/obsidian/foliaMod";

function memoryStore() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const writes: string[] = [];
  const store: ModStore = {
    exists: async (path) => files.has(path) || folders.has(path),
    mkdir: async (path) => {
      const cut = path.lastIndexOf("/");
      if (cut > 0 && !folders.has(path.slice(0, cut))) throw new Error(`no parent for ${path}`);
      folders.add(path);
    },
    read: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no file ${path}`);
      return text;
    },
    write: async (path, data) => {
      if (!folders.has(path.slice(0, path.lastIndexOf("/"))))
        throw new Error(`no folder for ${path}`);
      files.set(path, data);
      writes.push(path);
    },
  };
  return { store, files, folders, writes };
}

const DIR = ".obsidian/plugins/folia-kanban/folia-mod";

describe("writing the Folia Mod", () => {
  it("writes every file under the mod's folder, creating the folders it needs", async () => {
    const m = memoryStore();
    m.folders.add(".obsidian");
    m.folders.add(".obsidian/plugins");
    m.folders.add(".obsidian/plugins/folia-kanban");
    await writeFoliaMod(m.store, DIR);
    expect([...m.files.keys()].sort()).toEqual(
      Object.keys(FOLIA_MOD_FILES)
        .map((p) => `${DIR}/${p}`)
        .sort(),
    );
    for (const [path, text] of Object.entries(FOLIA_MOD_FILES))
      expect(m.files.get(`${DIR}/${path}`)).toBe(text);
  });

  it("rewrites only a file whose content differs", async () => {
    const m = memoryStore();
    await writeFoliaMod(m.store, DIR);
    m.writes.length = 0;
    await writeFoliaMod(m.store, DIR);
    expect(m.writes).toEqual([]);
    m.files.set(`${DIR}/scripts/stop-hook.sh`, "echo stale\n");
    await writeFoliaMod(m.store, DIR);
    expect(m.writes).toEqual([`${DIR}/scripts/stop-hook.sh`]);
  });
});

describe("the Folia Mod's files", () => {
  const parsed = (path: string): unknown => JSON.parse(FOLIA_MOD_FILES[path] ?? "null");

  it("reaches the board through the session's environment, with no token on disk", () => {
    expect(parsed(".mcp.json")).toEqual({
      mcpServers: {
        "folia-kanban": {
          type: "http",
          url: "${FOLIA_MCP_URL}",
          headers: { Authorization: "Bearer ${FOLIA_MCP_TOKEN}" },
        },
      },
    });
  });

  it("runs its hook before every tool call, through sh, from the plugin's own folder", () => {
    expect(parsed("hooks/hooks.json")).toEqual({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: 'sh "${CLAUDE_PLUGIN_ROOT}/scripts/stop-hook.sh"' },
            ],
          },
        ],
      },
    });
    expect(FOLIA_MOD_FILES).toHaveProperty(["scripts/stop-hook.sh"]);
  });

  // Claude Code names a plugin's server `plugin:<plugin>:<server>` and its tools
  // `mcp__plugin_<plugin>_<server>__<tool>`; the allow rule has to match those.
  it("gives the session its status line and lets the board's tools run unprompted", () => {
    const plugin = parsed(".claude-plugin/plugin.json") as { name: string };
    expect(parsed("session.json")).toEqual({
      statusLine: { type: "command", command: 'sh "$FOLIA_MOD_DIR/scripts/status-line.sh"' },
      permissions: { allow: [`mcp__plugin_${plugin.name}_folia-kanban`] },
    });
    expect(FOLIA_MOD_FILES).toHaveProperty(["scripts/status-line.sh"]);
  });
});

describe("the scripts", () => {
  let root = "";
  let cards = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "folia-mod-"));
    cards = join(root, "Cards");
    mkdirSync(cards);
    for (const [path, text] of Object.entries(FOLIA_MOD_FILES)) {
      mkdirSync(join(root, "mod", path, ".."), { recursive: true });
      writeFileSync(join(root, "mod", path), text);
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function card(name: string, text: string): void {
    writeFileSync(join(cards, name), text);
  }

  function run(script: string, env: Record<string, string>): string {
    return execFileSync("/bin/sh", [join(root, "mod", "scripts", script)], {
      input: '{"hook_event_name":"PreToolUse","tool_name":"Bash"}',
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", ...env },
      encoding: "utf8",
    });
  }

  function hook(name: string, column: string, runId = "abc123"): string {
    return run("stop-hook.sh", {
      FOLIA_CARD_FILE: join(cards, name),
      FOLIA_CARD: `Cards/${name}`,
      FOLIA_COLUMN: column,
      FOLIA_RUN_ID: runId,
    });
  }

  /** The reason of a stop, checked to be the shape that both stops and denies the call. */
  function stopReason(output: string): string {
    const out = JSON.parse(output) as {
      continue: boolean;
      stopReason: string;
      hookSpecificOutput: Record<string, string>;
    };
    expect(out.continue).toBe(false);
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: out.stopReason,
    });
    return out.stopReason;
  }

  const ONE =
    '---\nstatus: "review"\nagent-run: { id: abc123, started: "2026-10-19 14:05", column: review }\n---\n# One\n';

  it("lets the session go on while its card stands in the column with its marker", () => {
    card("One.md", ONE);
    expect(hook("One.md", "review")).toBe("");
  });

  it("stops the session, saying where the card went, once it leaves the column", () => {
    card("One.md", ONE.replace('"review"', "done"));
    expect(stopReason(hook("One.md", "review"))).toBe(
      'Folia: the card "One" left the column review; it is now in done. This session stops here.',
    );
  });

  it("stops when the card has no status at all", () => {
    card("One.md", "---\ntitle: One\n---\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(
      /left the column review and has no status/,
    );
  });

  it("stops when the card went out and back in and a newer run owns it", () => {
    card("One.md", ONE.replace("abc123", "fff000"));
    expect(stopReason(hook("One.md", "review"))).toMatch(/another session now works on it/);
  });

  it("stops once the card no longer carries its marker, which the agent clears as its last step", () => {
    card("One.md", "---\nstatus: review\n---\n");
    expect(stopReason(hook("One.md", "review"))).toBe(
      'Folia: the card "One" no longer carries this session\'s run marker (agent-run). This session stops here.',
    );
  });

  it.each([
    ["single quotes", "status: 'review'"],
    ["a trailing comment", "status: review # set by the board"],
    ["a quoted value and a comment", 'status: "review"   # here'],
  ])("reads a status written with %s", (_label, line) => {
    card("One.md", `---\n${line}\nagent-run: { id: abc123 }\n---\n`);
    expect(hook("One.md", "review")).toBe("");
  });

  it("reads CRLF line endings and a marker written as a block", () => {
    card(
      "One.md",
      '---\r\nstatus: review\r\nagent-run:\r\n  id: "abc123"\r\n  column: review\r\n---\r\n',
    );
    expect(hook("One.md", "review")).toBe("");
    card("One.md", "---\r\nstatus: review\r\nagent-run:\r\n  id: other\r\n---\r\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(/another session/);
  });

  it("reads only the frontmatter block, never a status line in the body", () => {
    card("One.md", "---\nstatus: review\nagent-run: { id: abc123 }\n---\nstatus: done\n");
    expect(hook("One.md", "review")).toBe("");
  });

  it("follows a card renamed since the launch, by its run marker in the same folder", () => {
    card("Renamed.md", ONE);
    card("Other.md", ONE.replace("abc123", "zzz999").replace('"review"', "todo"));
    expect(hook("One.md", "review")).toBe("");
    card("Renamed.md", ONE.replace('"review"', "done"));
    expect(stopReason(hook("One.md", "review"))).toMatch(/now in done/);
  });

  it("does not take a new note at the old name for the renamed card once it has left", () => {
    // Renamed, a new note given the old name, and moved out, all between two tool calls: the
    // board clears the marker on the way out, so no note carries this run any more.
    card("Renamed.md", "---\nstatus: done\n---\n");
    card("One.md", "---\nstatus: review\n---\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(
      /no longer carries this session's run marker/,
    );
  });

  it("reads a marker block with blank lines and comments in it", () => {
    card("One.md", "---\nstatus: review\nagent-run:\n\n  # owner\n  id: fff000\n---\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(/another session/);
  });

  it.each([
    ["an escape it does not decode", 'status: "r\\u00e9vision"', "révision"],
    ["a quoted value that goes on over lines", 'status: "in\n  review"', "in review"],
    ["a plain value that goes on over lines", "status: in\n  review", "in review"],
    ["a number in a form the board turns into another", "status: 2.50", "2.5"],
  ])("goes on when the status is %s", (_label, line, column) => {
    card("One.md", `---\n${line}\nagent-run: { id: abc123 }\n---\n`);
    expect(hook("One.md", column)).toBe("");
  });

  it.each([
    ["TRUE", "true"],
    ["~", ""],
  ])("reads the plain %s the way the board does", (value, read) => {
    card("One.md", `---\nstatus: ${value}\nagent-run: { id: abc123 }\n---\n`);
    if (read) expect(hook("One.md", read)).toBe("");
    else expect(stopReason(hook("One.md", "review"))).toMatch(/has no status now/);
  });

  it("stops when the card left the column, even if a copy of it still carries the marker", () => {
    card("One copy.md", ONE);
    card("One.md", "---\nstatus: done\n---\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(/now in done/);
  });

  it.each([
    ["a flow mapping over several lines", "agent-run: {\n  id: abc123,\n  column: review\n}"],
    ["a block scalar id", "agent-run:\n  id: >-\n    abc123"],
  ])("does not take a marker written as %s for a missing one", (_label, marker) => {
    card("One.md", `---\nstatus: review\n${marker}\n---\n`);
    expect(hook("One.md", "review")).toBe("");
  });

  it("reads a marker set to null as no marker, the way the board does", () => {
    card("One.md", "---\nstatus: review\nagent-run: null\n---\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(/no longer carries/);
  });

  it("stops when the card is nowhere to be found", () => {
    card("Other.md", ONE.replace("abc123", "zzz999"));
    expect(stopReason(hook("One.md", "review"))).toBe(
      'Folia: the card "One" is gone or was moved away. This session stops here.',
    );
  });

  it("stops when the card is a note with no frontmatter any more, as the board reads it", () => {
    card("One.md", "no frontmatter here\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(/has no status now/);
  });

  it("leaves a status it cannot read alone, and a session Folia did not start", () => {
    card("One.md", "---\nstatus: >-\n  review\nagent-run: { id: abc123 }\n---\n");
    expect(hook("One.md", "review")).toBe("");
    expect(run("stop-hook.sh", {})).toBe("");
  });

  it.each([
    ["a quoted key", '"status": review\n"agent-run":\n  "id": abc123', "review"],
    [
      "a single-quoted value with an apostrophe",
      "status: 'Rafa''s review'\nagent-run: { 'id': abc123 }",
      "Rafa's review",
    ],
    [
      "an escaped double quote",
      'status: "say \\"hi\\""\nagent-run: { "id": "abc123" }',
      'say "hi"',
    ],
  ])("reads %s the way YAML does", (_label, lines, column) => {
    card("One.md", `---\n${lines}\n---\n`);
    expect(hook("One.md", column)).toBe("");
  });

  it("sees a newer run behind a quoted key in the marker", () => {
    card("One.md", '---\nstatus: review\nagent-run: {"id": "fff000", "column": "review"}\n---\n');
    expect(stopReason(hook("One.md", "review"))).toMatch(/another session/);
  });

  it("takes the note at the launch path for the card whenever there is one", () => {
    // A copy of the card keeps its marker; the agent's own clear, on the card, still ends it.
    card("One 1.md", ONE);
    card("One.md", "---\nstatus: review\n---\n");
    expect(stopReason(hook("One.md", "review"))).toMatch(
      /no longer carries this session's run marker/,
    );
  });

  it.each([
    ["3-review", "3-review", ""],
    ["4-done", "3-review", "now in 4-done"],
  ])("reads the plain %s as text, not as a number", (value, column, reason) => {
    card("One.md", `---\nstatus: ${value}\nagent-run: { id: abc123 }\n---\n`);
    const out = hook("One.md", column);
    if (reason) expect(stopReason(out)).toContain(reason);
    else expect(out).toBe("");
  });

  it.each([
    ["at the launch path", "One.md"],
    ["renamed", "Renamed.md"],
  ])("never stops a session because reading the card %s failed", (_label, name) => {
    // An awk that runs the hook's small programs but fails on the frontmatter reader.
    const real = execFileSync("/bin/sh", ["-c", "command -v awk"], { encoding: "utf8" }).trim();
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "awk"),
      `#!/bin/sh\ncase "$*" in *"function unquote"*) exit 2 ;; esac\nexec ${real} "$@"\n`,
      { mode: 0o755 },
    );
    card(name, ONE);
    const out = run("stop-hook.sh", {
      PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      FOLIA_CARD_FILE: join(cards, "One.md"),
      FOLIA_CARD: "Cards/One.md",
      FOLIA_COLUMN: "review",
      FOLIA_RUN_ID: "abc123",
    });
    expect(out).toBe("");
  });

  it("keeps the stop reason valid JSON whatever the names hold", () => {
    card('Say "hi".md', '---\nstatus: "a \\\\ b"\n---\n');
    expect(stopReason(hook('Say "hi".md', "review"))).toContain('the card "Say "hi""');
  });

  it("names the board, the card and the column on the status line", () => {
    expect(
      run("status-line.sh", {
        FOLIA_BOARD: "Projects/Launch Board.md",
        FOLIA_CARD: "Projects/Cards/Write the notes.md",
        FOLIA_COLUMN: "review",
      }),
    ).toBe("Launch Board · Write the notes · review\n");
    expect(run("status-line.sh", {})).toBe("");
  });
});
