// The contract the UI depends on. The Obsidian implementation lives in vaultRepo.ts;
// tests use an in-memory fake. Keeping the UI behind this interface is what lets us
// verify board behaviour headlessly.

import type { Board, CardBody, CardFrontmatter, ColumnDef } from "../model/types";
import type { CardMutation } from "../model/board";

export interface CardRepository {
  /** Read the board config note + all cards, return the assembled board. */
  loadBoard(): Promise<Board>;
  /** Parse a card's body for the detail panel. */
  readBody(path: string): Promise<CardBody>;

  /** Apply a drag result: status + order frontmatter and a history line. */
  applyMove(mutation: CardMutation): Promise<void>;

  setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void>;
  setDescription(path: string, description: string): Promise<void>;
  addComment(path: string, text: string): Promise<void>;
  addTodo(path: string, text: string): Promise<void>;
  toggleSubtask(path: string, index: number, done: boolean): Promise<void>;
  removeSubtask(path: string, index: number): Promise<void>;

  /** Create a new top-level card in a column. Returns its path. */
  createCard(title: string, status: string): Promise<string>;
  /** Create a child card and link it from the parent's checklist. Returns child path. */
  addSubcard(parentPath: string, title: string): Promise<string>;

  /** Persist column definitions to the board note frontmatter. */
  setColumns(columns: ColumnDef[]): Promise<void>;

  /** Open a card note in the workspace. */
  openCard(path: string): Promise<void>;

  /** Subscribe to external changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
}
