import type { App, PaneType, TFile, WorkspaceLeaf } from "obsidian";
import { Keymap, MarkdownView, Notice, View } from "obsidian";
import { KanbanView } from "../view";
import { VIEW_TYPE_KANBAN } from "../viewType";
import type { FileOp } from "../model/pathOps";
import { remapPath } from "../model/pathOps";
import type { BoardViewMode } from "../settings";
import { isBoardFrontmatter } from "./viewMode";
import { markdownTabOutcome } from "./boardRedirect";
import { BoardChooserModal } from "./boardChooserModal";

/** Re-point, or drop, a per-tab path record after a rename or delete. */
function follow<K extends object>(record: WeakMap<K, string>, key: K, op: FileOp): void {
  const current = record.get(key);
  if (current === undefined) return;
  const next = remapPath(current, op);
  if (next === null) record.delete(key);
  else if (next !== current) record.set(key, next);
}

/**
 * Which tab shows a board note, and as what: the board, or the Markdown editor the user asked for.
 * Holds what the plugin remembers per tab to keep those two apart, and opens boards into tabs.
 */
export class BoardTabs {
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

  constructor(
    private app: App,
    /** The `boardNoteDefaultView` setting, read when a tab is decided about. */
    private defaultView: () => BoardViewMode,
    /** Whether the plugin has unloaded, which ends every wait below. */
    private isUnloaded: () => boolean,
  ) {}

  /**
   * Show a board note that has just come up in a Markdown tab as the board instead, in the same
   * tab. There is no documented way to step into an open before the editor is drawn, so this
   * swaps after it: the editor can show for a moment first. See `docs/decisions.md`, "Board notes
   * open as the board by swapping after the open".
   */
  redirectToBoard(leaf: WorkspaceLeaf | null): void {
    const view = leaf?.view;
    if (!leaf || !(view instanceof MarkdownView) || !view.file) return;
    const path = view.file.path;
    const outcome = markdownTabOutcome({
      cache: this.app.metadataCache.getFileCache(view.file),
      fallback: this.defaultView(),
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
    const pending = (): boolean =>
      !this.isUnloaded() && leaf.view === view && view.file?.path === path;
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
  async redirectOpenOf(file: TFile): Promise<void> {
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
    while (!leaf && mayBeBoard() && !this.isUnloaded() && Date.now() < until) {
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
  syncMarkdownActions(): void {
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

  removeMarkdownActions(): void {
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

  /** Ask again about the tabs that opened `file` before the metadata cache had read it. */
  retryColdOpens(file: TFile): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (this.coldOpens.get(leaf) !== file.path) return;
      this.coldOpens.delete(leaf);
      if (leaf.view instanceof MarkdownView && leaf.view.file === file) this.redirectToBoard(leaf);
    });
  }

  /**
   * Re-point, or drop, the per-tab records after a rename or delete. Left pointing at the old path,
   * the "put in the Markdown editor" record would let the next state replay send the tab back to
   * the board — the exact thing it exists to prevent — and the "already decided" one would treat
   * the next switch back to the tab as a fresh open. A WeakMap cannot be walked, so walk the leaves.
   */
  followFileOp(op: FileOp): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      follow(this.markdownTabs, leaf, op);
      if (leaf.view instanceof MarkdownView) follow(this.decided, leaf.view, op);
    });
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

  /** `newLeaf` is what the click asked for, as `Keymap.isModEvent` reads it: false for a plain
   *  click, which leaves the choice of tab to {@link openBoard}. */
  async activateView(newLeaf: PaneType | boolean = false): Promise<void> {
    // If the note in the editor is itself a board, open that one — no prompting.
    const active = this.app.workspace.getActiveFile();
    if (active && this.isBoard(active)) {
      await this.openBoard(active.path, newLeaf);
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
      if (board) await this.openBoard(board.path, newLeaf);
      return;
    }
    // Several boards — let the user pick which to open. A modifier held on the pick decides where it
    // goes; without one, the click that raised the chooser still does.
    new BoardChooserModal(
      this.app,
      boards,
      (f, evt) => void this.openBoard(f.path, Keymap.isModEvent(evt) || newLeaf),
    ).open();
  }

  /** Every note flagged `folia-board: true` in its frontmatter. */
  findBoards(): TFile[] {
    // Boards can live anywhere in the vault (any note with `folia-board: true` frontmatter), so
    // discovery scans every note. The full-vault enumeration is intentional and limited to markdown.
    return this.app.vault.getMarkdownFiles().filter((f) => this.isBoard(f));
  }

  isBoard(f: TFile): boolean {
    return isBoardFrontmatter(this.app.metadataCache.getFileCache(f)?.frontmatter);
  }

  /** `newLeaf` set means the user asked for a new tab, split or window with a modifier key, and
   *  gets one even when a tab already shows this board, as Ctrl/Cmd-click does in the explorer. */
  private async openBoard(boardPath: string, newLeaf: PaneType | boolean = false): Promise<void> {
    const { workspace } = this.app;
    // A tab already holding this note — as the board or as Markdown — is the one the user means.
    // Otherwise reuse an existing board tab, and only then open a new one (a board wants width).
    const leaf = newLeaf
      ? workspace.getLeaf(newLeaf)
      : (this.leafShowing(VIEW_TYPE_KANBAN, boardPath) ??
        this.leafShowing("markdown", boardPath) ??
        workspace.getLeavesOfType(VIEW_TYPE_KANBAN).find((l) => this.isEditingSurface(l)) ??
        workspace.getLeaf(true));
    await this.showBoardIn(leaf, boardPath, true);
    await workspace.revealLeaf(leaf);
  }

  leafShowing(viewType: string, filePath: string): WorkspaceLeaf | null {
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
}
