import { createContext, useContext } from "react";
import type { CardRepository } from "../obsidian/repo";
import type { ColumnDef, ContextConfig } from "../model/types";
import type { KanbanSettings } from "../settings";

export const RepoContext = createContext<CardRepository | null>(null);

/**
 * Context configs (#14) keyed by subfolder name, provided by App. Lives in its own React context
 * (not a CardItem prop) so a `_context.md` edit re-renders the markers even though the memoized
 * cards' path/frontmatter are unchanged. Defaults to an empty map (boards with no subfolders).
 */
export const ContextsContext = createContext<Record<string, ContextConfig>>({});

export function useContexts(): Record<string, ContextConfig> {
  return useContext(ContextsContext);
}

export function useRepo(): CardRepository {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error("RepoContext is missing a provider");
  return repo;
}

/** Live settings plus an updater, provided by App and fed from the view/plugin. */
export interface SettingsContextValue {
  settings: KanbanSettings;
  update: (patch: Partial<KanbanSettings>) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): KanbanSettings {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("SettingsContext missing");
  return c.settings;
}

export function useSettingsUpdater(): (patch: Partial<KanbanSettings>) => void {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("SettingsContext missing");
  return c.update;
}

/** Card-level actions, provided by App so cards/columns don't prop-drill callbacks. */
export interface BoardActions {
  /** Open the card's detail panel. */
  open(path: string): void;
  /** Start the "create card" detail flow for a column (used by addCardFlow: 'detail'). */
  startCreate(columnId: string): void;
  /** Open the card's detail panel with its "Add a subcard" input focused, so the user types the title there. */
  addSubcard(path: string): void;
  /** Move a card to the board's "done" column, if one exists. */
  complete(path: string): void;
  /** Trash the card's note (after confirmation in the UI). */
  remove(path: string): void;
  /** Open the underlying note in an Obsidian tab. */
  openNote(path: string): void;
  /** Set a card's priority frontmatter (empty string clears it). */
  setPriority(path: string, value: string): void;
  /** Reorder a card one step within its current column (-1 up, +1 down); a no-op at the edges. */
  moveWithinColumn(path: string, dir: -1 | 1): void;
  /** Whether the card can move up/down within its column (false at the respective edge). */
  columnEdges(path: string): { canMoveUp: boolean; canMoveDown: boolean };
  /** Check or uncheck the index-th checklist item of a card. */
  toggleTodo(path: string, index: number, done: boolean): void;
  /** Delete the index-th checklist item of a card. */
  removeTodo(path: string, index: number): void;
  /** Id of the column treated as "done", or null if the board has none. */
  doneColumnId: string | null;

  /** Column management (persists to the board note frontmatter). */
  renameColumn(id: string, title: string): void;
  setColumnColor(id: string, color: string | null): void;
  setColumnLimit(id: string, limit: number | null): void;
  /**
   * Patch any subset of a column's editable fields in one write (#8). The "Edit column" modal
   * builds the full patch; renameColumn/setColumnColor/setColumnLimit remain for the inline menu.
   * Routes through the same `setColumns` byte-stable path.
   */
  updateColumn(id: string, patch: Partial<ColumnDef>): void;
  moveColumn(id: string, dir: -1 | 1): void;
  deleteColumn(id: string): void;
  addColumn(title: string): void;
}

export const BoardActionsContext = createContext<BoardActions | null>(null);

export function useBoardActions(): BoardActions {
  const a = useContext(BoardActionsContext);
  if (!a) throw new Error("BoardActionsContext is missing a provider");
  return a;
}
