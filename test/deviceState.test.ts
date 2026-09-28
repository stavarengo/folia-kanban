import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DeviceStateStore,
  remapDeviceState,
  legacyCollapsedCards,
  splitDevicePatch,
} from "../src/deviceState";
import {
  hydrateSettings,
  migratePathKeyedSettings,
  settingsForDisk,
  type BoardSettings,
} from "../src/settings";
import type { FileOp } from "../src/model/pathOps";
import { DEFAULT_BOARD_SETTINGS } from "./boardSettings";
import { MemoryLocalStore } from "./localStoreFake";

const NOW = "2026-09-29 10:00";
const KEY = "folia-kanban.collapsed-cards";

/** What `loadSettings` does with a `data.json`: settle this device's state from local storage or the
 *  old key, and hydrate the file into what is written back. */
function load(file: unknown, store: MemoryLocalStore) {
  const states = new DeviceStateStore(store);
  states.load(legacyCollapsedCards(file));
  const { stored } = hydrateSettings(file, NOW);
  return { states, device: states.current, stored, written: settingsForDisk(stored) };
}

describe("collapse state moving out of data.json", () => {
  it("takes the map an older build left in data.json into local storage", () => {
    const store = new MemoryLocalStore();
    const { device } = load({ userName: "rafa", collapsedCards: { "Tasks/A.md": true } }, store);
    expect(device.collapsedCards).toEqual({ "Tasks/A.md": true });
    expect(store.load(KEY)).toEqual({ "Tasks/A.md": true });
  });

  // An older build on another device still reads and writes the shared map there. Taking it out
  // would reset that device's collapse state on every write this one makes, until it upgrades.
  it("leaves the key in data.json exactly as it found it", () => {
    const legacy = { "Tasks/A.md": true, "Tasks/B.md": false };
    const { written } = load({ settingsFormat: 2, collapsedCards: legacy }, new MemoryLocalStore());
    expect(written).toHaveProperty("collapsedCards", legacy);
  });

  it("never writes it: a board write changes this device's state, and the key stays as it was", () => {
    const legacy = { "Tasks/A.md": true };
    const { stored } = load({ settingsFormat: 2, collapsedCards: legacy }, new MemoryLocalStore());
    const { synced } = splitDevicePatch({
      collapsedCards: { "Tasks/A.md": false, "Tasks/C.md": true },
      commentsSeen: { "Tasks/A.md": "2026-09-29 09:00#1" },
    } satisfies Partial<BoardSettings>);
    // What `applyToStored` makes of the synced half: the only way anything reaches `data.json`.
    const next = settingsForDisk({ ...stored, ...synced });
    expect(next).toHaveProperty("collapsedCards", legacy);
    expect(next).toHaveProperty("commentsSeen", { "Tasks/A.md": "2026-09-29 09:00#1" });
  });

  it("takes it once: a later load does not overwrite what this device holds", () => {
    const store = new MemoryLocalStore();
    load({ collapsedCards: { "Tasks/A.md": true } }, store);
    // The older build on the other device has since toggled cards of its own.
    const second = load({ collapsedCards: { "Tasks/A.md": false, "Tasks/B.md": true } }, store);
    expect(second.device.collapsedCards).toEqual({ "Tasks/A.md": true });
    expect(store.load(KEY)).toEqual({ "Tasks/A.md": true });
  });

  it("gives a device with nothing to take a state of its own, so no later file can import one", () => {
    const store = new MemoryLocalStore();
    expect(load({ userName: "rafa" }, store).device.collapsedCards).toEqual({});
    expect(load({ collapsedCards: { "Tasks/A.md": true } }, store).device.collapsedCards).toEqual(
      {},
    );
  });

  it("does not write local storage again once it holds a state", () => {
    const store = new MemoryLocalStore();
    load(null, store);
    const writes = store.writes;
    load(null, store);
    expect(store.writes).toBe(writes);
  });

  it("reads a corrupt local storage entry as absent rather than trusting it", () => {
    for (const corrupt of ["yes", 42, ["Tasks/A.md"], null]) {
      const store = new MemoryLocalStore();
      store.save(KEY, corrupt);
      const { device } = load({ collapsedCards: { "Tasks/B.md": true } }, store);
      expect(device.collapsedCards, JSON.stringify(corrupt)).toEqual({ "Tasks/B.md": true });
      expect(store.load(KEY)).toEqual({ "Tasks/B.md": true });
    }
  });

  it("keeps the usable entries of a map that carries a bad one", () => {
    const store = new MemoryLocalStore();
    const { device } = load(
      { collapsedCards: { "Tasks/A.md": true, "Tasks/B.md": "oops" } },
      store,
    );
    expect(device.collapsedCards).toEqual({ "Tasks/A.md": true });
    store.save(KEY, { "Tasks/A.md": false, "Tasks/C.md": 1 });
    expect(load(null, store).device.collapsedCards).toEqual({ "Tasks/A.md": false });
  });

  it("still loads when local storage holds text that does not parse", () => {
    const store = new MemoryLocalStore();
    store.entries.set(KEY, "{not json");
    const { device } = load({ collapsedCards: { "Tasks/A.md": true } }, store);
    expect(device.collapsedCards).toEqual({ "Tasks/A.md": true });
    expect(store.load(KEY)).toEqual({ "Tasks/A.md": true });
  });

  it("still loads when local storage refuses the first write", () => {
    const store = new MemoryLocalStore();
    store.save = () => {
      throw new Error("QuotaExceededError");
    };
    const { device } = load({ collapsedCards: { "Tasks/A.md": true } }, store);
    expect(device.collapsedCards).toEqual({ "Tasks/A.md": true });
  });

  it("starts from nothing when the old value is not a map", () => {
    expect(load({ collapsedCards: null }, new MemoryLocalStore()).device.collapsedCards).toEqual(
      {},
    );
    expect(legacyCollapsedCards(null)).toBeUndefined();
    expect(legacyCollapsedCards({ userName: "rafa" })).toBeUndefined();
  });

  it("survives a restart: what a toggle wrote is what the next load reads", () => {
    const store = new MemoryLocalStore();
    const { states } = load(null, store);
    states.update({ collapsedCards: { "Tasks/A.md": true } });
    expect(states.current.collapsedCards).toEqual({ "Tasks/A.md": true });
    expect(load(null, store).device.collapsedCards).toEqual({ "Tasks/A.md": true });
  });

  it("keeps a toggle in memory when local storage refuses to write it", () => {
    const store = new MemoryLocalStore();
    const { states } = load(null, store);
    store.save = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => states.update({ collapsedCards: { "Tasks/A.md": true } })).toThrow();
    expect(states.current.collapsedCards).toEqual({ "Tasks/A.md": true });
  });
});

describe("a board write, split between the two stores", () => {
  it("sends a collapse toggle to this device only, leaving nothing for data.json", () => {
    const { device, synced } = splitDevicePatch({ collapsedCards: { "Tasks/A.md": true } });
    expect(device).toEqual({ collapsedCards: { "Tasks/A.md": true } });
    expect(synced).toEqual({});
  });

  it("sends everything else to data.json", () => {
    const patch: Partial<BoardSettings> = { commentsSeen: { "Tasks/A.md": "2026-09-29 09:00#1" } };
    const { device, synced } = splitDevicePatch(patch);
    expect(device).toEqual({});
    expect(synced).toEqual({ commentsSeen: { "Tasks/A.md": "2026-09-29 09:00#1" } });
  });
});

describe("a card renamed or deleted from outside the board", () => {
  const settings: BoardSettings = {
    ...DEFAULT_BOARD_SETTINGS,
    collapsedCards: { "Tasks/A.md": true, "Notes/N.md": false },
    commentsSeen: { "Tasks/A.md": "2026-09-29 09:00#1" },
  };
  // What `followFileOp` hands `updateSettings`, split the way `updateSettings` splits it.
  const follow = (op: FileOp) =>
    splitDevicePatch({
      ...migratePathKeyedSettings(settings, op),
      ...remapDeviceState(settings, op),
    });

  it("carries collapse state along on this device, and the read markers along in data.json", () => {
    const { device, synced } = follow({ kind: "rename", from: "Tasks/A.md", to: "Done/A.md" });
    expect(device).toEqual({ collapsedCards: { "Done/A.md": true, "Notes/N.md": false } });
    expect(synced).toEqual({ commentsSeen: { "Done/A.md": "2026-09-29 09:00#1" } });
  });

  it("drops both for a deleted card", () => {
    const { device, synced } = follow({ kind: "delete", path: "Tasks/A.md" });
    expect(device).toEqual({ collapsedCards: { "Notes/N.md": false } });
    expect(synced).toEqual({ commentsSeen: {} });
  });

  it("touches neither when the operation misses every card", () => {
    expect(follow({ kind: "delete", path: "Other/X.md" })).toEqual({ device: {}, synced: {} });
  });
});

// `src/main.ts` cannot be imported here (see settings.test.ts), so its half of the wiring is read
// as text: a collapse toggle must not reach `saveData`, and the file-op path must reach both stores.
describe("the plugin never writes collapse state to data.json", () => {
  const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
  const bodyOf = (signature: string): string => {
    const from = main.slice(main.indexOf(signature));
    return from.slice(0, from.indexOf("\n  }\n"));
  };

  it("writes data.json from a board write only when the settings part changed", () => {
    const body = bodyOf("async updateSettings(");
    expect(body).toContain("splitDevicePatch(");
    expect(body).toContain("this.device.update(device)");
    const guard = body.indexOf("if (syncedChanged) {");
    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf("this.saveSettings()")).toBeGreaterThan(guard);
    expect(body.split("this.saveSettings()")).toHaveLength(2);
    // The synced half is applied before local storage is written, and persisted whatever that
    // write does, so a refused write cannot strand a read marker on a renamed card's old path.
    expect(body.indexOf("this.applyToStored(synced)")).toBeGreaterThan(-1);
    expect(body.indexOf("this.applyToStored(synced)")).toBeLessThan(
      body.indexOf("this.device.update(device)"),
    );
    expect(body.indexOf("} finally {")).toBeGreaterThan(-1);
    expect(body.indexOf("} finally {")).toBeLessThan(body.indexOf("this.saveSettings()"));
  });

  it("settles this device's state from the file it loaded, and hydrates that file whole", () => {
    const body = bodyOf("async loadSettings(");
    expect(body).toContain("this.device.load(legacyCollapsedCards(loaded))");
    expect(body).toContain("hydrateSettings(loaded, stamp())");
  });

  it("follows a file operation in both stores", () => {
    const body = bodyOf("private async followFileOp(");
    expect(body).toContain("remapDeviceState(s, op)");
  });

  it("reaches local storage only from main.ts or the adapter", () => {
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/LocalStorage\(/.test(readFileSync(path, "utf8")))
          callers.push(path.slice(process.cwd().length + 1));
      }
    };
    walk(resolve(process.cwd(), "src"));
    expect(callers).toContain("src/main.ts");
    expect(callers.filter((p) => p !== "src/main.ts" && !p.startsWith("src/obsidian/"))).toEqual(
      [],
    );
  });
});
