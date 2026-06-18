import type { WorkspaceLeaf } from "obsidian";
import { ItemView, TFile } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App as BoardApp } from "./ui/App";
import { VaultRepository } from "./obsidian/vaultRepo";
import type { KanbanSettings } from "./settings";

export const VIEW_TYPE_KANBAN = "folia-kanban-view";

export class KanbanView extends ItemView {
  private root: Root | null = null;
  private boardPath: string | null = null;
  private repo: VaultRepository | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private getSettings: () => KanbanSettings,
    private updateSettings: (patch: Partial<KanbanSettings>) => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_KANBAN;
  }

  getDisplayText(): string {
    if (!this.boardPath) return "Folia Kanban";
    const file = this.app.vault.getAbstractFileByPath(this.boardPath);
    const name = file instanceof TFile ? file.basename : this.boardPath.replace(/\.md$/, "");
    return `${name} - Folia Kanban`;
  }

  override getIcon(): string {
    return "layout-grid";
  }

  // Obsidian persists/restores the board path through the view state.
  override async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = state as { boardPath?: string } | null;
    if (s?.boardPath && s.boardPath !== this.boardPath) {
      this.boardPath = s.boardPath;
      this.repo = null; // rebuild repo for the new board
    }
    await super.setState(state, result);
    this.renderApp();
  }

  override getState(): Record<string, unknown> {
    return { boardPath: this.boardPath };
  }

  override async onOpen(): Promise<void> {
    this.renderApp();
  }

  /** Re-render with the latest settings. Called by the plugin after a settings change. */
  refresh(): void {
    this.renderApp();
  }

  override async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  private renderApp(): void {
    if (!this.root) this.root = createRoot(this.contentEl);
    if (!this.boardPath) {
      this.root.render(
        <div className="folia-loading">
          Open a board with the “Open Folia Kanban board” command (it looks for a note with
          <code> folia-board: true</code> in its frontmatter).
        </div>,
      );
      return;
    }
    // The repo reads the history scope live via the getter, so settings changes don't
    // require rebuilding it — only a boardPath change does (handled in setState).
    if (!this.repo)
      this.repo = new VaultRepository(
        this.app,
        this.boardPath,
        () => this.getSettings().historyScope,
      );
    this.root.render(
      <StrictMode>
        <BoardApp
          repo={this.repo}
          settings={this.getSettings()}
          onUpdateSettings={this.updateSettings}
        />
      </StrictMode>,
    );
  }
}
