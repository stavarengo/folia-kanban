import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  adoptExternalSettings,
  SETTINGS_FORMAT,
  SETTINGS_FORMAT_KEY,
  hydrateSettings,
  migratePathKeyedSettings,
  resolveSettings,
  seenMarkerFor,
  settingsForDisk,
  peekStoredMcpToken,
  withoutStoredMcpToken,
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

  it("keeps the token where the vault cannot carry it, and writes the file that gave one up", () => {
    const from = main.slice(main.indexOf("async loadSettings"));
    const body = from.slice(0, from.indexOf("\n  }"));
    // Read first, migrate second: a secret already held is the newer of the two, and reading it
    // after the migration would let a synced data.json overwrite a token replaced here.
    expect(body.indexOf("readMcpToken(this.app)")).toBeGreaterThan(-1);
    expect(body.indexOf("readMcpToken(this.app)")).toBeLessThan(
      body.indexOf("this.takeTokenOutOfStored()"),
    );
    expect(body).toContain("if (needsSave || migrated) await this.saveSettings();");
  });

  // The token reaching `data.json` again is the defect this whole arrangement exists to prevent,
  // and it would be silent: the file is still written, still readable, still correct in every other
  // way. The only place a value joins the stored set is `applyToStored`, so a token can only get
  // back in through a settings patch carrying one.
  it("never puts the token into the set it writes to disk", () => {
    expect(main).not.toContain("mcpToken:");
    expect(main).toContain('private mcpToken = "";');
  });

  // Order is the whole safety of the migration. Obsidian refuses to keep a secret on a machine with
  // no secure storage, and dropping the key first would make the move a deletion: gone from the
  // file, held by nothing. So the write comes first and the key only goes once it succeeded.
  it("keeps the token before it stops keeping the file's copy of it", () => {
    const from = main.slice(main.indexOf("private takeTokenOutOfStored"));
    const body = from.slice(0, from.indexOf("\n  }"));
    expect(body.indexOf("writeMcpToken(this.app, legacy)")).toBeLessThan(
      body.indexOf("withoutStoredMcpToken(this.stored)"),
    );
    // And a refusal leaves the file exactly as it was, rather than reporting a migration that did
    // not happen — a `true` here would have the settings written back without the key.
    expect(body).toContain("return false;");
  });
});

// The token is a credential for a server one machine hosts, and `data.json` travels with the vault
// — through Sync, a git remote, a backup, onto every device the vault is opened on. It lives in
// `App.secretStorage` now, which does not travel; what is left here is getting it out of the files
// that were written before that.
describe("the agent-access token leaving data.json", () => {
  it("is not a setting any more, so nothing can write it back by writing settings", () => {
    expect("mcpToken" in DEFAULT_SETTINGS).toBe(false);
    expect(Object.keys(settingsForDisk({ commentsBaseline: NOW }))).not.toContain("mcpToken");
  });

  // Read and removal are separate calls on purpose: the key must not leave the file until the token
  // is safely in secret storage, and a store that refuses would otherwise turn the migration into a
  // deletion. So reading leaves the set exactly as it was.
  it("is handed over without being taken out, and taken out on its own", () => {
    const stored: StoredSettings = { commentsBaseline: NOW };
    (stored as Record<string, unknown>)["mcpToken"] = "carried in the vault";
    expect(peekStoredMcpToken(stored)).toBe("carried in the vault");
    expect(peekStoredMcpToken(stored)).toBe("carried in the vault");
    expect(withoutStoredMcpToken(stored)).toEqual({ commentsBaseline: NOW });
    expect(peekStoredMcpToken(stored)).toBe("carried in the vault");
  });

  // Two different files say "nothing to keep": one that never had the key, and one written by a
  // build that had the setting but never switched agent access on. They must not answer the same
  // way. Only the first is a file with nothing to do; the second still has to be written, and
  // reading it as "nothing to do" would leave the key on disk for good while the set in memory no
  // longer has it — which then reads as an external change on every later write.
  it("tells a file with no key from one whose key is empty, because only one needs writing", () => {
    expect(peekStoredMcpToken({ commentsBaseline: NOW })).toBeNull();
    const empty: StoredSettings = { commentsBaseline: NOW };
    (empty as Record<string, unknown>)["mcpToken"] = "";
    expect(peekStoredMcpToken(empty)).toBe("");
    expect(withoutStoredMcpToken(empty)).toEqual({ commentsBaseline: NOW });
  });

  // A hand-edited file can carry anything where the token was. There is nothing to migrate, but the
  // key still goes, and the file still gets written.
  it("drops a key holding something that is not a token at all", () => {
    const junk: StoredSettings = { commentsBaseline: NOW };
    (junk as Record<string, unknown>)["mcpToken"] = { was: "hand-edited" };
    expect(peekStoredMcpToken(junk)).toBe("");
    expect(withoutStoredMcpToken(junk)).toEqual({ commentsBaseline: NOW });
  });

  // The whole migration, end to end: a file written by the old build is read, the token is taken
  // out, and what would go back to disk no longer carries it. `hydrateSettings` has to leave the
  // key alone for this to work — it is no longer one of `DEFAULT_SETTINGS`, so nothing prunes it.
  it("survives a load of a file written before the move, and does not go back", () => {
    const legacy = onDisk({ commentsBaseline: NOW, mcpEnabled: true });
    legacy["mcpToken"] = "written by the old build";
    const { stored } = hydrateSettings(legacy, NOW);
    expect(peekStoredMcpToken(stored)).toBe("written by the old build");
    expect(Object.keys(settingsForDisk(withoutStoredMcpToken(stored)))).not.toContain("mcpToken");
  });
});

describe("a data.json changed by Sync or by hand", () => {
  const LOCAL: StoredSettings = {
    commentsBaseline: NOW,
    detailWidth: 420,
    collapsedCards: { "Tasks/A.md": true },
  };

  it("is read, so what the other side wrote is no longer overwritten by this instance", () => {
    const { settings, stored, changedKeys } = adoptExternalSettings(
      onDisk({ ...LOCAL, detailWidth: 520 }),
      LOCAL,
      NOW,
    );
    expect(changedKeys).toEqual(["detailWidth"]);
    expect(settings.detailWidth).toBe(520);
    expect(stored).toEqual({ ...LOCAL, detailWidth: 520 });
  });

  // The write this instance just made comes back as a change to the same file. Answering it with a
  // re-render and a write of our own would be the other device's next external change, and ours
  // again after that.
  it("says nothing changed when the file already holds what this instance does", () => {
    const { changedKeys, needsSave } = adoptExternalSettings(onDisk(LOCAL), LOCAL, NOW);
    expect(changedKeys).toEqual([]);
    expect(needsSave).toBe(false);
  });

  // Two JSON parses of the same content, and two devices that toggled the same cards in a different
  // order, both produce objects whose keys sit in different places.
  it("compares by value, not by the order keys happen to sit in", () => {
    const local: StoredSettings = {
      commentsBaseline: NOW,
      collapsedCards: { "Tasks/A.md": true, "Tasks/B.md": false },
    };
    const { changedKeys } = adoptExternalSettings(
      { collapsedCards: { "Tasks/B.md": false, "Tasks/A.md": true }, commentsBaseline: NOW },
      local,
      NOW,
    );
    expect(changedKeys).toEqual([]);
  });

  it("adopts a setting the other side put back to its default", () => {
    const { settings, stored, changedKeys } = adoptExternalSettings(
      onDisk({ commentsBaseline: NOW, collapsedCards: { "Tasks/A.md": true } }),
      LOCAL,
      NOW,
    );
    expect(changedKeys).toEqual(["detailWidth"]);
    expect("detailWidth" in stored).toBe(false);
    expect(settings.detailWidth).toBe(DEFAULT_SETTINGS.detailWidth);
  });

  // Stamping the moment of the sync instead would count every comment ever written as already read,
  // on a machine where nobody had opened any of those cards.
  it("keeps this instance's comments baseline when the file carries none", () => {
    const { settings, needsSave } = adoptExternalSettings({ detailWidth: 520 }, LOCAL, NOW);
    expect(settings.commentsBaseline).toBe(NOW);
    // The file is missing the marker as well as the baseline, so it is one to write back.
    expect(needsSave).toBe(true);
  });

  // `loadData` answers null for a file that is absent — a git checkout over `.obsidian`, a Sync
  // delete, a half-written file — and reading that as "every setting is unset" would reset the
  // running settings and then write the reset back over the token, the read markers and the rest.
  it("keeps what this instance holds when the file cannot be read at all", () => {
    for (const unreadable of [null, undefined, "", 42, ["a"]]) {
      const { settings, stored, changedKeys, needsSave } = adoptExternalSettings(
        unreadable,
        LOCAL,
        NOW,
      );
      expect({ changedKeys, needsSave }).toEqual({ changedKeys: [], needsSave: false });
      expect(stored).toBe(LOCAL);
      expect(settings.detailWidth).toBe(420);
    }
  });

  it("repairs what a hand-edit left where a value belongs, and asks for the file to be healed", () => {
    const { settings, needsSave } = adoptExternalSettings(
      onDisk({ ...LOCAL, collapsedCards: null as unknown as Record<string, boolean> }),
      LOCAL,
      NOW,
    );
    expect(needsSave).toBe(true);
    expect(settings.collapsedCards).toEqual({});
  });
});

// `src/main.ts` cannot be imported here, so the wiring around the callback is read from the source
// the same way the block above reads it: what the plugin does with an adopted file is half the fix.
describe("the plugin reacts to an external settings change", () => {
  const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
  const method = (name: string): string => {
    const from = main.slice(main.indexOf(name));
    return from.slice(0, from.indexOf("\n  }"));
  };
  const handler = method("override async onExternalSettingsChange");
  const adopt = method("private adopt(");

  it("implements the callback Obsidian offers, without which the change is never seen", () => {
    expect(main).toContain("override async onExternalSettingsChange()");
  });

  it("lets a write of its own settle before reading the file back", () => {
    expect(handler).toContain("await this.pendingWrite");
    expect(handler.indexOf("await this.pendingWrite")).toBeLessThan(
      handler.indexOf("this.loadData()"),
    );
  });

  // Both awaits are a window in which a collapse toggle or a rename can change the settings here.
  // Adopting after one would compare the file against a newer picture and drop it.
  it("starts over if this instance changed its own settings while it was reading", () => {
    expect(handler).toContain("const before = this.stored;");
    expect(handler).toContain("if (this.stored !== before) continue;");
  });

  it("survives a file that cannot be read at all, rather than failing inside the callback", () => {
    expect(handler).toContain("this.loadData().catch(() => null)");
  });

  it("gives up if the plugin unloaded while it was waiting", () => {
    expect(handler.match(/if \(this\.unloaded\) return;/g)).toHaveLength(2);
  });

  it("pushes the adopted settings into the open boards and the running server", () => {
    expect(adopt).toContain("this.refreshViews()");
    expect(adopt).toContain("void this.mcp?.sync(this.settings)");
  });

  // The held rows commit whatever their input holds when focus leaves, read off the DOM. A tab left
  // showing the values from before the change writes them straight back over it.
  it("tells the settings tab, whose rows would otherwise commit what they still show", () => {
    expect(adopt).toContain("this.settingTab?.settingsChangedExternally()");
    const tab = method("settingsChangedExternally(): void {");
    expect(tab).toContain("this.pendingUserName = null;");
    expect(tab).toContain("this.pendingMcpFields = {};");
    // From 1.13 the tab is Obsidian's to draw; emptying its container would replace what it
    // rendered, and what its settings search indexed, with the older imperative rows.
    expect(tab).toContain('requireApiVersion("1.13.0")) this.update()');
  });

  // `data.json` also carries per-card state that ordinary board use elsewhere writes. Redrawing the
  // tab for one of those would throw away a name being typed, for a change it is not showing.
  it("leaves the settings tab alone when no row it draws moved", () => {
    expect(adopt).toContain("Object.prototype.hasOwnProperty.call(SETTING_CONTROLS, key)");
  });

  it("writes back only what this instance decided, never a copy of what it just read", () => {
    expect(adopt).toContain("if (write) void this.saveSettings();");
  });
});
