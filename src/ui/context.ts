import { createContext, useContext, useMemo } from "react";
import type { RelationCount } from "../model/board";
import type { CardRepository } from "../model/repo";
import type { Card, ColumnDef, ContextConfig } from "../model/types";
import type { CommentMark, UnreadState } from "../model/unread";
import { unreadComments } from "../model/unread";
import { seenMarkerFor, type KanbanSettings, type SettingsPatch } from "../settings";
import type { MatchContext } from "./cardView";

/**
 * A column edit patch. Unlike `Partial<ColumnDef>`, each key may be explicitly `undefined` to
 * CLEAR that field (the column editor sets a cleared color/limit/filter/hover to `undefined`).
 * `applyColumnPatch` in App.tsx merges this onto the current def and drops the cleared keys.
 */
export type ColumnPatch = { [K in keyof ColumnDef]?: ColumnDef[K] | undefined };

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

/**
 * Active relationship counts per card path, provided by App. Lives in its own React context, not
 * a CardItem prop, for the same reason the contexts map does: the count on card A changes when
 * card B is edited, and A's own memoized props are untouched by that edit.
 */
export const RelationCountsContext = createContext<Record<string, RelationCount[]>>({});

export function useRelationCounts(): Record<string, RelationCount[]> {
  return useContext(RelationCountsContext);
}

export function useRepo(): CardRepository {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error("RepoContext is missing a provider");
  return repo;
}

/** Live settings plus an updater, provided by App and fed from the view/plugin. */
export interface SettingsContextValue {
  settings: KanbanSettings;
  update: (patch: SettingsPatch) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): KanbanSettings {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("SettingsContext missing");
  return c.settings;
}

export function useSettingsUpdater(): (patch: SettingsPatch) => void {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("SettingsContext missing");
  return c.update;
}

/**
 * One control decides both a card's inline-todos preview and its subcard group (§ collapse
 * subitems): whatever is nested under a card tile lives or dies together. `isCollapsed` reads the
 * effective state (the per-card override in `collapsedCards`, falling back to the board-wide
 * `subitemsDefault`); `toggle` flips one card; `setMany` is the column-level collapse-all/expand-all,
 * writing an explicit override for every path at once.
 */
export interface SubitemsCollapse {
  isCollapsed(path: string): boolean;
  toggle(path: string): void;
  setMany(paths: readonly string[], collapsed: boolean): void;
}

export function useSubitemsCollapse(): SubitemsCollapse {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("SettingsContext missing");
  const { settings, update } = c;
  return useMemo<SubitemsCollapse>(
    () => ({
      isCollapsed: (path) =>
        settings.collapsedCards[path] ?? settings.subitemsDefault === "collapsed",
      // Both write through the function form: the map is replaced whole, and built from this
      // render's snapshot it would drop an override another board view wrote a moment ago.
      toggle: (path) =>
        update((s) => {
          const cur = s.collapsedCards[path] ?? s.subitemsDefault === "collapsed";
          return { collapsedCards: { ...s.collapsedCards, [path]: !cur } };
        }),
      setMany: (paths, collapsed) =>
        update((s) => {
          const next = { ...s.collapsedCards };
          for (const p of paths) next[p] = collapsed;
          return { collapsedCards: next };
        }),
    }),
    [settings.collapsedCards, settings.subitemsDefault, update],
  );
}

/** A card's seen-marker frozen at one moment, for the card whose panel is open (see `unreadStateOf`). */
export interface PinnedSeen {
  path: string;
  seen: string | undefined;
}

/**
 * The reader's unread verdict on any card, from these settings — what the tile badge shows, except
 * for the pinned card: that one is judged by the marker it had when its panel opened, the same
 * snapshot the panel itself marks "new" against. Opening a card records its comments as seen, and
 * an `unread:` filter reading the live marker would drop the card from the board — and from an
 * inbox lane — in the middle of the visit.
 */
export function unreadStateOf(
  settings: KanbanSettings,
  pinned: PinnedSeen | null = null,
): (card: Card) => UnreadState {
  return (card) =>
    unreadComments(
      card.stats?.commentMarks ?? [],
      card.path === pinned?.path ? pinned.seen : seenMarkerFor(settings, card.path),
      settings.userName,
    );
}

/**
 * Everything `matchCard` needs beyond the card, built once by App so a column's lane rule and the
 * global search judge `is:` and `unread:` by the same counts and the same reader as the tile
 * markers.
 */
export const MatchContextContext = createContext<MatchContext | null>(null);

export function useMatchContext(): MatchContext {
  const c = useContext(MatchContextContext);
  if (!c) throw new Error("MatchContextContext is missing a provider");
  return c;
}

/**
 * Unread-comment state for one card, read live from settings. A card that was never opened has no
 * `commentsSeen` entry and is judged against the install-time baseline instead, so only what
 * arrived after tracking started counts as unread — and one visit to the card clears it.
 */
export function useUnreadComments(
  path: string,
  marks: readonly CommentMark[] | undefined,
): UnreadState {
  const settings = useSettings();
  const seen = seenMarkerFor(settings, path);
  const userName = settings.userName;
  return useMemo(() => unreadComments(marks ?? [], seen, userName), [marks, seen, userName]);
}

/** Card-level actions, provided by App so cards/columns don't prop-drill callbacks. */
export interface BoardActions {
  /** Open the card's detail panel. */
  open(path: string): void;
  /** Start the "create card" detail flow for a column (used by addCardFlow: 'detail'). */
  startCreate(columnId: string): void;
  /** Open the card's detail panel with its "Add a subcard" input focused, so the user types the title there. */
  addSubcard(path: string): void;
  /** Open the card's detail panel with its "Display title" field focused (the `title:` override). */
  editDisplayTitle(path: string): void;
  /**
   * Show a failed write the way every board mutation's failure is shown (the error toast). For the
   * writes the detail panel makes itself, which otherwise have no path to that toast.
   */
  reportError(e: unknown): void;
  /** Move a card to the board's "done" column, if one exists. */
  complete(path: string): void;
  /** Trash the card's note (after confirmation in the UI). */
  remove(path: string): void;
  /** Open the underlying note in an Obsidian tab. */
  openNote(path: string): void;
  /**
   * Set a card's priority frontmatter (empty string clears it) and let the board note learn the
   * value. Resolves once the board has reloaded, so a caller with its own view to refresh (the
   * detail panel's body) can await it instead of racing the write.
   */
  setPriority(path: string, value: string): Promise<void>;
  /**
   * Rename a card in place (#12): writes the title back to its source — the `.md` file name
   * (link-aware so inbound wikilinks follow), the heading line, or the `title` frontmatter key.
   * No-op for a blank/unchanged title.
   */
  renameCard(path: string, title: string): void;
  /** Reorder a card one step within its current column (-1 up, +1 down); a no-op at the edges. */
  moveWithinColumn(path: string, dir: -1 | 1): void;
  /** Whether the card can move up/down within its column (false at the respective edge). */
  columnEdges(path: string): { canMoveUp: boolean; canMoveDown: boolean };
  /** Check or uncheck the index-th checklist item of a card. */
  toggleTodo(path: string, index: number, done: boolean): void;
  /** Delete the index-th checklist item of a card. */
  removeTodo(path: string, index: number): void;
  /**
   * Send the index-th checklist line of `path` to a column of its own, or back to its card's column
   * with `null`. The one way a todo changes column outside a drag — a plain todo is not a tile until
   * it claims a column, so without this there would be nothing to drag in the first place.
   */
  moveTodo(path: string, index: number, columnId: string | null): void;
  /**
   * Record (or, with an empty marker, forget) how far the reader has read this card's comments.
   *
   * An action rather than a settings patch built in the panel: `commentsSeen` is one map, a patch
   * replaces it whole, and two board views open at once would each build theirs from their own
   * render's snapshot — the second save silently dropping the first card's marker. This writes
   * through the function form of the settings patch, which reads the map as it is when the write
   * happens.
   */
  markCommentsSeen(path: string, marker: string): void;
  /** Id of the column treated as "done", or null if the board has none. */
  doneColumnId: string | null;
  /** The board's columns, in board order — what a "move this to…" picker offers. */
  columns: readonly ColumnDef[];
  /**
   * The priority values this board offers: what its note remembers, in the order the note lists
   * them, followed by what its cards use — or the todo.txt `A`/`B`/`C` starting set when it knows
   * none yet. The pickers suggest these, and `sort: priority` uses the order to break ties between
   * equal severities, which is why it is the note's order and not one the plugin decides.
   */
  priorities: string[];
  /**
   * The board note's OWN `priorities` list, in its order and nothing more — empty when the note
   * holds none. This is the ranking the user wrote, which is why it, and not the wider vocabulary
   * above, decides the colour a priority badge is drawn in: a value that only appears on a card
   * sits in the vocabulary at an alphabetical position nobody chose.
   */
  priorityScale: readonly string[];

  /** Column management (persists to the board note frontmatter). */
  renameColumn(id: string, title: string): void;
  setColumnColor(id: string, color: string | null): void;
  setColumnLimit(id: string, limit: number | null): void;
  /**
   * Patch any subset of a column's editable fields in one write (#8). The "Edit column" modal
   * builds the full patch; renameColumn/setColumnColor/setColumnLimit remain for the inline menu.
   * Routes through the same `setColumns` byte-stable path.
   */
  updateColumn(id: string, patch: ColumnPatch): void;
  moveColumn(id: string, dir: -1 | 1): void;
  /** Reorder columns by dropping column `activeId` onto the slot held by `overId` (header drag). */
  reorderColumns(activeId: string, overId: string): void;
  deleteColumn(id: string): void;
  addColumn(title: string): void;
}

export const BoardActionsContext = createContext<BoardActions | null>(null);

export function useBoardActions(): BoardActions {
  const a = useContext(BoardActionsContext);
  if (!a) throw new Error("BoardActionsContext is missing a provider");
  return a;
}
