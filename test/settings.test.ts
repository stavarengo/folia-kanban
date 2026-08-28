import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  hydrateSettings,
  migratePathKeyedSettings,
  seenMarkerFor,
  withMcpToken,
} from "../src/settings";

const NOW = "2026-08-25 14:00";

describe("hydrateSettings", () => {
  it("stamps the comments baseline on a fresh install and asks for it to be saved", () => {
    const { settings, stampedBaseline } = hydrateSettings(null, NOW);
    expect(stampedBaseline).toBe(true);
    expect(settings.commentsBaseline).toBe(NOW);
    expect(settings).toMatchObject({ ...DEFAULT_SETTINGS, commentsBaseline: NOW });
  });

  it("stamps it on upgrade from a data.json written before the field existed, keeping the rest", () => {
    const { settings, stampedBaseline } = hydrateSettings(
      { userName: "rafa", detailWidth: 420, collapsedCards: { "Tasks/A.md": true } },
      NOW,
    );
    expect(stampedBaseline).toBe(true);
    expect(settings.commentsBaseline).toBe(NOW);
    expect(settings.userName).toBe("rafa");
    expect(settings.detailWidth).toBe(420);
    expect(settings.collapsedCards).toEqual({ "Tasks/A.md": true });
    expect(settings.commentsSeen).toEqual({});
  });

  it("repairs a hand-edited data.json that carries null for a per-card map", () => {
    const { settings } = hydrateSettings({ commentsSeen: null, collapsedCards: null }, NOW);
    expect(settings.commentsSeen).toEqual({});
    expect(settings.collapsedCards).toEqual({});
  });

  it("keeps an existing baseline: it is when tracking started, not the last launch", () => {
    const { settings, stampedBaseline } = hydrateSettings(
      {
        commentsBaseline: "2026-06-01 09:00",
        commentsSeen: { "Tasks/A.md": "2026-06-02 10:00#1" },
      },
      NOW,
    );
    expect(stampedBaseline).toBe(false);
    expect(settings.commentsBaseline).toBe("2026-06-01 09:00");
    expect(settings.commentsSeen).toEqual({ "Tasks/A.md": "2026-06-02 10:00#1" });
  });
});

describe("seenMarkerFor", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    commentsBaseline: "2026-06-01 09:00",
    commentsSeen: { "Tasks/Opened.md": "2026-06-02 10:00#1" },
  };

  it("prefers the card's own marker, and falls back to the baseline for a card never opened", () => {
    expect(seenMarkerFor(settings, "Tasks/Opened.md")).toBe("2026-06-02 10:00#1");
    expect(seenMarkerFor(settings, "Tasks/Fresh.md")).toBe("2026-06-01 09:00");
  });

  it("is undefined without either, so every comment counts as unread", () => {
    expect(seenMarkerFor(DEFAULT_SETTINGS, "Tasks/Fresh.md")).toBeUndefined();
  });
});

describe("migratePathKeyedSettings", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    collapsedCards: { "Tasks/A.md": true, "Notes/N.md": false },
    commentsSeen: { "Tasks/A.md": "2026-08-25 10:00#1" },
  };

  it("follows every path-keyed map through a rename in one patch", () => {
    expect(
      migratePathKeyedSettings(settings, { kind: "rename", from: "Tasks/A.md", to: "Done/A.md" }),
    ).toEqual({
      collapsedCards: { "Done/A.md": true, "Notes/N.md": false },
      commentsSeen: { "Done/A.md": "2026-08-25 10:00#1" },
    });
  });

  it("patches only the maps the operation actually touched", () => {
    expect(migratePathKeyedSettings(settings, { kind: "delete", path: "Notes/N.md" })).toEqual({
      collapsedCards: { "Tasks/A.md": true },
    });
  });

  it("returns an empty patch when the operation misses everything, so nothing is written", () => {
    expect(migratePathKeyedSettings(settings, { kind: "delete", path: "Other/X.md" })).toEqual({});
  });
});

// src/main.ts cannot be imported here (it pulls in the obsidian runtime, which only exists inside
// the app), so reading it as text is what is left. The migration above is worth nothing unless the
// plugin itself listens for the vault operations that drive it — and it has to be the plugin, not
// the board view: the maps are remembered whether or not a board is open.
describe("the plugin follows external file operations", () => {
  const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
  /** `src/main.ts` from the start of `followFileOp` to the end of its body. */
  const followFileOp = (() => {
    const from = main.slice(main.indexOf("private async followFileOp"));
    return from.slice(0, from.indexOf("\n  }"));
  })();

  it("listens to the vault's rename and delete events and routes both into the follow-up", () => {
    for (const event of ["rename", "delete"]) {
      const at = main.indexOf(`this.app.vault.on("${event}"`);
      expect(at, `no vault listener for ${event}`).toBeGreaterThan(-1);
      // The handler, up to the end of its registerEvent call.
      expect(main.slice(at, main.indexOf("\n    );", at))).toContain("this.followFileOp(");
    }
  });

  it("reports a rename in the direction the migration expects", () => {
    // The whole feature inverts silently if these two are swapped: state would be re-keyed onto
    // the path the file just left, which is both stranded and free for an unrelated card to reuse.
    const at = main.indexOf('this.app.vault.on("rename"');
    const handler = main.slice(at, main.indexOf("\n    );", at));
    expect(handler).toContain('kind: "rename", from: oldPath, to: file.path');
  });

  it("runs the path-keyed settings migration, and re-points the markdown-tab record", () => {
    expect(followFileOp).toContain("migratePathKeyedSettings(s, op)");
    // The record is keyed by leaf and holds a path; a WeakMap cannot be walked, so the leaves are.
    expect(followFileOp).toContain("iterateAllLeaves");
    expect(followFileOp).toContain("this.markdownTabs");
    expect(followFileOp).toContain("remapPath(");
  });
});

describe("the agent-access token", () => {
  const mint = () => "minted";

  it("comes into existence the first time agent access is switched on", () => {
    const on = { ...DEFAULT_SETTINGS, mcpEnabled: true };
    expect(withMcpToken(on, mint, true).mcpToken).toBe("minted");
  });

  // A token that changed on each load would break the client configured against it, silently, in
  // the user's own editor.
  it("is kept once it exists, never reissued", () => {
    const settled = { ...DEFAULT_SETTINGS, mcpEnabled: true, mcpToken: "already here" };
    expect(withMcpToken(settled, mint, true)).toBe(settled);
    expect(withMcpToken(settled, mint, true).mcpToken).toBe("already here");
  });

  it("is not minted while agent access is off", () => {
    expect(withMcpToken(DEFAULT_SETTINGS, mint, true)).toBe(DEFAULT_SETTINGS);
  });

  // The rows are hidden on mobile, but a vault synced from a desktop arrives with the setting on;
  // a phone that cannot host the server has no business holding its secret.
  it("is not minted on a platform that cannot host the server", () => {
    const on = { ...DEFAULT_SETTINGS, mcpEnabled: true };
    expect(withMcpToken(on, mint, false)).toBe(on);
    expect(withMcpToken(on, mint, false).mcpToken).toBe("");
  });

  // How the plugin loads its settings, in one line: this pairing is what stops an enabled-but
  // tokenless data.json — hand-edited, or synced back from a phone that could not mint one — from
  // leaving the toggle reading on with nothing listening. A server that is never asked to start
  // never fails, so nothing would have told the user either.
  it("repairs settings that arrive switched on with no token, the way loading does", () => {
    const stored = { mcpEnabled: true, mcpToken: "" };
    const { settings } = hydrateSettings(stored, NOW);
    expect(settings.mcpToken).toBe("");
    const repaired = withMcpToken(settings, mint, true);
    expect(repaired.mcpToken).toBe("minted");
    // Not the same object, which is what tells the caller to persist it.
    expect(repaired).not.toBe(settings);
  });
});
