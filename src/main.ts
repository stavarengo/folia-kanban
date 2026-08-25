import type { ViewState } from "obsidian";
import {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  type App,
} from "obsidian";
import { KanbanView, VIEW_TYPE_KANBAN } from "./view";
import {
  DEFAULT_SETTINGS,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  type KanbanSettings,
} from "./settings";
import { type BoardViewMode, isBoardFrontmatter, resolveBoardViewMode } from "./viewMode";

/** Marks the header button this plugin adds to a board note's Markdown editor. */
const BOARD_ACTION_CLASS = "folia-open-as-board";

/** `popstate` is understood by Obsidian but missing from the public `ViewState` typing. Setting
 *  it keeps a view swap out of the navigation history, so Back still means "the previous note"
 *  rather than "the same note drawn differently". */
interface NavigableViewState extends ViewState {
  popstate?: boolean;
}

/** The only thing the prototype patch below closes over. Everything it needs to decide sits
 *  behind this one field, so unloading the plugin can cut the link: a wrapper we were unable to
 *  remove is then inert *and* holds nothing, instead of pinning the whole plugin in memory. */
interface PatchState {
  redirectToBoard: ((leaf: WorkspaceLeaf, filePath: string, eState: unknown) => boolean) | null;
}

/** A link to a heading or a block, and a search result, all ask for a *place in the text*. The
 *  board has nowhere to put a line number, so those opens are left in the editor where the thing
 *  the user clicked actually is. A bare scroll position is not such a request. */
function targetsAPlaceInTheText(eState: unknown): boolean {
  if (typeof eState !== "object" || eState === null) return false;
  const target = eState as Record<string, unknown>;
  return (
    target["line"] !== undefined || target["subpath"] !== undefined || target["match"] !== undefined
  );
}

export default class FoliaKanbanPlugin extends Plugin {
  override settings: KanbanSettings = DEFAULT_SETTINGS;

  /** Tabs the user sent to the Markdown editor with the button, and the note they did it for.
   *  Nothing else ever writes to this: it records a decision a person made, never a guess about
   *  one. Keyed on the leaf so it dies with the tab, and scoped to the file so the decision does
   *  not follow the tab to some other note. Without it, going Back to a tab you had put in the
   *  editor would land on the board instead — Obsidian replays the tab's *state*, which reaches
   *  the same redirect as a fresh open. */
  private readonly markdownTabs = new WeakMap<WorkspaceLeaf, string>();

  private readonly patchState: PatchState = { redirectToBoard: null };

  private unloaded = false;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_KANBAN,
      (leaf) =>
        new KanbanView(
          leaf,
          () => this.settings,
          (p) => void this.updateSettings(p),
          (view) => {
            const file = view.file;
            if (file) void this.showMarkdownIn(view.leaf, file.path);
          },
        ),
    );

    this.addRibbonIcon("layout-grid", "Open Folia Kanban board", () => void this.activateView());
    this.addCommand({
      id: "folia-open-kanban-board",
      name: "Open board",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new KanbanSettingTab(this.app, this));

    this.patchLeafSetViewState();
    this.registerEvent(this.app.workspace.on("file-open", () => this.syncMarkdownActions()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncMarkdownActions()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.syncMarkdownActions()),
    );
    // The button follows the flag: a note that gains or loses `folia-board` while it is open
    // gains or loses the button, but the tab is never swapped out from under the user.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.syncMarkdownActions()));
    // Without this, disabling the plugin leaves its buttons in the headers of open notes, still
    // clickable, still calling into a view type Obsidian no longer knows about.
    this.register(() => {
      this.unloaded = true;
      this.removeMarkdownActions();
    });
    // `onLayoutReady` cannot be unregistered, and it can still fire after an unload that happened
    // during startup — which would put the buttons straight back, wired to a view type Obsidian
    // no longer has.
    this.app.workspace.onLayoutReady(() => {
      if (!this.unloaded) this.syncMarkdownActions();
    });
  }

  /**
   * Make Obsidian open a board note as the board wherever a file is opened — the explorer, a
   * link, search, the quick switcher, Back/Forward. Every one of those routes ends in
   * `WorkspaceLeaf.setViewState({ type: "markdown", ... })`, so intercepting that one call is
   * both complete and free of the flash a "open it, then swap it" listener would give. This is
   * the same approach the Kanban and Excalidraw community plugins use.
   */
  private patchLeafSetViewState(): void {
    const patchState = this.patchState;
    // An arrow, so the wrapper below can stay a `function` and keep `this` as the leaf.
    patchState.redirectToBoard = (leaf, filePath, eState) =>
      this.markdownTabs.get(leaf) !== filePath &&
      !targetsAPlaceInTheText(eState) &&
      this.isEditingSurface(leaf) &&
      this.shouldOpenAsBoard(filePath);

    const leafProto = WorkspaceLeaf.prototype;
    const original = leafProto.setViewState;
    const patched = function (
      this: WorkspaceLeaf,
      state: ViewState,
      eState?: unknown,
    ): Promise<void> {
      const filePath = state.state?.["file"];
      if (
        state.type === "markdown" &&
        typeof filePath === "string" &&
        patchState.redirectToBoard?.(this, filePath, eState) === true
      ) {
        return original.call(this, { ...state, type: VIEW_TYPE_KANBAN }, eState);
      }
      return original.call(this, state, eState);
    };
    leafProto.setViewState = patched;
    this.register(() => {
      // Go inert first: if another plugin wrapped us, the restore below cannot take effect.
      patchState.redirectToBoard = null;
      if (leafProto.setViewState === patched) leafProto.setViewState = original;
    });
  }

  /** Give every open board note's Markdown editor a "back to the board" header button — and
   *  only board notes, so an ordinary note's header is untouched. */
  private syncMarkdownActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const wanted = view.file ? this.isBoard(view.file) : false;
      const existing = view.containerEl.querySelector(`.view-actions .${BOARD_ACTION_CLASS}`);
      if (wanted && !existing) {
        const action = view.addAction("layout-grid", "Open as Folia Kanban board", () => {
          // Read the file at click time: one MarkdownView outlives the file it started on.
          const current = view.file;
          if (current) void this.openBoardFrom(leaf, current.path);
        });
        action.addClass(BOARD_ACTION_CLASS);
      } else if (!wanted && existing) {
        existing.remove();
      }
    }
  }

  private removeMarkdownActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      leaf.view.containerEl.querySelector(`.view-actions .${BOARD_ACTION_CLASS}`)?.remove();
    }
  }

  /** The Markdown editor's button. In a normal tab it swaps in place; from a sidebar it sends
   *  the board to a real tab instead, because a dock has no room for one. */
  private async openBoardFrom(leaf: WorkspaceLeaf, filePath: string): Promise<void> {
    if (this.isEditingSurface(leaf)) await this.showBoardIn(leaf, filePath, true);
    else await this.openBoard(filePath);
  }

  /** Swap a tab to the board, same leaf, same file. */
  async showBoardIn(leaf: WorkspaceLeaf, filePath: string, focus: boolean): Promise<void> {
    // Flush whatever the user typed before the editor goes away.
    if (leaf.view instanceof MarkdownView) await leaf.view.save();
    this.markdownTabs.delete(leaf);
    const state: NavigableViewState = {
      type: VIEW_TYPE_KANBAN,
      state: { file: filePath },
      popstate: true,
    };
    await leaf.setViewState(state, focus ? { focus: true } : undefined);
  }

  /** Swap a tab to the Markdown editor, same leaf, same file. */
  async showMarkdownIn(leaf: WorkspaceLeaf, filePath: string): Promise<void> {
    const state: NavigableViewState = {
      type: "markdown",
      state: { file: filePath },
      popstate: true,
    };
    this.markdownTabs.set(leaf, filePath);
    await leaf.setViewState(state, { focus: true });
    this.syncMarkdownActions();
  }

  /** The mode a note should open in, or `null` when it is not a board. A cold metadata cache
   *  also answers `null`: opening a board as plain Markdown once is a nuisance, opening an
   *  ordinary note as a board is a bug. */
  private resolveMode(file: TFile): BoardViewMode | null {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return null;
    return resolveBoardViewMode(cache.frontmatter, this.settings.boardNoteDefaultView);
  }

  private shouldOpenAsBoard(filePath: string): boolean {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    return file instanceof TFile && this.resolveMode(file) === "board";
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Apply a settings patch and push it live into every open board immediately, then persist in
   *  the background. Refreshing before the write resolves (not after) matters for any caller that
   *  reads a patch back off the live `settings` prop to build its next one — the subitems-collapse
   *  toggle does this on every click (§ collapse) — because waiting on the write first would let a
   *  second update land before the first was visible anywhere, and silently lose it. */
  async updateSettings(patch: Partial<KanbanSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    this.refreshViews();
    await this.saveSettings();
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

  override display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Board notes — open as")
      .setDesc(
        "How a note with `folia-board: true` opens from the file explorer, a link, search or the quick switcher. A single note can override this with `folia-view: board` or `folia-view: markdown` in its own frontmatter, and the button in the tab header swaps between the two at any time.",
      )
      .addDropdown((d) =>
        d
          .addOption("board", "The board")
          .addOption("markdown", "The markdown editor")
          .setValue(s.boardNoteDefaultView)
          .onChange(
            (v) =>
              void this.plugin.updateSettings({
                boardNoteDefaultView: v as KanbanSettings["boardNoteDefaultView"],
              }),
          ),
      );

    new Setting(containerEl)
      .setName("Card details — presentation")
      .setDesc("How the card detail view is shown.")
      .addDropdown((d) =>
        d
          .addOption("side", "Side panel")
          .addOption("modal", "Modal dialog")
          .setValue(s.detailPresentation)
          .onChange((v) => {
            // Re-render the tab so the side-panel layout row enables/disables to match.
            void this.plugin
              .updateSettings({ detailPresentation: v as KanbanSettings["detailPresentation"] })
              .then(() => this.render());
          }),
      );

    new Setting(containerEl)
      .setName("Side panel — layout")
      .setDesc("Split shrinks the board to make room; float overlays the columns.")
      .setDisabled(s.detailPresentation === "modal")
      .addDropdown((d) =>
        d
          .addOption("split", "Split (shrink the board)")
          .addOption("float", "Float (overlay the columns)")
          .setValue(s.sidePanelMode)
          .setDisabled(s.detailPresentation === "modal")
          .onChange(
            (v) =>
              void this.plugin.updateSettings({
                sidePanelMode: v as KanbanSettings["sidePanelMode"],
              }),
          ),
      );

    new Setting(containerEl)
      .setName("Side panel — width (px)")
      .setDesc("Width of the side detail panel.")
      .addSlider((sl) =>
        sl
          .setLimits(DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX, 10)
          .setValue(s.detailWidth)
          .onChange((v) => void this.plugin.updateSettings({ detailWidth: v })),
      );

    new Setting(containerEl)
      .setName("Add-card button — flow")
      .setDesc(
        "Inline adds a card in place; inline-edit then opens the new card's details; detail opens the details to create.",
      )
      .addDropdown((d) =>
        d
          .addOption("inline", "Inline")
          .addOption("inline-edit", "Inline, then open details")
          .addOption("detail", "Open details to create")
          .setValue(s.addCardFlow)
          .onChange((v) => {
            // Re-render so the "open new card's details as" row enables/disables to match.
            void this.plugin
              .updateSettings({ addCardFlow: v as KanbanSettings["addCardFlow"] })
              .then(() => this.render());
          }),
      );

    new Setting(containerEl)
      .setName("Add-card — open new card's details as")
      .setDesc("How the new card's details open (only used when the flow opens details).")
      .setDisabled(s.addCardFlow === "inline")
      .addDropdown((d) =>
        d
          .addOption("default", "Use the card-details setting")
          .addOption("modal", "Modal dialog")
          .addOption("side-float", "Side panel (float)")
          .addOption("side-split", "Side panel (split)")
          .setValue(s.addCardOpenMode)
          .setDisabled(s.addCardFlow === "inline")
          .onChange(
            (v) =>
              void this.plugin.updateSettings({
                addCardOpenMode: v as KanbanSettings["addCardOpenMode"],
              }),
          ),
      );

    new Setting(containerEl)
      .setName("Card — next todos shown")
      .setDesc("How many of the next undone todos to preview on each card (0 = none).")
      .addSlider((sl) =>
        sl
          .setLimits(0, 5, 1)
          .setValue(s.cardNextTodos)
          .onChange((v) => void this.plugin.updateSettings({ cardNextTodos: v })),
      );

    new Setting(containerEl)
      .setName("Subitems — default state")
      .setDesc(
        "Whether a card's nested subitems (inline todos preview + subcard files) start expanded or collapsed. Toggling a card, or a column's collapse/expand-all, overrides this per card.",
      )
      .addDropdown((d) =>
        d
          .addOption("expanded", "Expanded")
          .addOption("collapsed", "Collapsed")
          .setValue(s.subitemsDefault)
          .onChange(
            (v) =>
              void this.plugin.updateSettings({
                subitemsDefault: v as KanbanSettings["subitemsDefault"],
              }),
          ),
      );

    new Setting(containerEl)
      .setName("Your name")
      .setDesc(
        "Signs the comments you write from the board (e.g. \u201calex\u201d \u2192 \u201c- _2026-08-21 11:49 @alex:_ \u2026\u201d), so your own comments never show as unread and a comment landing after one of yours reads as a reply. Leave empty to write comments unsigned.",
      )
      .addText((t) =>
        t
          .setPlaceholder("Alex")
          .setValue(this.plugin.settings.userName)
          .onChange((v) => void this.plugin.updateSettings({ userName: v.trim() })),
      );

    new Setting(containerEl)
      .setName("History — what to record")
      .setDesc(
        "Moves = card moves/reorders only (default); structural = also priority/status/due/order changes; all = also comments + subtasks.",
      )
      .addDropdown((d) =>
        d
          .addOption("moves", "Moves only")
          .addOption("structural", "Structural changes")
          .addOption("all", "Everything")
          .setValue(s.historyScope)
          .onChange(
            (v) =>
              void this.plugin.updateSettings({
                historyScope: v as KanbanSettings["historyScope"],
              }),
          ),
      );

    new Setting(containerEl)
      .setName("Board — horizontal drag")
      .setDesc(
        "How to pan the board sideways. Shift+drag pans from anywhere (incl. over cards); click and drag pans only from empty board space, leaving cards and columns free. Middle-button drag always pans.",
      )
      .addDropdown((d) =>
        d
          .addOption("shift", "Shift + click and drag")
          .addOption("empty", "Click and drag (empty space only)")
          .setValue(s.boardPan)
          .onChange(
            (v) => void this.plugin.updateSettings({ boardPan: v as KanbanSettings["boardPan"] }),
          ),
      );

    // Read from the manifest so it always reflects the installed build, never a hardcoded value.
    new Setting(containerEl).setName("Version").setDesc(this.plugin.manifest.version);
  }
}
