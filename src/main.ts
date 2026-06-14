import { Notice, Plugin, PluginSettingTab, Setting, TFile, type App } from "obsidian";
import { KanbanView, VIEW_TYPE_KANBAN } from "./view";

interface KanbanSettings {
  boardPath: string;
}

const DEFAULT_SETTINGS: KanbanSettings = { boardPath: "" };

export default class MarkdownKanbanPlugin extends Plugin {
  settings: KanbanSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_KANBAN, (leaf) => new KanbanView(leaf));

    this.addRibbonIcon("layout-grid", "Open Kanban board", () => void this.activateView());
    this.addCommand({
      id: "open-kanban-board",
      name: "Open Kanban board",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new KanbanSettingTab(this.app, this));
  }

  async activateView(): Promise<void> {
    const boardPath = this.resolveBoardPath();
    if (!boardPath) {
      new Notice(
        "Markdown Kanban: no board note found. Add `kanban-board: true` to a note's frontmatter (and `columns` + `card-folder`).",
        8000,
      );
      return;
    }
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_KANBAN)[0] ?? null;
    if (!leaf) leaf = workspace.getLeaf(true); // wide board → main area tab
    await leaf.setViewState({ type: VIEW_TYPE_KANBAN, active: true, state: { boardPath } });
    await workspace.revealLeaf(leaf);
  }

  /** Configured board note, else the first note flagged `kanban-board: true`. */
  resolveBoardPath(): string | null {
    if (this.settings.boardPath) {
      const f = this.app.vault.getAbstractFileByPath(this.settings.boardPath);
      if (f instanceof TFile) return f.path;
    }
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm && fm["kanban-board"] === true) return f.path;
    }
    return null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class KanbanSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MarkdownKanbanPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Board note")
      .setDesc("Path to the note that defines the board (frontmatter: kanban-board, columns, card-folder). Leave empty to auto-detect.")
      .addText((t) =>
        t
          .setPlaceholder("Kanban Board.md")
          .setValue(this.plugin.settings.boardPath)
          .onChange(async (v) => {
            this.plugin.settings.boardPath = v.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}
