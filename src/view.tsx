import { ItemView, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App as BoardApp } from "./ui/App";
import { VaultRepository } from "./obsidian/vaultRepo";

export const VIEW_TYPE_KANBAN = "markdown-kanban-view";

export class KanbanView extends ItemView {
  private root: Root | null = null;
  private boardPath: string | null = null;
  private repo: VaultRepository | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_KANBAN;
  }

  getDisplayText(): string {
    return "Kanban board";
  }

  getIcon(): string {
    return "layout-grid";
  }

  // Obsidian persists/restores the board path through the view state.
  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = state as { boardPath?: string } | null;
    if (s?.boardPath && s.boardPath !== this.boardPath) {
      this.boardPath = s.boardPath;
      this.repo = null; // rebuild repo for the new board
    }
    await super.setState(state, result);
    this.renderApp();
  }

  getState(): Record<string, unknown> {
    return { boardPath: this.boardPath };
  }

  async onOpen(): Promise<void> {
    this.renderApp();
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  private renderApp(): void {
    if (!this.root) this.root = createRoot(this.contentEl);
    if (!this.boardPath) {
      this.root.render(
        <div className="mdkb-loading">
          Open a board with the “Open Kanban board” command (it looks for a note with
          <code> kanban-board: true</code> in its frontmatter).
        </div>,
      );
      return;
    }
    if (!this.repo) this.repo = new VaultRepository(this.app, this.boardPath);
    this.root.render(
      <StrictMode>
        <BoardApp repo={this.repo} />
      </StrictMode>,
    );
  }
}
