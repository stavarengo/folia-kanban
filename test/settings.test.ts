import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_FORMAT,
  SETTINGS_FORMAT_KEY,
  hydrateSettings,
  mcpTokenPatch,
  migratePathKeyedSettings,
  resolveSettings,
  seenMarkerFor,
  settingsForDisk,
  type StoredSettings,
} from "../src/settings";

const NOW = "2026-08-25 14:00";

/** A file already in the sparse shape: what `saveSettings` would have left on disk. */
const onDisk = (stored: StoredSettings): Record<string, unknown> =>
  JSON.parse(JSON.stringify(settingsForDisk(stored))) as Record<string, unknown>;

describe("hydrateSettings", () => {
  it("stamps the comments baseline on a fresh install and asks for it to be saved", () => {
    const { settings, stored, needsSave } = hydrateSettings(null, NOW);
    expect(needsSave).toBe(true);
    expect(settings.commentsBaseline).toBe(NOW);
    expect(settings).toMatchObject({ ...DEFAULT_SETTINGS, commentsBaseline: NOW });
    // The whole point: a fresh install writes what it set, not a copy of every default.
    expect(stored).toEqual({ commentsBaseline: NOW });
    expect(settingsForDisk(stored)).toEqual({
      [SETTINGS_FORMAT_KEY]: SETTINGS_FORMAT,
      commentsBaseline: NOW,
    });
  });

  it("stamps it on upgrade from a data.json written before the field existed, keeping the rest", () => {
    const { settings, needsSave } = hydrateSettings(
      { userName: "rafa", detailWidth: 420, collapsedCards: { "Tasks/A.md": true } },
      NOW,
    );
    expect(needsSave).toBe(true);
    expect(settings.commentsBaseline).toBe(NOW);
    expect(settings.userName).toBe("rafa");
    expect(settings.detailWidth).toBe(420);
    expect(settings.collapsedCards).toEqual({ "Tasks/A.md": true });
    expect(settings.commentsSeen).toEqual({});
  });

  it("repairs a hand-edited data.json that carries null for a per-card map", () => {
    const { settings, stored } = hydrateSettings({ commentsSeen: null, collapsedCards: null }, NOW);
    expect(settings.commentsSeen).toEqual({});
    expect(settings.collapsedCards).toEqual({});
    // Dropped rather than repaired in place, so the next write leaves the file clean.
    expect(stored).not.toHaveProperty("commentsSeen");
    expect(stored).not.toHaveProperty("collapsedCards");
  });

  // It decides where a server listens, so a value the settings tab would never have produced must
  // not reach `listen` — as a non-string it comes back as "could not start on address null".
  it("falls back to loopback when the stored bind address is not an address", () => {
    for (const value of [null, 27125, "", "evil.example", "::ffff:0:0"]) {
      // Marked, so nothing but the repair itself can be what asks for the write.
      const file = onDisk({ commentsBaseline: NOW, mcpBindAddress: value } as StoredSettings);
      const { settings, stored, needsSave } = hydrateSettings(file, NOW);
      expect(settings.mcpBindAddress, String(value)).toBe(DEFAULT_SETTINGS.mcpBindAddress);
      // And it does not come back on the next load: the bad value leaves the file.
      expect(stored, String(value)).not.toHaveProperty("mcpBindAddress");
      expect(needsSave, String(value)).toBe(true);
    }
    expect(hydrateSettings({ mcpBindAddress: "0.0.0.0" }, NOW).settings.mcpBindAddress).toBe(
      "0.0.0.0",
    );
  });

  it("keeps an existing baseline: it is when tracking started, not the last launch", () => {
    const { settings, needsSave } = hydrateSettings(
      onDisk({
        commentsBaseline: "2026-06-01 09:00",
        commentsSeen: { "Tasks/A.md": "2026-06-02 10:00#1" },
      }),
      NOW,
    );
    expect(needsSave).toBe(false);
    expect(settings.commentsBaseline).toBe("2026-06-01 09:00");
    expect(settings.commentsSeen).toEqual({ "Tasks/A.md": "2026-06-02 10:00#1" });
  });
});

// The whole file used to be written on the first launch, so an install upgrading into this build
// arrives with every default frozen in it and no record of which values anyone picked.
describe("hydrateSettings on a file written before settings were sparse", () => {
  const legacy = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
    ...DEFAULT_SETTINGS,
    commentsBaseline: "2026-06-01 09:00",
    ...over,
  });

  it("drops every value equal to its default and keeps every value that is not", () => {
    const { settings, stored, needsSave } = hydrateSettings(
      legacy({ historyScope: "moves", detailWidth: 420, collapsedCards: { "Tasks/A.md": true } }),
      NOW,
    );
    expect(needsSave).toBe(true);
    expect(stored).toEqual({
      historyScope: "moves",
      detailWidth: 420,
      collapsedCards: { "Tasks/A.md": true },
      commentsBaseline: "2026-06-01 09:00",
    });
    // Nothing changes for the user: the pruned settings still resolve to what the file said.
    expect(settings).toEqual(resolveSettings(stored));
    expect(settings.boardPan).toBe(DEFAULT_SETTINGS.boardPan);
  });

  it("prunes once: the marked file it leaves behind is taken at its word next time", () => {
    const first = hydrateSettings(legacy({ historyScope: "moves" }), NOW);
    // What the user then picks in the settings tab, even though it is the default value.
    const chosen: StoredSettings = { ...first.stored, boardPan: DEFAULT_SETTINGS.boardPan };
    const second = hydrateSettings(onDisk(chosen), NOW);
    expect(second.needsSave).toBe(false);
    expect(second.stored).toEqual(chosen);
    // This is the difference between "only what was set" and "only what differs from a default":
    // a deliberate choice that happens to equal the default survives, so a later release changing
    // that default leaves this install alone.
    expect(second.stored.boardPan).toBe(DEFAULT_SETTINGS.boardPan);
  });

  // `userName` is the one where it is visible: cleared on purpose and never set both read as "",
  // and only the stored key tells them apart — which is what a future name inference needs.
  it("keeps a name cleared on purpose apart from a name never set", () => {
    const never = hydrateSettings(onDisk({ commentsBaseline: NOW }), NOW);
    const cleared = hydrateSettings(onDisk({ commentsBaseline: NOW, userName: "" }), NOW);
    expect(never.settings.userName).toBe(cleared.settings.userName);
    expect("userName" in never.stored).toBe(false);
    expect("userName" in cleared.stored).toBe(true);
  });

  // Only the absence of the marker says "written before settings were sparse". A file stamped by a
  // later build already records what was set, and pruning it would delete choices this build cannot
  // recognise — the user's, gone, on the way back to the build that took them.
  it("does not prune a file stamped by a later build", () => {
    const chosen = DEFAULT_SETTINGS.boardPan;
    const { stored, needsSave } = hydrateSettings(
      { [SETTINGS_FORMAT_KEY]: SETTINGS_FORMAT + 1, commentsBaseline: NOW, boardPan: chosen },
      NOW,
    );
    expect(stored).toEqual({ commentsBaseline: NOW, boardPan: chosen });
    expect(needsSave).toBe(false);
  });

  it("carries a key it does not know through untouched, rather than dropping it", () => {
    const withFuture = hydrateSettings(
      { ...onDisk({ commentsBaseline: NOW }), somethingNewer: 7 },
      NOW,
    );
    expect(withFuture.stored).toHaveProperty("somethingNewer", 7);
    expect(withFuture.needsSave).toBe(false);
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

// Same reason as the block above: `src/main.ts` cannot be imported here, and it owns the half of
// this design that no unit test can reach — what actually reaches `saveData`, and whether the token
// minted at load is recorded as set or only held in memory.
describe("the plugin writes only what was set", () => {
  const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");

  it("saves the stored set, not the settings the defaults were merged into", () => {
    expect(main).toContain("this.saveData(settingsForDisk(this.stored))");
    expect(main).not.toContain("this.saveData(this.settings)");
  });

  it("records the token minted at load, so the next launch does not mint another", () => {
    const from = main.slice(main.indexOf("async loadSettings"));
    // Whitespace-insensitive, so where the formatter chose to wrap the call does not decide it.
    const body = from.slice(0, from.indexOf("\n  }"));
    expect(body).toMatch(/this\.applyToStored\(\s*mcpTokenPatch\(/);
    expect(body).toContain("if (needsSave || minted) await this.saveSettings();");
  });
});

describe("the agent-access token", () => {
  const mint = () => "minted";

  it("comes into existence the first time agent access is switched on", () => {
    const on = { ...DEFAULT_SETTINGS, mcpEnabled: true };
    expect(mcpTokenPatch(on, mint, true)).toEqual({ mcpToken: "minted" });
  });

  // A token that changed on each load would break the client configured against it, silently, in
  // the user's own editor.
  it("is kept once it exists, never reissued", () => {
    const settled = { ...DEFAULT_SETTINGS, mcpEnabled: true, mcpToken: "already here" };
    expect(mcpTokenPatch(settled, mint, true)).toEqual({});
  });

  it("is not minted while agent access is off", () => {
    expect(mcpTokenPatch(DEFAULT_SETTINGS, mint, true)).toEqual({});
  });

  // The rows are hidden on mobile, but a vault synced from a desktop arrives with the setting on;
  // a phone that cannot host the server has no business holding its secret.
  it("is not minted on a platform that cannot host the server", () => {
    const on = { ...DEFAULT_SETTINGS, mcpEnabled: true };
    expect(mcpTokenPatch(on, mint, false)).toEqual({});
  });

  // How the plugin loads its settings, in one line: this pairing is what stops an enabled-but
  // tokenless data.json — hand-edited, or synced back from a phone that could not mint one — from
  // leaving the toggle reading on with nothing listening. A server that is never asked to start
  // never fails, so nothing would have told the user either.
  it("repairs settings that arrive switched on with no token, the way loading does", () => {
    const { settings } = hydrateSettings({ mcpEnabled: true, mcpToken: "" }, NOW);
    expect(settings.mcpToken).toBe("");
    expect(mcpTokenPatch(settings, mint, true)).toEqual({ mcpToken: "minted" });
  });

  // The minted token is a patch precisely so it reaches the stored file. Held only in the running
  // settings it would be minted again on the next launch, and the client configured with the old
  // one would stop being able to reach the vault — with nothing said about it.
  it("survives the reload, because minting it is a write like any other", () => {
    const first = hydrateSettings(onDisk({ commentsBaseline: NOW, mcpEnabled: true }), NOW);
    const stored = { ...first.stored, ...mcpTokenPatch(first.settings, mint, true) };
    const second = hydrateSettings(onDisk(stored), NOW);
    expect(second.settings.mcpToken).toBe("minted");
    expect(mcpTokenPatch(second.settings, () => "a different one", true)).toEqual({});
  });
});
