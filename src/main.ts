import type { MarkdownFileInfo, Menu, SettingDefinitionItem, TAbstractFile } from "obsidian";
import {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  View,
  type TextComponent,
  type WorkspaceLeaf,
  type App,
} from "obsidian";
import { KanbanView } from "./view";
import { OPEN_BOARD_COMMAND_NAME, VIEW_TYPE_KANBAN } from "./viewType";
import type { FileOp } from "./model/pathOps";
import { remapPath } from "./model/pathOps";
import { MCP_DEFAULT_BIND_ADDRESS, isLoopbackBindAddress } from "./bindAddress";
import { mcpTokenOutcome } from "./mcp/token";
import {
  DeviceStateStore,
  remapDeviceState,
  splitDevicePatch,
  legacyCollapsedCards,
} from "./deviceState";
import {
  DEFAULT_SETTINGS,
  adoptExternalSettings,
  hydrateSettings,
  migratePathKeyedSettings,
  resolveSettings,
  resolveSettingsPatch,
  peekStoredMcpToken,
  settingsForDisk,
  withoutStoredMcpToken,
  type BoardSettings,
  type KanbanSettings,
  type SettingsPatch,
  type StoredSettings,
} from "./settings";
import {
  heldFieldOutcome,
  settingDefinitions,
  settingsPatchFor,
  type HeldFieldKey,
} from "./obsidian/settingsDefinitions";
import {
  ABOUT_HEADING,
  MCP_TOKEN_COPY,
  MCP_TOKEN_REGENERATE,
  MCP_TOKEN_UNAVAILABLE,
  SETTING_CONTROLS,
  SETTING_COPY,
  SETTING_GROUPS,
  TAB_REDRAW_KEYS,
  VERSION_SETTING_NAME,
  bindAddressConfirm,
  isRowDisabled,
  splitHeldPatch,
  type EditableSettingKey,
} from "./settingsLayout";
import {
  NEW_BOARD_BASENAME,
  applyBoardFrontmatter,
  boardNoteBody,
  cardFolderFor,
  uniqueNotePath,
} from "./boardNote";
import {
  McpService,
  newMcpToken,
  readMcpToken,
  writeMcpToken,
  type McpState,
} from "./obsidian/mcpService";
import { refreshDeclarativeSettingTab, setSettingError } from "./obsidian/compat";
import { confirmAction } from "./obsidian/dialogs";
import { stamp } from "./model/dates";
import { isBoardFrontmatter } from "./obsidian/viewMode";
import { markdownTabOutcome } from "./obsidian/boardRedirect";
import { pathTaken } from "./obsidian/pathTaken";

/** Re-point, or drop, a per-tab path record after a rename or delete. */
function follow<K extends object>(record: WeakMap<K, string>, key: K, op: FileOp): void {
  const current = record.get(key);
  if (current === undefined) return;
  const next = remapPath(current, op);
  if (next === null) record.delete(key);
  else if (next !== current) record.set(key, next);
}

export default class FoliaKanbanPlugin extends Plugin {
  override settings: KanbanSettings = DEFAULT_SETTINGS;

  /** What is kept on disk: only the settings someone actually set. `settings` above is this
   *  resolved against `DEFAULT_SETTINGS`, and every write goes through {@link applyToStored} so the
   *  two cannot drift. */
  private stored: StoredSettings = {};

  /** What this device keeps for itself, in local storage rather than `data.json`. Boards see it
   *  merged into the settings, and {@link updateSettings} splits their writes between the two. */
  private readonly device = new DeviceStateStore({
    load: (key) => this.app.loadLocalStorage(key) as unknown,
    save: (key, value) => this.app.saveLocalStorage(key, value),
  });

  /** Tabs the user sent to the Markdown editor with the button, and the note they did it for.
   *  Nothing else ever writes to this: it records a decision a person made, never a guess about
   *  one. Keyed on the leaf so it dies with the tab, and scoped to the file so the decision does
   *  not follow the tab to some other note. Without it, going Back to a tab you had put in the
   *  editor would land on the board instead — Obsidian replays the tab's *state*, which reaches
   *  the same redirect as a fresh open. */
  private readonly markdownTabs = new WeakMap<WorkspaceLeaf, string>();

  /** The note {@link redirectToBoard} last decided about in each Markdown editor. `active-leaf-change`
   *  also fires for a plain switch back to a tab, which is not an open: a note that gained
   *  `folia-board` in the editor would otherwise turn into the board the next time its tab came
   *  forward. Keyed on the editor rather than the tab, because a tab that shows something else in
   *  between gets a new editor, and opening the note in it again is an open. It also keeps the
   *  second of the two events one open fires from swapping the tab again. */
  private readonly decided = new WeakMap<MarkdownView, string>();

  /** Tabs that opened a note the metadata cache had not read yet, asked about again once it has.
   *  Only these: a note that gains `folia-board` while it is open is never swapped. */
  private readonly coldOpens = new WeakMap<WorkspaceLeaf, string>();

  /** The "back to the board" header button each Markdown editor has. `addAction` hands back the
   *  element and offers no way to remove an action, so this is the only handle for taking it off. */
  private readonly boardActions = new WeakMap<MarkdownView, HTMLElement>();

  private unloaded = false;

  /** Tail of the settings-write chain; see {@link saveSettings}. */
  private pendingWrite: Promise<void> = Promise.resolve();

  /** The settings tab, kept so a change arriving from outside can reach the rows it is showing. */
  private settingTab: KanbanSettingTab | null = null;

  /** The MCP server's lifetime. Null where the plugin never hosts one — see {@link buildMcp}. */
  private mcp: McpService | null = null;

  /**
   * The bearer token agents authenticate with, held here rather than in {@link settings} because it
   * is a credential and the settings travel with the vault. `App.secretStorage` is where it lives
   * between launches; this is the copy the running server and the settings tab read. "" means none
   * has been minted, which is also what keeps the server off.
   */
  private mcpToken = "";

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_KANBAN,
      (leaf) =>
        new KanbanView(
          leaf,
          () => this.boardSettings(),
          (p) =>
            void this.updateSettings(p).catch((e: unknown) => {
              // Nothing awaits a board's write, so a refused one would otherwise be an unhandled
              // rejection. What the board shows is already applied; only keeping it failed.
              new Notice(`Folia Kanban: could not save a board change. ${String(e)}`, 8000);
            }),
          (view) => {
            const file = view.file;
            if (file) void this.showMarkdownIn(view.leaf, file.path);
          },
        ),
    );

    this.addRibbonIcon("layout-grid", "Open Folia Kanban board", () => void this.activateView());
    this.addCommand({
      id: "folia-open-kanban-board",
      name: OPEN_BOARD_COMMAND_NAME,
      callback: () => void this.activateView(),
    });
    this.registerBoardSetupActions();

    this.settingTab = new KanbanSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.buildMcp();

    // Every route that opens a note — the explorer, a link, search, the quick switcher, Back and
    // Forward — ends with the note active in a Markdown tab. `file-open` catches the active tab
    // changing its note; `active-leaf-change` catches a tab opened in the background or restored
    // deferred, which shows its note only once it is brought forward.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) void this.redirectOpenOf(file);
        this.syncMarkdownActions();
      }),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncMarkdownActions()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.redirectToBoard(leaf);
        this.syncMarkdownActions();
      }),
    );
    // The button follows the flag: a note that gains or loses `folia-board` while it is open
    // gains or loses the button, but the tab is never swapped out from under the user.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (this.coldOpens.get(leaf) !== file.path) return;
          this.coldOpens.delete(leaf);
          if (leaf.view instanceof MarkdownView && leaf.view.file === file)
            this.redirectToBoard(leaf);
        });
        this.syncMarkdownActions();
      }),
    );
    // Everything the plugin remembers by path follows the file it is about. The vault reports
    // every rename and delete, the plugin's own included, and the follow-up is idempotent, so
    // there is nothing to tell apart. It lives here rather than in the board view because the
    // plugin remembers these things whether or not a board is open: a rename done with no board
    // tab in sight would otherwise strand them, and a card later created at the vacated path
    // would silently inherit them.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.followFileOp({ kind: "rename", from: oldPath, to: file.path });
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        void this.followFileOp({ kind: "delete", path: file.path });
      }),
    );
    // Without this, disabling the plugin leaves its buttons in the headers of open notes, still
    // clickable, still calling into a view type Obsidian no longer knows about.
    this.register(() => {
      this.unloaded = true;
      this.removeMarkdownActions();
      void this.mcp?.stop();
    });
    // `onLayoutReady` cannot be unregistered, and it can still fire after an unload that happened
    // during startup — which would put the buttons straight back, wired to a view type Obsidian
    // no longer has.
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      // The tab restored in front was opened before this plugin could listen for it.
      this.redirectToBoard(this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null);
      this.syncMarkdownActions();
      // Only now: the tools read board notes out of the metadata cache, and until the layout is
      // ready that cache is still filling — an agent connecting in the first seconds would be told
      // this vault has no boards.
      void this.mcp?.sync(this.settings);
    });
  }

  /**
   * Show a board note that has just come up in a Markdown tab as the board instead, in the same
   * tab. There is no documented way to step into an open before the editor is drawn, so this
   * swaps after it: the editor can show for a moment first. See `docs/decisions.md`, "Board notes
   * open as the board by swapping after the open".
   */
  private redirectToBoard(leaf: WorkspaceLeaf | null): void {
    const view = leaf?.view;
    if (!leaf || !(view instanceof MarkdownView) || !view.file) return;
    const path = view.file.path;
    const outcome = markdownTabOutcome({
      cache: this.app.metadataCache.getFileCache(view.file),
      fallback: this.settings.boardNoteDefaultView,
      keptAsMarkdown: this.markdownTabs.get(leaf) === path,
      alreadyDecided: this.decided.get(view) === path,
      editingSurface: this.isEditingSurface(leaf),
    });
    if (outcome === "retry") {
      // Not decidable until the cache has read the note. The editor has moved on from whatever it
      // was decided about before, so that note, opened here again, is an open again.
      this.decided.delete(view);
      this.coldOpens.set(leaf, path);
      return;
    }
    this.decided.set(view, path);
    if (outcome !== "board") return;
    this.swapToBoard(leaf, view, path).catch((e: unknown) => {
      // Undecided again, so bringing the tab forward is another try.
      this.undecide(view, path);
      new Notice(`Folia Kanban: could not show this note as the board. ${String(e)}`, 8000);
    });
  }

  /**
   * Swap a tab that may still be finishing the open that brought the note up. Such a tab ignores a
   * second `setViewState`, and nothing documented says when it is done, so this looks at what the
   * tab shows afterwards and tries again shortly.
   */
  private async swapToBoard(leaf: WorkspaceLeaf, view: MarkdownView, path: string): Promise<void> {
    // Keyboard focus follows only when the editor had it: a note opened from the explorer with the
    // arrow keys leaves the keys in the explorer.
    const focus = view.containerEl.contains(activeDocument.activeElement);
    // False once the board is in, once the user has moved the tab on, and once the plugin is off.
    const pending = (): boolean => !this.unloaded && leaf.view === view && view.file?.path === path;
    // A deadline rather than a count: how long an open takes does not depend on the display.
    const until = Date.now() + 2000;
    while (pending() && Date.now() < until) {
      await this.showBoardIn(leaf, path, false);
      if (pending()) await sleep(16);
    }
    if (pending()) {
      this.undecide(view, path);
      return;
    }
    // Only while the user is still on this tab: they may have gone elsewhere during the swap.
    const board = this.app.workspace.getActiveViewOfType(KanbanView);
    if (focus && board?.leaf === leaf && board.file?.path === path) {
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  /**
   * {@link redirectToBoard} for the tab `file-open` is about. Usually that is the active tab. A
   * keyboard preview from the file explorer (Mod+Arrow) instead opens the note in the most recent
   * tab, leaves the explorer active, and reports the open before the tab shows the note, so for a
   * board note that tab is watched for a moment.
   */
  private async redirectOpenOf(file: TFile): Promise<void> {
    const { workspace } = this.app;
    // A board coming forward reports its note too, and has nothing to redirect.
    if (workspace.getActiveViewOfType(KanbanView)?.file === file) return;
    const showing = (): WorkspaceLeaf | undefined =>
      [workspace.getActiveViewOfType(MarkdownView)?.leaf, workspace.getMostRecentLeaf()].find(
        (l) => l?.view instanceof MarkdownView && l.view.file === file,
      ) ?? undefined;
    let leaf = showing();
    const until = Date.now() + 1000;
    // Also while the cache has not read the note: it may turn out to be a board.
    const mayBeBoard = (): boolean =>
      this.isBoard(file) || this.app.metadataCache.getFileCache(file) === null;
    while (!leaf && mayBeBoard() && !this.unloaded && Date.now() < until) {
      await sleep(16);
      leaf = showing();
    }
    if (leaf) this.redirectToBoard(leaf);
  }

  /** Forget a decision, unless the editor has since moved on to another note and been decided
   *  about there. */
  private undecide(view: MarkdownView, path: string): void {
    if (this.decided.get(view) === path) this.decided.delete(view);
  }

  /** Give every open board note's Markdown editor a "back to the board" header button — and
   *  only board notes, so an ordinary note's header is untouched. */
  private syncMarkdownActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const wanted = view.file ? this.isBoard(view.file) : false;
      const existing = this.boardActions.get(view);
      const shown = existing !== undefined && view.containerEl.contains(existing);
      if (wanted && !shown) {
        const action = view.addAction("layout-grid", "Open as Folia Kanban board", () => {
          // Read the file at click time: one MarkdownView outlives the file it started on.
          const current = view.file;
          if (current) void this.openBoardFrom(leaf, current.path);
        });
        this.boardActions.set(view, action);
      } else if (!wanted && existing) {
        existing.remove();
        this.boardActions.delete(view);
      }
    }
  }

  private removeMarkdownActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      this.boardActions.get(view)?.remove();
      this.boardActions.delete(view);
    }
  }

  /** The Markdown editor's button. In a normal tab it swaps in place; from a sidebar it sends
   *  the board to a real tab instead, because a dock has no room for one. */
  private async openBoardFrom(leaf: WorkspaceLeaf, filePath: string): Promise<void> {
    if (this.isEditingSurface(leaf)) await this.showBoardIn(leaf, filePath, true);
    else await this.openBoard(filePath);
  }

  /**
   * Follow a file operation: re-point (or drop) everything the plugin remembers by path. Runs for
   * the plugin's own renames as much as for one done in the file explorer — both reach it as the
   * same vault event — which is why every step of it is idempotent. The vault reports a folder as
   * a single operation covering everything inside it, which is what `remapPath` and
   * `migratePathKeyedSettings` are built to expect.
   */
  private async followFileOp(op: FileOp): Promise<void> {
    // The per-tab records hold a path. Left pointing at the old one, the "put in the Markdown
    // editor" record would let the next state replay send the tab back to the board — the exact
    // thing it exists to prevent — and the "already decided" one would treat the next switch back
    // to the tab as a fresh open. A WeakMap cannot be walked, so walk the leaves.
    this.app.workspace.iterateAllLeaves((leaf) => {
      follow(this.markdownTabs, leaf, op);
      if (leaf.view instanceof MarkdownView) follow(this.decided, leaf.view, op);
    });
    try {
      await this.updateSettings((s) => ({
        ...migratePathKeyedSettings(s, op),
        ...remapDeviceState(s, op),
      }));
    } catch (e) {
      // Nothing awaits this (it runs off a vault event), so a failed write would otherwise be an
      // unhandled rejection: invisible to the user and to anything that could react. The in-memory
      // settings are already correct; what failed is persisting them, which the next write retries.
      new Notice(
        `Folia Kanban: could not save after a file was moved or deleted. ${String(e)}`,
        8000,
      );
    }
  }

  /** Swap a tab to the board, same leaf, same file. It does not save the editor first: Obsidian
   *  saves a Markdown view as it closes, and a save of our own can land while the tab is still
   *  loading a note, when a reused editor holds the previous note's text under the new name. */
  async showBoardIn(leaf: WorkspaceLeaf, filePath: string, focus: boolean): Promise<void> {
    const before = this.activeLeaf();
    await leaf.setViewState({ type: VIEW_TYPE_KANBAN, state: { file: filePath } });
    // The choice to keep this note in the editor ends only once its board is actually in. A board
    // for another note leaves it standing, so Back still returns to the editor; so does a swap the
    // tab ignored because it was still busy with an open.
    const shown = leaf.view instanceof KanbanView && leaf.view.file?.path === filePath;
    if (shown && this.markdownTabs.get(leaf) === filePath) this.markdownTabs.delete(leaf);
    // Not if the user went somewhere else in the meantime, a sidebar included.
    const now = this.activeLeaf();
    if (focus && (now === before || now === leaf))
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  /** The active leaf, sidebars included, read on the spot. `active-leaf-change` is delivered a
   *  moment later, so counting those events misses a switch made while a swap is running. */
  private activeLeaf(): WorkspaceLeaf | null {
    return this.app.workspace.getActiveViewOfType(View)?.leaf ?? null;
  }

  /** Swap a tab to the Markdown editor, same leaf, same file, and remember that the user chose it
   *  so {@link redirectToBoard} leaves the tab alone. */
  async showMarkdownIn(leaf: WorkspaceLeaf, filePath: string): Promise<void> {
    this.markdownTabs.set(leaf, filePath);
    await leaf.setViewState({ type: "markdown", state: { file: filePath } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.syncMarkdownActions();
  }

  async activateView(): Promise<void> {
    // If the note in the editor is itself a board, open that one — no prompting.
    const active = this.app.workspace.getActiveFile();
    if (active && this.isBoard(active)) {
      await this.openBoard(active.path);
      return;
    }

    const boards = this.findBoards();
    if (boards.length === 0) {
      new Notice(
        "Folia Kanban: no board note found. Add `folia-board: true` to a note's frontmatter (and `columns` + `card-folder`).",
        8000,
      );
      return;
    }
    if (boards.length === 1) {
      const board = boards[0];
      if (board) await this.openBoard(board.path);
      return;
    }
    // Several boards — let the user pick which to open.
    new BoardChooserModal(this.app, boards, (f) => void this.openBoard(f.path)).open();
  }

  /**
   * The two guided ways to get a board: make one, or turn the note you are on into one. Every
   * entry point is registered once and reads its toggle when it runs — a command through its
   * `checkCallback`, a menu through the handler Obsidian calls fresh on every open — so turning one
   * off in the settings takes effect immediately, with nothing to unregister.
   */
  private registerBoardSetupActions(): void {
    this.addCommand({
      id: "folia-create-board",
      name: "Create board",
      checkCallback: (checking) => {
        if (!this.settings.boardSetupCommands) return false;
        if (!checking) void this.createBoard(null);
        return true;
      },
    });
    this.addCommand({
      id: "folia-convert-note-to-board",
      name: "Convert this note into a board",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.settings.boardSetupCommands || !this.canConvert(file)) return false;
        if (!checking) void this.convertToBoard(file);
        return true;
      },
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) =>
        this.addBoardSetupMenuItems(menu, file, this.settings.boardSetupFileMenu),
      ),
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, info: MarkdownFileInfo) =>
        this.addBoardSetupMenuItems(menu, info.file, this.settings.boardSetupEditorMenu),
      ),
    );
  }

  /** A note can be converted when it is Markdown and is not a board already. */
  private canConvert(file: TAbstractFile | null): file is TFile {
    return file instanceof TFile && file.extension === "md" && !this.isBoard(file);
  }

  private addBoardSetupMenuItems(menu: Menu, target: TAbstractFile | null, enabled: boolean): void {
    if (!enabled) return;
    if (target instanceof TFolder) {
      menu.addItem((item) =>
        item
          .setTitle("Create Folia board here")
          .setIcon("layout-grid")
          .onClick(() => void this.createBoard(target)),
      );
      return;
    }
    if (this.canConvert(target)) {
      const file = target;
      menu.addItem((item) =>
        item
          .setTitle("Convert to Folia board")
          .setIcon("layout-grid")
          .onClick(() => void this.convertToBoard(file)),
      );
    }
  }

  /** Make a note that is already a board. `parent` is the folder the user right-clicked; without
   *  one, the note lands wherever Obsidian's own "new note location" setting puts new notes — which
   *  is why the active file is passed along, since one of the settings means "beside it". */
  private async createBoard(parent: TFolder | null): Promise<void> {
    try {
      const source = this.app.workspace.getActiveFile()?.path ?? "";
      const folder = parent ?? this.app.fileManager.getNewFileParent(source);
      const path = uniqueNotePath(folder.path, NEW_BOARD_BASENAME, pathTaken(this.app.vault));
      const title = path.slice(path.lastIndexOf("/") + 1, -".md".length);
      await this.makeBoard(await this.app.vault.create(path, boardNoteBody(title)));
    } catch (e) {
      new Notice(`Folia Kanban: could not create the board note. ${String(e)}`, 8000);
    }
  }

  /** Add the board properties to a note that already exists. */
  private async convertToBoard(file: TFile): Promise<void> {
    try {
      await this.makeBoard(file);
    } catch (e) {
      new Notice(`Folia Kanban: could not convert this note into a board. ${String(e)}`, 8000);
    }
  }

  /** The one step both guided paths share: write the board properties through Obsidian's own
   *  frontmatter API — which is what puts them at the very top, whether or not the note had any —
   *  give the board a card folder of its own, and show it. */
  private async makeBoard(file: TFile): Promise<void> {
    // The tab the board will land in is settled first, because it is also the one whose editor has
    // to be flushed *before* the write. A note being typed in has a buffer ahead of the disk, and
    // the tab swap writes that buffer out when the editor closes — after the properties have landed,
    // which would take them straight back out again. Only this one tab is saved: another tab on the
    // same note has its own buffer, and saving that one too would let it overwrite this one.
    const open = this.leafShowing("markdown", file.path);
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
    // *other* board is left alone too, which is where `openBoard` would have put this one.
    const leaf = open ?? this.app.workspace.getLeaf(true);
    await this.showBoardIn(leaf, file.path, true);
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Every note flagged `folia-board: true` in its frontmatter. */
  findBoards(): TFile[] {
    // Boards can live anywhere in the vault (any note with `folia-board: true` frontmatter), so
    // discovery scans every note. The full-vault enumeration is intentional and limited to markdown.
    return this.app.vault.getMarkdownFiles().filter((f) => this.isBoard(f));
  }

  private isBoard(f: TFile): boolean {
    return isBoardFrontmatter(this.app.metadataCache.getFileCache(f)?.frontmatter);
  }

  private async openBoard(boardPath: string): Promise<void> {
    const { workspace } = this.app;
    // A tab already holding this note — as the board or as Markdown — is the one the user means.
    let leaf =
      this.leafShowing(VIEW_TYPE_KANBAN, boardPath) ?? this.leafShowing("markdown", boardPath);
    // Otherwise reuse an existing board tab, and only then open a new one (a board wants width).
    leaf ??=
      workspace.getLeavesOfType(VIEW_TYPE_KANBAN).find((l) => this.isEditingSurface(l)) ??
      workspace.getLeaf(true);
    await this.showBoardIn(leaf, boardPath, true);
    await workspace.revealLeaf(leaf);
  }

  private leafShowing(viewType: string, filePath: string): WorkspaceLeaf | null {
    return (
      this.app.workspace.getLeavesOfType(viewType).find((l) => {
        if (!this.isEditingSurface(l)) return false;
        const saved = l.getViewState().state;
        // `boardPath` is what a board tab saved before this view owned its file looks like.
        return saved?.["file"] === filePath || saved?.["boardPath"] === filePath;
      }) ?? null
    );
  }

  /** A board needs width, so "open the board" never retargets a sidebar tab. A popout window is
   *  a real editing surface and does qualify. */
  private isEditingSurface(leaf: WorkspaceLeaf): boolean {
    const root = leaf.getRoot();
    const { leftSplit, rightSplit } = this.app.workspace;
    return root !== leftSplit && root !== rightSplit;
  }

  async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    this.device.load(legacyCollapsedCards(loaded));
    const { settings, stored, needsSave } = hydrateSettings(loaded, stamp());
    this.stored = stored;
    this.settings = settings;
    // Read before the stored set is asked for one: a secret already here is the newer of the two,
    // and what makes the migration below one-way.
    this.mcpToken = readMcpToken(this.app);
    // Agent access switched on but carrying no token — data.json hand-edited, or synced from an
    // install that could not mint one — would leave the toggle reading on with nothing listening
    // and nothing said about it, because a server that is never asked to start never fails. This is
    // also where a token written by a build that kept it in the file stops being kept there.
    const migrated = this.settleMcpToken();
    // Persisted right away: the baseline is "when tracking started", and it must not drift to a
    // later launch if nothing else happens to save the settings before then. A file the load had to
    // prune, repair or take a token out of is written for the same reason — so the next load reads
    // what this one decided rather than deciding it again.
    if (needsSave || migrated) await this.saveSettings();
  }

  /**
   * Bring the token this install holds into line with what it should be — {@link mcpTokenOutcome}
   * decides that; this does it — and say whether `data.json` has to be written as a result.
   *
   * Called wherever any of the three inputs can have moved: the load, an external change to the
   * file, and the settings write that switches agent access on. The old key is only taken out of
   * the stored set once the token that was in it is safely somewhere else, so a store that refuses
   * leaves the file as it was rather than turning the migration into a deletion.
   */
  private settleMcpToken(): boolean {
    const outcome = mcpTokenOutcome(
      {
        enabled: this.settings.mcpEnabled,
        secret: this.mcpToken,
        legacy: peekStoredMcpToken(this.stored),
      },
      newMcpToken,
    );
    if (outcome.write) {
      // Not held unless it is kept: a token that lived only until the app closed would lock out the
      // client configured with it, which is worse than agent access plainly not starting.
      if (!writeMcpToken(this.app, outcome.token)) {
        new Notice(MCP_TOKEN_UNAVAILABLE, 10000);
        return false;
      }
    }
    this.mcpToken = outcome.token;
    if (!outcome.dropLegacy) return false;
    this.stored = withoutStoredMcpToken(this.stored);
    // The settings were resolved from a stored set that still had the key, so the credential is
    // sitting in them until something else happens to write a patch. Resolve them again.
    this.settings = resolveSettings(this.stored);
    return true;
  }

  /**
   * Obsidian calls this when `data.json` changes under a running plugin: Sync landing another
   * device's copy, or someone editing the file by hand. Without it the change is never read and the
   * next write from here replaces it with the older picture — see {@link adoptExternalSettings} for
   * what is taken and what still resolves last-write-wins.
   */
  override async onExternalSettingsChange(): Promise<void> {
    // Both awaits below are moments where this instance can change its own settings — a width drag,
    // a comment marked seen, a rename arriving in the same Sync burst. Adopting then would compare
    // the file against settings newer than it and drop them. The stored set is replaced rather than
    // mutated on every write, so its identity is the whole test; a few attempts, and if the user is
    // still typing we leave the file to the write that is already on its way.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = this.stored;
      await this.pendingWrite;
      if (this.unloaded) return;
      // A file being written by Sync right now can be unreadable rather than merely old.
      const loaded: unknown = await this.loadData().catch(() => null);
      if (this.unloaded) return;
      if (this.stored !== before) continue;
      this.adopt(loaded);
      return;
    }
  }

  /** The settings a re-read of `data.json` amounts to, applied. Split out so the read above owns
   *  only the question of when it is safe to look. */
  private adopt(loaded: unknown): void {
    const { settings, stored, changedKeys, needsSave } = adoptExternalSettings(
      loaded,
      this.stored,
      this.settings.commentsBaseline || stamp(),
    );
    let write = needsSave;
    if (changedKeys.length > 0) {
      this.stored = stored;
      this.settings = settings;
      // The same settling `loadSettings` does, for the same reasons: a file written by a build that
      // kept the token in it has to stop carrying one, and agent access can arrive switched on from
      // an install that had no token to give.
      if (this.settleMcpToken()) write = true;
      this.refreshViews();
      // Only when a row it draws actually moved: `data.json` also carries per-card read markers
      // written by ordinary board use elsewhere, and letting that redraw the tab would throw away a name being
      // typed for a change the tab is not even showing.
      // An own key, not `in`: a hand-edited file can carry a key named after something every
      // object inherits, and `"constructor" in SETTING_CONTROLS` is true. Same call `getControlValue`
      // makes, for the same reason.
      if (changedKeys.some((key) => Object.prototype.hasOwnProperty.call(SETTING_CONTROLS, key)))
        this.settingTab?.settingsChangedExternally();
      // Port, bind address, token and the switch itself can all have moved; the running server has
      // to follow them here as it does on any other settings change.
      void this.mcp?.sync(this.settings);
    }
    // Only when this instance decided something the file does not already say. Writing back what we
    // just read would reach the other side as its own external change, and come back again.
    if (write) void this.saveSettings();
  }

  /** Records a patch as something that was actually set: it joins what is kept on disk, and the
   *  settings the plugin runs on are resolved from that again. False when the patch was empty, so
   *  callers can skip the refresh and the write it would otherwise cost. */
  /** Whether a setting is one someone actually set, rather than one `DEFAULT_SETTINGS` is
   *  answering. A field showing a default is showing a value nobody chose, so typing that same
   *  value is still a choice worth writing — see `alreadySet` on {@link heldFieldOutcome}. */
  isSet(key: keyof KanbanSettings): boolean {
    return key in this.stored;
  }

  private applyToStored(patch: Partial<KanbanSettings>): boolean {
    if (Object.keys(patch).length === 0) return false;
    this.stored = { ...this.stored, ...patch };
    this.settings = resolveSettings(this.stored);
    return true;
  }

  /** Serializes the writes: two `saveData` calls in flight at once can land on disk in either
   *  order, and what survives is whatever the slower one carried — an older snapshot than the one
   *  already applied in memory. A rename chain done quickly in the file explorer is exactly that
   *  case. Chained, each write also reads `this.stored` at the moment it runs, so the last one
   *  writes the newest state rather than the state as of when it was queued. */
  async saveSettings(): Promise<void> {
    const write = this.pendingWrite.then(() => this.saveData(settingsForDisk(this.stored)));
    // A failed write must not break the chain for every write after it.
    this.pendingWrite = write.catch(() => {});
    await write;
  }

  /** What a board runs on: the settings, with this device's own state merged in. */
  boardSettings(): BoardSettings {
    return { ...this.settings, ...this.device.current };
  }

  /** Apply a settings patch and push it live into every open board immediately, then persist in
   *  the background. Refreshing before the write resolves (not after) matters for any caller that
   *  reads a patch back off the live `settings` prop to build its next one — the subitems-collapse
   *  toggle does this on every click (§ collapse) — because waiting on the write first would let a
   *  second update land before the first was visible anywhere, and silently lose it. The part of
   *  the patch that is device state goes to local storage, so a collapse toggle never writes
   *  `data.json`. */
  async updateSettings(patch: SettingsPatch): Promise<void> {
    const { device, synced } = splitDevicePatch(resolveSettingsPatch(this.boardSettings(), patch));
    const deviceChanged = Object.keys(device).length > 0;
    const syncedChanged = this.applyToStored(synced);
    // Switching agent access on for the first time is when its token comes into existence: it is
    // generated once and kept, so the client configured against it keeps working across restarts.
    if (syncedChanged) this.settleMcpToken();
    try {
      if (deviceChanged) this.device.update(device);
    } finally {
      // Local storage refusing a write must not keep the other half from landing: a rename carries
      // the collapse state and the read marker in one patch, and a marker left on the old path
      // would pass to whichever card is created there next.
      if (deviceChanged || syncedChanged) this.refreshViews();
      if (syncedChanged) {
        void this.mcp?.sync(this.settings);
        await this.saveSettings();
      }
    }
  }

  /** Host the MCP server. Desktop-only is the manifest's `isDesktopOnly`, not a check here (see
   *  `docs/decisions.md`, "Mobile is not supported"). */
  private buildMcp(): void {
    this.mcp = new McpService({
      app: this.app,
      getSettings: () => this.settings,
      getToken: () => this.mcpToken,
      info: {
        name: this.manifest.id,
        title: this.manifest.name,
        version: this.manifest.version,
      },
      onState: (state) => this.reportMcpState(state),
    });
  }

  private reportMcpState(state: McpState): void {
    // A server that came up somewhere other than this computer says so every time it does, which
    // includes every Obsidian start. The setting travels with the vault — synced, or copied to a
    // laptop — so the machine now listening on a network may not be the one where that was chosen,
    // and the address is not visible anywhere else until someone opens the settings tab.
    if (state.kind === "running" && !isLoopbackBindAddress(state.bindAddress)) {
      new Notice(
        `Folia Kanban: agent access is reachable on ${state.bindAddress}, port ${state.port} — not just on this computer. Anything on that network holding the token can change every board in this vault.`,
        10000,
      );
      return;
    }
    if (state.kind !== "failed") return;
    // A toggle left on while nothing is listening is the one state the user cannot see, so the
    // failure says both what broke and that the switch is now lying. It names the address that was
    // actually tried: the settings may have moved on while the start was queued.
    new Notice(
      `Folia Kanban: agent access could not start on address ${state.bindAddress}, port ${state.port}. ${state.message}`,
      10000,
    );
  }

  /** Put the bearer token on the clipboard, for pasting into an MCP client's configuration. */
  async copyMcpToken(): Promise<void> {
    const token = this.mcpToken;
    if (!token) {
      new Notice(MCP_TOKEN_COPY.missing, 5000);
      return;
    }
    await navigator.clipboard.writeText(token);
    new Notice(MCP_TOKEN_COPY.copied, 3000);
  }

  /**
   * Replace the bearer token and put the new one on the clipboard, so the client that has to be
   * reconfigured can be reconfigured in the same gesture. The running server is restarted on the
   * new token here, which means every client still holding the old one is locked out from that
   * moment.
   */
  async regenerateMcpToken(): Promise<void> {
    if (!this.settings.mcpEnabled) {
      new Notice(MCP_TOKEN_REGENERATE.missing, 5000);
      return;
    }
    const token = newMcpToken();
    if (!writeMcpToken(this.app, token)) {
      new Notice(MCP_TOKEN_UNAVAILABLE, 10000);
      return;
    }
    this.mcpToken = token;
    // The token is not a setting, so no settings write carries it to the server: the restart is
    // asked for here, and waited on, so the notice reports what actually happened. A port taken in
    // the window between stopping on the old token and starting on the new one would otherwise be
    // announced as success, and the separate failure notice would look unrelated to the button just
    // pressed.
    await this.mcp?.sync(this.settings);
    if (this.mcp && this.mcp.port === null) {
      new Notice(MCP_TOKEN_REGENERATE.replacedButDown, 10000);
      return;
    }
    // The token is already replaced and kept; a clipboard that refuses does not undo that, and
    // saying nothing would leave the user with a working server and no idea what its token is.
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      new Notice(MCP_TOKEN_REGENERATE.replacedNotCopied, 10000);
      return;
    }
    new Notice(MCP_TOKEN_REGENERATE.done, 5000);
  }

  /** Re-render all open Folia Kanban views so settings changes reflect without a reload. */
  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_KANBAN)) {
      if (leaf.view instanceof KanbanView) leaf.view.refresh();
    }
  }
}

/** Picker shown when more than one `folia-board: true` note exists. */
class BoardChooserModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private boards: TFile[],
    private onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a Folia Kanban board to open");
  }

  getItems(): TFile[] {
    return this.boards;
  }

  // Disambiguate same-named boards in different folders by showing the parent path.
  getItemText(file: TFile): string {
    return file.parent && file.parent.path !== "/"
      ? `${file.basename}  (${file.parent.path})`
      : file.basename;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

class KanbanSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: FoliaKanbanPlugin,
  ) {
    super(app, plugin);
  }

  /**
   * The name typed but not committed yet. Committing per keystroke would save + re-render every
   * open board nine times for "alexandra", and each intermediate value is a DIFFERENT reader as far
   * as comment read-state is concerned — so a half-typed name reaching an open card's read marker
   * would leave it recorded under someone who does not exist.
   *
   * It lands when the tab is left — another settings tab, or the settings window closing — and, on
   * the imperative tab only, as soon as the field loses focus. A name typed and then abandoned by
   * killing the app outright is therefore lost rather than half-written, which is the safer of the
   * two ways to be wrong about who wrote a comment.
   */
  private pendingUserName: string | null = null;

  /**
   * The port and the bind address, held the same way and for a sharper reason. Every write restarts
   * the server, and every prefix of what is being typed is either refused or — worse — a real value
   * of its own: typing 8080 over 27125 passes through 8, 80 and 808, each pulled up to the lowest
   * allowed port and each of which would bind, fail, or both, and `192.168.1.5` passes through
   * `192.168.1.55` if a digit is typed in the middle of it. Held until the field is left, so only
   * the value the user actually meant is ever bound. A field holding something that is not a value
   * holds nothing here, and leaving it then keeps what was already stored.
   */
  private pendingMcpFields: Partial<KanbanSettings> = {};

  /** The bind-address input as last drawn, so a refused confirm can put the stored value back. */
  private bindAddressInput: TextComponent | null = null;

  /**
   * The tab as data, so Obsidian 1.13 and later renders it itself and — the point of it — indexes
   * every setting for the settings search. Below 1.13 this method is never called and `display()`
   * below draws the same rows imperatively; both read their wording from `SETTING_COPY`.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return settingDefinitions(() => this.plugin.settings, this.plugin.manifest.version, {
      copy: () => void this.plugin.copyMcpToken(),
      regenerate: () => void this.replaceToken(),
      renderHeldField: (key, setting) => {
        this.renderHeldField(key, setting);
      },
    });
  }

  /** Where the declarative rendering reads a control's current value from: our own settings, not
   *  the vault config the base implementation would reach for. */
  override getControlValue(key: string): unknown {
    if (key === "userName") return this.pendingUserName ?? this.plugin.settings.userName;
    const settings: KanbanSettings = this.plugin.settings;
    return Object.prototype.hasOwnProperty.call(settings, key)
      ? settings[key as keyof KanbanSettings]
      : undefined;
  }

  /** Where the declarative rendering writes one back: through `updateSettings`, so open boards
   *  re-render, exactly as the imperative rows below do. */
  override setControlValue(key: string, value: unknown): void {
    const patch = settingsPatchFor(key, value);
    if (!patch) return;
    // Same deal as the imperative text field: hold the name until focus leaves or the tab closes.
    if (patch.userName !== undefined) {
      this.pendingUserName = patch.userName;
      return;
    }
    void this.plugin.updateSettings(patch).then(() => {
      // Agent access gates the port and bind-address rows, and those two draw themselves from a
      // `render` callback — which carries no `disabled` predicate for `refreshDomState` to
      // re-evaluate. Only redrawing the tab reaches them. No other row is gated, so every other
      // change gets the cheap path.
      refreshDeclarativeSettingTab(this, key === "mcpEnabled" ? "redraw" : "refresh");
    });
  }

  override display(): void {
    this.render();
  }

  /**
   * The file changed underneath, and every row on screen predates it. Redrawing is not only so the
   * user sees the new values: the held fields commit whatever their input holds when focus leaves,
   * read straight off the DOM, so leaving a port field nobody touched would write the value it is
   * still showing back over the change that just arrived.
   */
  settingsChangedExternally(): void {
    this.pendingUserName = null;
    this.pendingMcpFields = {};
    // From 1.13 the tab is Obsidian's to draw from `getSettingDefinitions`, and emptying
    // `containerEl` behind it would replace what it rendered — and what its settings search
    // indexed — with the older imperative rows. Below that, `render` is the only path there is, and
    // it costs nothing to skip when the tab is not on screen: `display` draws it fresh the next time
    // it is opened.
    if (!refreshDeclarativeSettingTab(this, "redraw") && this.containerEl.isConnected)
      this.render();
  }

  override hide(): void {
    this.commitHeldFields();
    super.hide();
  }

  /**
   * Write everything the tab is holding at this moment, in one patch.
   *
   * Every blur commits, so what is held is usually the one field focus has just left. It is still a
   * patch and not a single write, because holding outlives a blur that never comes: a field still
   * focused when the tab goes away gets none — Chrome fires no blur for an element leaving the
   * document — nor does one whose row the settings search redraws out from under it, and the user
   * name, held the same way, gets no blur of its own on the 1.13 path at all.
   *
   * Each write restarts the server, so editing the port and then the address restarts twice, the
   * first time on the pair as it stands halfway through. That is the price of a field meaning what
   * it says the moment it is left. Holding the first value back instead leaves the field showing a
   * value the server is not on, which is the failure these two rows were rebuilt to end.
   */
  private commitHeldFields(): void {
    const { now, confirm } = splitHeldPatch(this.heldPatch());
    if (confirm !== null) void this.confirmBindAddress(confirm);
    if (Object.keys(now).length > 0) void this.plugin.updateSettings(now);
  }

  /** The address a confirm is open for. Closing the Settings window both hides the tab and blurs
   *  the field, in either order, and the second commit must not raise a second dialog. */
  private askingBindAddress: string | null = null;

  private async confirmBindAddress(address: string): Promise<void> {
    if (this.askingBindAddress === address) return;
    this.askingBindAddress = address;
    try {
      if (await confirmAction(this.app, bindAddressConfirm(address))) {
        await this.plugin.updateSettings({ mcpBindAddress: address });
        return;
      }
      // The field shows what is really stored, not the address that was just declined.
      this.bindAddressInput?.setValue(this.plugin.settings.mcpBindAddress);
    } finally {
      this.askingBindAddress = null;
    }
  }

  /** Everything the text fields are holding that differs from what is stored, taken out of their
   *  hands. Only {@link commitHeldFields} calls it: a held value is deliberately not visible to any
   *  other write, because every keystroke passes through it. Editing 192.168.1.5 into 192.168.1.55
   *  passes through addresses that are real and bindable, and switching a toggle in the middle of
   *  that must not be what decides where the server listens. */
  private heldPatch(): Partial<KanbanSettings> {
    const patch: Partial<KanbanSettings> = { ...this.pendingMcpFields };
    const { pendingUserName: name } = this;
    this.pendingUserName = null;
    this.pendingMcpFields = {};
    if (name !== null && name !== this.plugin.settings.userName) patch.userName = name;
    return patch;
  }

  /**
   * The port and the bind-address fields, drawn the same way on both rendering paths: Obsidian 1.13
   * calls this from the row's `render`, and {@link render} calls it on a row it built itself. See
   * {@link heldFieldOutcome} for why neither field can be a declarative control.
   */
  private renderHeldField(key: HeldFieldKey, setting: Setting): void {
    const disabled = isRowDisabled(key, this.plugin.settings);
    setting.setDisabled(disabled).addText((t) => {
      if (key === "mcpBindAddress") this.bindAddressInput = t;
      // Deliberately not `type="number"` for the port, tempting as it is. A number input sanitises
      // what it cannot parse away to the empty string, so the field could neither show back what
      // was typed nor say why it was refused — the same silence this whole change is about. The
      // range lives in the row's description, and `settingsPatchFor` is what enforces it.
      if (key === "mcpPort") t.inputEl.inputMode = "numeric";
      t.setPlaceholder(
        key === "mcpPort" ? String(DEFAULT_SETTINGS.mcpPort) : MCP_DEFAULT_BIND_ADDRESS,
      )
        // Held first, stored second: a redraw while a value is being typed (switching agent access
        // off and on redraws the tab) must not put the field back to what the typing replaced.
        .setValue(String(this.pendingMcpFields[key] ?? this.plugin.settings[key]))
        .setDisabled(disabled)
        .onChange((v) => {
          const outcome = heldFieldOutcome(key, v, this.plugin.settings, this.plugin.isSet(key));
          this.holdMcpField(key, outcome.commit);
          setSettingError(setting, outcome.error);
        });
      // Nothing is written until focus leaves, and leaving is also when the field is put back to
      // what is really stored: an emptied one showing a grey default, or a refused one still
      // showing what was typed, would both read as the server having moved there.
      t.inputEl.addEventListener("blur", () => {
        const outcome = heldFieldOutcome(
          key,
          t.inputEl.value,
          this.plugin.settings,
          this.plugin.isSet(key),
        );
        this.holdMcpField(key, outcome.commit);
        setSettingError(setting, null);
        t.setValue(outcome.show);
        if (outcome.notice !== null) new Notice(outcome.notice, 5000);
        this.commitHeldFields();
      });
    });
  }

  /** Hold what a field accepted, or let go of what it refused. */
  private holdMcpField(key: HeldFieldKey, commit: Partial<KanbanSettings> | null): void {
    if (commit) Object.assign(this.pendingMcpFields, commit);
    else delete this.pendingMcpFields[key];
  }

  /**
   * The imperative tab, for Obsidian below 1.13. Obsidian 1.13 and later never calls this: it
   * renders `getSettingDefinitions()` instead.
   *
   * Both walk the same `SETTING_GROUPS`, so the two tabs are one tab drawn by whichever API is
   * there: same sections in the same order, same rows under them, same wording, same rules about
   * which row is live. What Obsidian 1.13 gets from a group definition, this builds from a heading
   * row (`Setting.setHeading()`, there since 0.9.16) and the rows that follow it.
   */
  private render(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const group of SETTING_GROUPS) {
      new Setting(containerEl).setName(group.heading).setHeading();
      for (const key of group.keys) this.renderRow(key, containerEl);
      if (group.id === "agentAccess") this.renderTokenRows(containerEl);
    }

    // Under its own heading, so it does not read as the last row of the section above it — see
    // ABOUT_HEADING. Read from the manifest so it always reflects the installed build.
    new Setting(containerEl).setName(ABOUT_HEADING).setHeading();
    new Setting(containerEl).setName(VERSION_SETTING_NAME).setDesc(this.plugin.manifest.version);
  }

  /** One row, built from the control `SETTING_CONTROLS` says it wears and the copy both tabs share. */
  private renderRow(key: EditableSettingKey, containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const value = settings[key];
    const spec = SETTING_CONTROLS[key];
    const disabled = isRowDisabled(key, settings);
    const setting = new Setting(containerEl)
      .setName(SETTING_COPY[key].name)
      .setDesc(SETTING_COPY[key].desc)
      .setDisabled(disabled);

    switch (spec.kind) {
      // The port and the bind address draw themselves, and apply their own disabled state.
      case "held":
        this.renderHeldField(key as HeldFieldKey, setting);
        return;
      case "dropdown":
        setting.addDropdown((d) =>
          d
            .addOptions(spec.options)
            .setValue(String(value))
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v)),
        );
        return;
      case "toggle":
        setting.addToggle((t) =>
          t
            .setValue(value === true)
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v)),
        );
        return;
      case "slider":
        setting.addSlider((sl) =>
          sl
            .setLimits(spec.min, spec.max, spec.step)
            .setValue(typeof value === "number" ? value : spec.min)
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v)),
        );
        return;
      case "text":
        setting.addText((t) => {
          t.setPlaceholder(spec.placeholder)
            .setValue(String(value))
            .setDisabled(disabled)
            .onChange((v) => this.writeRow(key, v));
          // The name is held, so leaving the field is what lands it — see `pendingUserName`.
          t.inputEl.addEventListener("blur", () => this.commitHeldFields());
        });
        return;
    }
  }

  /** What a row's new value means. Deliberately the same three steps `setControlValue` takes on the
   *  declarative tab — validate, hold the name, write — so neither tab can decide differently. */
  private writeRow(key: EditableSettingKey, value: unknown): void {
    const patch = settingsPatchFor(key, value);
    if (!patch) return;
    if (patch.userName !== undefined) {
      this.pendingUserName = patch.userName;
      return;
    }
    const saved = this.plugin.updateSettings(patch);
    // A row that decides whether other rows exist or are live needs the tab drawn again: nothing
    // here re-evaluates a disabled state on its own the way `refreshDomState()` does on 1.13.
    if ((TAB_REDRAW_KEYS as readonly string[]).includes(key)) void saved.then(() => this.render());
  }

  /** The two rows that close the agent-access section: neither is a setting, both are dead until
   *  agent access is on. */
  private renderTokenRows(containerEl: HTMLElement): void {
    const off = !this.plugin.settings.mcpEnabled;
    const row = (
      copy: { name: string; desc: string; button: string },
      onClick: () => void,
    ): void => {
      new Setting(containerEl)
        .setName(copy.name)
        .setDesc(copy.desc)
        .setDisabled(off)
        .addButton((b) => b.setButtonText(copy.button).setDisabled(off).onClick(onClick));
    };
    row(MCP_TOKEN_COPY, () => void this.plugin.copyMcpToken());
    row(MCP_TOKEN_REGENERATE, () => void this.replaceToken());
  }

  /** Replacing locks every configured client out, so it asks first; with nothing to replace yet,
   *  the plugin's own notice says why nothing happens. */
  private async replaceToken(): Promise<void> {
    if (
      this.plugin.settings.mcpEnabled &&
      !(await confirmAction(this.app, MCP_TOKEN_REGENERATE.confirm))
    )
      return;
    await this.plugin.regenerateMcpToken();
  }
}
