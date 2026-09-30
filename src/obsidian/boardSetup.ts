import type { MarkdownFileInfo, Menu, PaneType, Plugin, TAbstractFile } from "obsidian";
import { Keymap, MarkdownView, Notice, TFile, TFolder, type App } from "obsidian";
import type { KanbanSettings } from "../settings";
import {
  NEW_BOARD_BASENAME,
  applyBoardFrontmatter,
  boardNoteBody,
  cardFolderFor,
  uniqueNotePath,
} from "./boardNote";
import { pathTaken } from "./pathTaken";
import type { BoardTabs } from "./boardTabs";

export class BoardSetup {
  constructor(
    private app: App,
    private tabs: BoardTabs,
    /** The settings as they are now: each entry point reads its toggle when it runs. */
    private settings: () => KanbanSettings,
  ) {}

  /**
   * The two guided ways to get a board: make one, or turn the note you are on into one. Every
   * entry point is registered once and reads its toggle when it runs — a command through its
   * `checkCallback`, a menu through the handler Obsidian calls fresh on every open — so turning one
   * off in the settings takes effect immediately, with nothing to unregister.
   */
  register(plugin: Plugin): void {
    plugin.addCommand({
      id: "create-board",
      name: "Create board",
      checkCallback: (checking) => {
        if (!this.settings().boardSetupCommands) return false;
        if (!checking) void this.createBoard(null);
        return true;
      },
    });
    plugin.addCommand({
      id: "convert-note-to-board",
      name: "Convert this note into a board",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.settings().boardSetupCommands || !this.canConvert(file)) return false;
        if (!checking) void this.convertToBoard(file);
        return true;
      },
    });
    plugin.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) =>
        this.addBoardSetupMenuItems(menu, file, this.settings().boardSetupFileMenu),
      ),
    );
    plugin.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, info: MarkdownFileInfo) =>
        this.addBoardSetupMenuItems(menu, info.file, this.settings().boardSetupEditorMenu),
      ),
    );
  }

  /** A note can be converted when it is Markdown and is not a board already. */
  private canConvert(file: TAbstractFile | null): file is TFile {
    return file instanceof TFile && file.extension === "md" && !this.tabs.isBoard(file);
  }

  private addBoardSetupMenuItems(menu: Menu, target: TAbstractFile | null, enabled: boolean): void {
    if (!enabled) return;
    if (target instanceof TFolder) {
      menu.addItem((item) =>
        item
          .setTitle("Create Folia board here")
          .setIcon("layout-grid")
          .onClick((evt) => void this.createBoard(target, Keymap.isModEvent(evt))),
      );
      return;
    }
    if (this.canConvert(target)) {
      const file = target;
      menu.addItem((item) =>
        item
          .setTitle("Convert to Folia board")
          .setIcon("layout-grid")
          .onClick((evt) => void this.convertToBoard(file, Keymap.isModEvent(evt))),
      );
    }
  }

  /** Make a note that is already a board. `parent` is the folder the user right-clicked; without
   *  one, the note lands wherever Obsidian's own "new note location" setting puts new notes — which
   *  is why the active file is passed along, since one of the settings means "beside it". */
  private async createBoard(
    parent: TFolder | null,
    newLeaf: PaneType | boolean = false,
  ): Promise<void> {
    try {
      const source = this.app.workspace.getActiveFile()?.path ?? "";
      const folder = parent ?? this.app.fileManager.getNewFileParent(source);
      const path = uniqueNotePath(folder.path, NEW_BOARD_BASENAME, pathTaken(this.app.vault));
      const title = path.slice(path.lastIndexOf("/") + 1, -".md".length);
      await this.makeBoard(await this.app.vault.create(path, boardNoteBody(title)), newLeaf);
    } catch (e) {
      new Notice(`Folia Kanban: could not create the board note. ${String(e)}`, 8000);
    }
  }

  /** Add the board properties to a note that already exists. */
  private async convertToBoard(file: TFile, newLeaf: PaneType | boolean = false): Promise<void> {
    try {
      await this.makeBoard(file, newLeaf);
    } catch (e) {
      new Notice(`Folia Kanban: could not convert this note into a board. ${String(e)}`, 8000);
    }
  }

  /** The one step both guided paths share: write the board properties through Obsidian's own
   *  frontmatter API — which is what puts them at the very top, whether or not the note had any —
   *  give the board a card folder of its own, and show it. */
  private async makeBoard(file: TFile, newLeaf: PaneType | boolean): Promise<void> {
    // The tab the board will land in is settled first, because it is also the one whose editor has
    // to be flushed *before* the write. A note being typed in has a buffer ahead of the disk, and
    // the tab swap writes that buffer out when the editor closes — after the properties have landed,
    // which would take them straight back out again. Only this one tab is saved: another tab on the
    // same note has its own buffer, and saving that one too would let it overwrite this one.
    const open = this.tabs.leafShowing("markdown", file.path);
    if (open?.view instanceof MarkdownView) await open.view.save();

    const cards = cardFolderFor(file.parent?.path ?? "", pathTaken(this.app.vault));
    let ownFolder = false;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      ownFolder = applyBoardFrontmatter(frontmatter, cards.property);
    });
    // A board opens fine without the folder — the first card creates it — so a failure here is a
    // nicety lost, not a step missed. Having it is what makes the first open an empty board rather
    // than the notice about a folder that is not there.
    if (ownFolder) await this.app.vault.createFolder(cards.path).catch(() => {});

    // Straight to the board view rather than through the file-open redirect: that one asks the
    // metadata cache what the note is, and the cache has not read the frontmatter written a moment
    // ago, so it would answer "ordinary note" and leave the user in the editor. A tab holding some
    // *other* board is left alone too, which is where `openBoard` would have put this one. A
    // modifier asks for a new pane, and leaves the note's editor where it is.
    const leaf = newLeaf
      ? this.app.workspace.getLeaf(newLeaf)
      : (open ?? this.app.workspace.getLeaf(true));
    await this.tabs.showBoardIn(leaf, file.path, true);
    await this.app.workspace.revealLeaf(leaf);
  }
}
