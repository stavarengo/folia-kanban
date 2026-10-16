import { describe, expect, it } from "vitest";
import type { App, Menu, Plugin } from "obsidian";
import { BoardSetup } from "../src/obsidian/boardSetup";
import type { BoardTabs } from "../src/obsidian/boardTabs";
import { DEFAULT_SETTINGS, type KanbanSettings } from "../src/settings";
import { TFile, TFolder, type TAbstractFile } from "./obsidianFake";

interface Row {
  title?: string;
  icon?: string;
  section?: string;
}

/** A menu that records what each row was given, in the order the rows were added. */
function recordingMenu(): { menu: Menu; rows: Row[] } {
  const rows: Row[] = [];
  const menu = {
    addItem(cb: (item: unknown) => void) {
      const row: Row = {};
      const item = {
        setTitle: (t: string) => ((row.title = t), item),
        setIcon: (i: string) => ((row.icon = i), item),
        setSection: (s: string) => ((row.section = s), item),
        onClick: () => item,
      };
      cb(item);
      rows.push(row);
      return menu;
    },
  };
  return { menu: menu as unknown as Menu, rows };
}

/** Registers the board setup against an app that only keeps the menu handlers it is given. */
function setUp(settings: Partial<KanbanSettings> = {}, boards: string[] = []) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const app = {
    workspace: {
      on: (name: string, fn: (...args: unknown[]) => void) => (handlers.set(name, fn), { name }),
    },
  } as unknown as App;
  const tabs = { isBoard: (f: TFile) => boards.includes(f.path) } as unknown as BoardTabs;
  const plugin = { addCommand: () => {}, registerEvent: () => {} } as unknown as Plugin;
  new BoardSetup(app, tabs, () => ({ ...DEFAULT_SETTINGS, ...settings })).register(plugin);
  const open = (event: "file-menu" | "editor-menu", target: TAbstractFile): Row[] => {
    const { menu, rows } = recordingMenu();
    const handler = handlers.get(event);
    if (event === "file-menu") handler?.(menu, target, "file-explorer-context-menu");
    else handler?.(menu, {}, { file: target });
    return rows;
  };
  return { open };
}

describe("board setup rows in Obsidian's menus", () => {
  it("puts a folder's row beside Obsidian's New note, worded like it", () => {
    expect(setUp().open("file-menu", new TFolder("Projects"))).toEqual([
      { title: "New Folia board", icon: "layout-grid", section: "action-primary" },
    ]);
  });

  it("puts a note's row with the file actions in the file menu, and in no group in the editor", () => {
    const note = new TFile("Projects/Plan.md");
    const row = { title: "Convert to Folia board", icon: "layout-grid" };
    expect(setUp().open("file-menu", note)).toEqual([{ ...row, section: "action" }]);
    expect(setUp().open("editor-menu", note)).toEqual([row]);
  });

  it("offers nothing for a note that is a board already, or one that is not Markdown", () => {
    const { open } = setUp({}, ["Projects/Board.md"]);
    expect(open("file-menu", new TFile("Projects/Board.md"))).toEqual([]);
    expect(open("file-menu", new TFile("Projects/Sketch.canvas"))).toEqual([]);
  });

  it("follows each menu's own setting", () => {
    const { open } = setUp({ boardSetupFileMenu: false });
    expect(open("file-menu", new TFolder("Projects"))).toEqual([]);
    expect(open("editor-menu", new TFile("Projects/Plan.md"))).toHaveLength(1);
    const editorOff = setUp({ boardSetupEditorMenu: false });
    expect(editorOff.open("editor-menu", new TFile("Projects/Plan.md"))).toEqual([]);
  });
});
