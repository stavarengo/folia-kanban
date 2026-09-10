import type { TFile, WorkspaceLeaf } from "obsidian";
import { FileView, Scope, type KeymapEventListener } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App as BoardApp, type BoardHost } from "./ui/App";
import { VaultRepository } from "./obsidian/vaultRepo";
import type { KanbanSettings, SettingsPatch } from "./settings";

export const VIEW_TYPE_KANBAN = "folia-kanban-view";

/**
 * The board. It is a `FileView` rather than a plain `ItemView` so the leaf genuinely owns the
 * board note: the file explorer highlights it, `getActiveFile()` returns it, renames follow, and
 * the same tab can be handed back and forth between this view and the Markdown editor without
 * either side having to remember which file it was showing.
 */
export class KanbanView extends FileView {
  /** The board can sit in a leaf that has no file yet (a fresh tab, a stale saved layout). */
  override allowNoFile = true;

  /**
   * A `FileView` is navigable by default, which would make the board's tab a candidate for
   * "open this file in the current pane" — and since the board accepts any `.md`, opening a card
   * from the board would quietly replace the board with that card, in place, in the same tab.
   * The board is a place you open things *from*, so it is not one Obsidian may navigate away.
   */
  override navigation = false;

  private root: Root | null = null;
  private repo: VaultRepository | null = null;
  private repoPath: string | null = null;
  /**
   * Stable across renders on purpose: the board binds its shortcut in an effect keyed on this
   * object, so a new one on every re-render would unbind and rebind on every settings change.
   */
  private readonly host: BoardHost = {
    bindSearchShortcut: (onSlash) => {
      const scope = this.scope;
      if (!scope) return () => {};
      // Both ways a keyboard types a plain "/": bare, and with Shift, which is how a German layout
      // does it. Deliberately not `null` modifiers, which would match Mod+/ as well and take that
      // combination away from whatever the user has bound to it.
      const take: KeymapEventListener = (evt) => onSlash(evt) !== true;
      const registered = [scope.register([], "/", take), scope.register(["Shift"], "/", take)];
      // Registered on bind rather than for the life of the view, because a scope match is final:
      // Obsidian stops looking the moment a registered key matches, whatever the handler returns.
      // A view that leaves "/" registered while it has no search box to focus — still loading,
      // failed to load, a tab with no board note yet — would silently eat the key.
      return () => registered.forEach((handler) => scope.unregister(handler));
    },
    onPlacementChange: (cb) => {
      const ref = this.app.workspace.on("layout-change", cb);
      return () => this.app.workspace.offref(ref);
    },
  };

  constructor(
    leaf: WorkspaceLeaf,
    private getSettings: () => KanbanSettings,
    private updateSettings: (patch: SettingsPatch) => void,
    private openAsMarkdown: (view: KanbanView) => void,
  ) {
    super(leaf);
    // A view scope runs only while its leaf has focus, which is what makes "/" belong to one board:
    // with two boards open side by side, the other one never sees the key. The app scope is the
    // parent so every global hotkey still resolves while a board is focused. It starts empty; the
    // board fills it through `host` for exactly as long as it has a search box.
    this.scope = new Scope(this.app.scope);
  }

  getViewType(): string {
    return VIEW_TYPE_KANBAN;
  }

  override canAcceptExtension(extension: string): boolean {
    return extension === "md";
  }

  override getDisplayText(): string {
    return this.file ? `${this.file.basename} - Folia Kanban` : "Folia Kanban";
  }

  override getIcon(): string {
    return "layout-grid";
  }

  /**
   * `FileView` keys its state on `file`. Layouts saved before the board became a `FileView`
   * carry `boardPath` instead, so read that too — otherwise every board tab a user already had
   * open would come back empty after an upgrade.
   */
  override async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = state as { file?: unknown; boardPath?: unknown } | null;
    const legacy = typeof s?.file !== "string" && typeof s?.boardPath === "string";
    await super.setState(legacy ? { ...s, file: s.boardPath } : state, result);
    this.renderApp();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    this.rebindTo(file.path);
    this.renderApp();
  }

  /** Drop the repository when the board it was built for is no longer the board we are showing. */
  private rebindTo(path: string): void {
    if (this.repoPath === path) return;
    this.repo = null;
    this.repoPath = path;
  }

  /**
   * A rename moves the file without reloading it, so `onLoadFile` never runs. The repository is
   * built around a path string, so without this it would keep reading and writing the board note
   * at its old location — and resolving `card-folder` against the folder the note just left.
   */
  override async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    this.rebindTo(file.path);
    this.renderApp();
  }

  override async onOpen(): Promise<void> {
    this.addAction("file-text", "Edit as markdown", () => this.openAsMarkdown(this));
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
    const boardPath = this.file?.path ?? null;
    if (!boardPath) {
      this.root.render(
        <div className="folia-loading">
          Open a board note (any note with <code>folia-board: true</code> in its frontmatter), or
          run the “Open Folia Kanban board” command.
        </div>,
      );
      return;
    }
    // The repo reads the history scope and the comment signature live via getters, so settings
    // changes don't require rebuilding it — only a file change does (handled in onLoadFile).
    if (!this.repo)
      this.repo = new VaultRepository(
        this.app,
        boardPath,
        () => this.getSettings().historyScope,
        () => this.getSettings().userName,
      );
    this.root.render(
      <StrictMode>
        <BoardApp
          repo={this.repo}
          settings={this.getSettings()}
          onUpdateSettings={this.updateSettings}
          host={this.host}
        />
      </StrictMode>,
    );
  }
}
