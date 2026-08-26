import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  hydrateSettings,
  migratePathKeyedSettings,
  seenMarkerFor,
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

  it("listens to the vault's rename and delete events", () => {
    expect(main).toContain('this.app.vault.on("rename"');
    expect(main).toContain('this.app.vault.on("delete"');
  });

  it("runs the path-keyed settings migration on them", () => {
    expect(main).toContain("migratePathKeyedSettings");
  });
});
