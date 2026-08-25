// The contract the UI depends on. The Obsidian implementation lives in vaultRepo.ts;
// tests use an in-memory fake. Keeping the UI behind this interface is what lets us
// verify board behaviour headlessly.

import type { Board, CardBody, CardFrontmatter, ColumnDef, ContextConfig } from "./types";
import type { CardMutation } from "./board";

export interface CardRepository {
  /**
   * Read the board config note + all cards, return the assembled board. When the card folder is
   * merely worth a remark — it doesn't exist yet, or the setting reads as two existing folders —
   * the board still loads and carries `cardFolderWarning` instead of failing; see
   * {@link Board.cardFolderWarning}.
   */
  loadBoard(): Promise<Board>;
  /**
   * Scan the card folder's immediate subfolders for contexts (#14), keyed by subfolder name.
   * Each subfolder is a context; an optional `_context.md` note supplies its name/color/label/body
   * (missing note → name = folder, no color/label, empty body). Read-only.
   */
  loadContexts(): Promise<Record<string, ContextConfig>>;
  /** Parse a card's body for the detail panel. */
  readBody(path: string): Promise<CardBody>;

  /** Apply a drag result: status + order frontmatter and a history line. */
  applyMove(mutation: CardMutation): Promise<void>;

  setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void>;
  /** Remove a single frontmatter key (byte-stable for the other keys + their order). */
  unsetFrontmatterKey(path: string, key: string): Promise<void>;
  setDescription(path: string, description: string): Promise<void>;
  addComment(path: string, text: string): Promise<void>;
  /** Replace the text of the index-th comment, keeping its timestamp + every other byte. */
  updateComment(path: string, index: number, text: string): Promise<void>;
  /** Delete the index-th comment line only. */
  removeComment(path: string, index: number): Promise<void>;
  addTodo(path: string, text: string): Promise<void>;
  toggleSubtask(path: string, index: number, done: boolean): Promise<void>;
  removeSubtask(path: string, index: number): Promise<void>;

  /** Create a new top-level card in a column. Returns its path. */
  createCard(title: string, status: string): Promise<string>;
  /** Create a child card and link it from the parent's checklist. Returns child path. */
  addSubcard(parentPath: string, title: string): Promise<string>;
  /** Move a card's note to the trash. */
  deleteCard(path: string): Promise<void>;
  /**
   * Retitle a card by writing to whichever source its title currently comes from (see
   * `Card.titleSource`): the `title` frontmatter key, the heading line, or the `.md` file name.
   * A file rename goes through Obsidian's link-aware rename so every inbound `[[wikilink]]`
   * (e.g. a parent's `## Subtasks` link) is rewritten to follow. Returns the card's (possibly
   * new) path. A blank/unchanged title is a no-op that returns the original path.
   */
  renameCard(path: string, newTitle: string): Promise<string>;

  /** Persist column definitions to the board note frontmatter. */
  setColumns(columns: ColumnDef[]): Promise<void>;

  /**
   * Fold priority values into the board note's remembered vocabulary, so each one survives the
   * last card that used it. Additive on purpose: the note's current list wins on order and is
   * never shrunk, so two edits in flight at once cannot drop each other's value. Writes nothing
   * when every value is already remembered. Pruning the list stays a hand edit of the note.
   */
  rememberPriorities(values: string[]): Promise<void>;

  /** Open a card note in the workspace. */
  openCard(path: string): Promise<void>;

  /**
   * Render markdown into `el` using the host's engine (Obsidian's MarkdownRenderer in the vault
   * adapter; plain text in tests). `sourcePath` resolves links/embeds relative to that note.
   * Returns a cleanup function the caller runs on unmount / before re-rendering.
   */
  renderMarkdown(el: HTMLElement, markdown: string, sourcePath: string): () => void;

  /** Subscribe to external changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
}
