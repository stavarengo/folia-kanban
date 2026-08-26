import type { SettingDefinitionItem, ViewState } from "obsidian";
import {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requireApiVersion,
  TFile,
  WorkspaceLeaf,
  type App,
} from "obsidian";
import { KanbanView, VIEW_TYPE_KANBAN } from "./view";
import {
  DEFAULT_SETTINGS,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  applySettingsPatch,
  hydrateSettings,
  type KanbanSettings,
  type SettingsPatch,
} from "./settings";
import {
  CARD_NEXT_TODOS_MAX,
  SETTING_COPY,
  SETTING_OPTIONS,
  USER_NAME_PLACEHOLDER,
  VERSION_SETTING_NAME,
  settingDefinitions,
  settingsPatchFor,
} from "./settingsDefinitions";
import { stamp } from "./model/dates";
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
    // The unbound reference is never invoked detached: it is only re-attached to the prototype on
    // unregister, and every call below goes through `original.call(this, ...)`, which supplies the
    // leaf explicitly.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- see the note above
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
    const { settings, stampedBaseline } = hydrateSettings(loaded, stamp());
    this.settings = settings;
    // Persisted right away: the baseline is "when tracking started", and it must not drift to a
    // later launch if nothing else happens to save the settings before then.
    if (stampedBaseline) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Apply a settings patch and push it live into every open board immediately, then persist in
   *  the background. Refreshing before the write resolves (not after) matters for any caller that
   *  reads a patch back off the live `settings` prop to build its next one — the subitems-collapse
   *  toggle does this on every click (§ collapse) — because waiting on the write first would let a
   *  second update land before the first was visible anywhere, and silently lose it. */
  async updateSettings(patch: SettingsPatch): Promise<void> {
    const next = applySettingsPatch(this.settings, patch);
    if (next === this.settings) return;
    this.settings = next;
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

  /**
   * The name typed but not committed yet. Committing per keystroke would save + re-render every
   * open board nine times for "alexandra", and each intermediate value is a DIFFERENT reader as far
   * as comment read-state is concerned — so a half-typed name reaching an open card's read marker
   * would leave it recorded under someone who does not exist. It lands on blur, or when the tab
   * closes, whichever comes first.
   */
  private pendingUserName: string | null = null;

  /**
   * The tab as data, so Obsidian 1.13 and later renders it itself and — the point of it — indexes
   * every setting for the settings search. Below 1.13 this method is never called and `display()`
   * below draws the same rows imperatively; both read their wording from `SETTING_COPY`.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return settingDefinitions(() => this.plugin.settings, this.plugin.manifest.version);
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
      // The rows that depend on this one (side-panel layout, add-card open mode) enable or disable
      // from a predicate; this is what re-evaluates them without redrawing the tab. Only 1.13 and
      // later reaches this method at all, but the version is asked anyway: the API is @since 1.13.0
      // and minAppVersion is 1.7.2, so an unguarded call is a promise the manifest does not make.
      if (requireApiVersion("1.13.0")) this.refreshDomState();
    });
  }

  override display(): void {
    this.render();
  }

  override hide(): void {
    this.commitUserName();
    super.hide();
  }

  private commitUserName(): void {
    const name = this.pendingUserName;
    this.pendingUserName = null;
    if (name !== null && name !== this.plugin.settings.userName)
      void this.plugin.updateSettings({ userName: name });
  }

  /** The imperative tab, for Obsidian below 1.13. Obsidian 1.13 and later never calls this: it
   *  renders `getSettingDefinitions()` instead. */
  private render(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    const dropdownRow = (
      key: keyof typeof SETTING_OPTIONS,
      value: string,
      onChange: (v: string) => void,
      disabled = false,
    ): void => {
      new Setting(containerEl)
        .setName(SETTING_COPY[key].name)
        .setDesc(SETTING_COPY[key].desc)
        .setDisabled(disabled)
        .addDropdown((d) =>
          d
            .addOptions(SETTING_OPTIONS[key])
            .setValue(value)
            .setDisabled(disabled)
            .onChange(onChange),
        );
    };

    dropdownRow(
      "boardNoteDefaultView",
      s.boardNoteDefaultView,
      (v) =>
        void this.plugin.updateSettings({
          boardNoteDefaultView: v as KanbanSettings["boardNoteDefaultView"],
        }),
    );

    dropdownRow("detailPresentation", s.detailPresentation, (v) => {
      // Re-render the tab so the side-panel layout row enables/disables to match.
      void this.plugin
        .updateSettings({ detailPresentation: v as KanbanSettings["detailPresentation"] })
        .then(() => this.render());
    });

    dropdownRow(
      "sidePanelMode",
      s.sidePanelMode,
      (v) =>
        void this.plugin.updateSettings({ sidePanelMode: v as KanbanSettings["sidePanelMode"] }),
      s.detailPresentation === "modal",
    );

    new Setting(containerEl)
      .setName(SETTING_COPY.detailWidth.name)
      .setDesc(SETTING_COPY.detailWidth.desc)
      .addSlider((sl) =>
        sl
          .setLimits(DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX, 10)
          .setValue(s.detailWidth)
          .onChange((v) => void this.plugin.updateSettings({ detailWidth: v })),
      );

    dropdownRow("addCardFlow", s.addCardFlow, (v) => {
      // Re-render so the "open new card's details as" row enables/disables to match.
      void this.plugin
        .updateSettings({ addCardFlow: v as KanbanSettings["addCardFlow"] })
        .then(() => this.render());
    });

    dropdownRow(
      "addCardOpenMode",
      s.addCardOpenMode,
      (v) =>
        void this.plugin.updateSettings({
          addCardOpenMode: v as KanbanSettings["addCardOpenMode"],
        }),
      s.addCardFlow === "inline",
    );

    new Setting(containerEl)
      .setName(SETTING_COPY.cardNextTodos.name)
      .setDesc(SETTING_COPY.cardNextTodos.desc)
      .addSlider((sl) =>
        sl
          .setLimits(0, CARD_NEXT_TODOS_MAX, 1)
          .setValue(s.cardNextTodos)
          .onChange((v) => void this.plugin.updateSettings({ cardNextTodos: v })),
      );

    dropdownRow(
      "subitemsDefault",
      s.subitemsDefault,
      (v) =>
        void this.plugin.updateSettings({
          subitemsDefault: v as KanbanSettings["subitemsDefault"],
        }),
    );

    new Setting(containerEl)
      .setName(SETTING_COPY.userName.name)
      .setDesc(SETTING_COPY.userName.desc)
      .addText((t) => {
        t.setPlaceholder(USER_NAME_PLACEHOLDER)
          .setValue(this.plugin.settings.userName)
          .onChange((v) => {
            this.pendingUserName = v.trim();
          });
        t.inputEl.addEventListener("blur", () => this.commitUserName());
      });

    dropdownRow(
      "historyScope",
      s.historyScope,
      (v) => void this.plugin.updateSettings({ historyScope: v as KanbanSettings["historyScope"] }),
    );

    dropdownRow(
      "boardPan",
      s.boardPan,
      (v) => void this.plugin.updateSettings({ boardPan: v as KanbanSettings["boardPan"] }),
    );

    // Read from the manifest so it always reflects the installed build, never a hardcoded value.
    new Setting(containerEl).setName(VERSION_SETTING_NAME).setDesc(this.plugin.manifest.version);
  }
}
