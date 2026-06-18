// The contract the UI depends on. The Obsidian implementation lives in vaultRepo.ts;
// tests use an in-memory fake. Keeping the UI behind this interface is what lets us
// verify board behaviour headlessly.

import type { Board, CardBody, CardFrontmatter, ColumnDef, ContextConfig } from "./types";
import type { CardMutation } from "./board";

export interface CardRepository {
  /** Read the board config note + all cards, return the assembled board. */
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
   * Rename a card by renaming its `.md` file (the basename IS the board's card title). Goes
   * through Obsidian's link-aware rename so every inbound `[[wikilink]]` (e.g. a parent's
   * `## Subtasks` link) is rewritten to follow. Returns the card's new path. A blank/unchanged
   * title is a no-op that returns the original path.
   */
  renameCard(path: string, newTitle: string): Promise<string>;

  /** Persist column definitions to the board note frontmatter. */
  setColumns(columns: ColumnDef[]): Promise<void>;

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
