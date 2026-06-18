import type { TFile } from "obsidian";
import { FuzzySuggestModal, Notice, Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import { KanbanView, VIEW_TYPE_KANBAN } from "./view";
import {
  DEFAULT_SETTINGS,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  type KanbanSettings,
} from "./settings";

export default class FoliaKanbanPlugin extends Plugin {
  override settings: KanbanSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_KANBAN,
      (leaf) =>
        new KanbanView(
          leaf,
          () => this.settings,
          (p) => void this.updateSettings(p),
        ),
    );

    this.addRibbonIcon("layout-grid", "Open Folia Kanban board", () => void this.activateView());
    this.addCommand({
      id: "folia-open-kanban-board",
      name: "Open Folia Kanban board",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new KanbanSettingTab(this.app, this));
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
    return this.app.vault.getMarkdownFiles().filter((f) => this.isBoard(f));
  }

  private isBoard(f: TFile): boolean {
    return this.app.metadataCache.getFileCache(f)?.frontmatter?.["folia-board"] === true;
  }

  private async openBoard(boardPath: string): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_KANBAN)[0] ?? null;
    if (!leaf) leaf = workspace.getLeaf(true); // wide board → main area tab
    await leaf.setViewState({ type: VIEW_TYPE_KANBAN, active: true, state: { boardPath } });
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Apply a settings patch, persist it, then push it live into every open board. */
  async updateSettings(patch: Partial<KanbanSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.saveSettings();
    this.refreshViews();
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
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

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
              .then(() => this.display());
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
          .setDynamicTooltip()
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
              .then(() => this.display());
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
          .setDynamicTooltip()
          .onChange((v) => void this.plugin.updateSettings({ cardNextTodos: v })),
      );

    new Setting(containerEl)
      .setName("History — what to record")
      .setDesc(
        "moves = card moves/reorders only (default); structural = also priority/status/due/order changes; all = also comments + subtasks.",
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
  }
}
