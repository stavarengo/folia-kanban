// A card can be placed in more than one column at once: its status column AND any cross-board lane
// (#1) whose filter it matches. dnd-kit keys draggables/droppables by id, so two placements sharing a
// bare `card.path` would collide (last-writer-wins, non-deterministic). We therefore give each
// PLACEMENT a unique sortable id, namespaced by the column it renders in: `${columnId}::${card.path}`.
// The separator is the first `::` only — a card path may itself contain `::`, a column id cannot
// (column ids come from frontmatter keys / titleCase and never include it).

import type { Board, ColumnDef } from "./types";
import { columnOf } from "./boardColumns";

const CARD_DRAG_SEP = "::";

/** Build the per-placement sortable id for a card rendered in `columnId`. */
export function makeCardDragId(columnId: string, path: string): string {
  return columnId + CARD_DRAG_SEP + path;
}

/**
 * Parse a per-placement card sortable id back into its column + real card path. Splits on the FIRST
 * `::` so a path containing `::` survives intact. An un-namespaced id (no separator — e.g. a legacy
 * or column id passed by mistake) yields an empty `columnId` and the whole string as `path`.
 */
export function splitCardDragId(id: string): { columnId: string; path: string } {
  const i = id.indexOf(CARD_DRAG_SEP);
  if (i < 0) return { columnId: "", path: id };
  return { columnId: id.slice(0, i), path: id.slice(i + CARD_DRAG_SEP.length) };
}

/**
 * A live cross-column relocation in progress: the active card (`activeId` is its ORIGINAL namespaced
 * sortable id, kept stable through the drop so dnd-kit never loses the rect) is being shown moved
 * from `fromColumn` into `toColumn`, inserted before `beforePath` (or appended when null).
 */
export interface DragReloc {
  activeId: string;
  fromColumn: string;
  toColumn: string;
  beforePath: string | null;
}

/**
 * Apply a live cross-column relocation to a columns map, yielding the EFFECTIVE per-column card
 * paths to render while the drag is open. Pure + idempotent: the active path is removed from EVERY
 * column first (so a stale reloc applied to a board where the card already landed can't duplicate
 * it), then inserted into `toColumn` before `beforePath` — or appended when `beforePath` is null or
 * not found. The input map is left untouched. Only the two affected columns get new arrays; the rest
 * are returned by reference. Returns the input itself when there's no reloc.
 */
export function applyReloc(
  columns: Record<string, string[]>,
  reloc: DragReloc | null,
): Record<string, string[]> {
  if (!reloc) return columns;
  // `fromColumn` needs no special handling: removing the active path from EVERY column below already
  // empties the source (and makes the reducer idempotent against a board where the card has landed).
  const { toColumn, beforePath } = reloc;
  const { path } = splitCardDragId(reloc.activeId);
  const out: Record<string, string[]> = {};
  for (const [colId, paths] of Object.entries(columns)) {
    out[colId] = paths.includes(path) ? paths.filter((p) => p !== path) : paths;
  }
  const target = (out[toColumn] ?? []).slice();
  const at = beforePath != null ? target.indexOf(beforePath) : -1;
  if (at >= 0) target.splice(at, 0, path);
  else target.push(path);
  out[toColumn] = target;
  return out;
}

/**
 * Decide the live cross-column relocation a drag's current `over` target implies — the make-room
 * counterpart to {@link planDrop}, kept pure so the gap rules are unit-testable. Returns `null` when
 * no gap should open: a column drag (bare column active id), no target, or a SAME-column hover (the
 * native sortable owns that reorder — its tween is already correct, so we never override it).
 *
 * `rawOverId` may be a column id (dropped on / hovering the column body → `beforePath: null`, append)
 * or a namespaced card id (`col::path` → insert before that path). Callers must short-circuit a hover
 * over the dragged card's OWN placeholder (`rawOverId === rawActiveId`) BEFORE calling this — once the
 * card is relocated it carries its source-column id, so its own `over` would parse back to `fromColumn`
 * and falsely read as same-column, collapsing the gap.
 */
export function resolveDragReloc(
  rawActiveId: string,
  rawOverId: string | null,
  columnIds: string[],
): DragReloc | null {
  if (columnIds.includes(rawActiveId)) return null; // a column reorder, not a card move
  if (rawOverId == null) return null;
  const fromColumn = splitCardDragId(rawActiveId).columnId;
  let toColumn: string;
  let beforePath: string | null;
  if (columnIds.includes(rawOverId)) {
    toColumn = rawOverId; // over the column body → append
    beforePath = null;
  } else {
    const split = splitCardDragId(rawOverId);
    if (!split.columnId) return null; // un-namespaced / unrecognised over id
    toColumn = split.columnId;
    beforePath = split.path; // over a card → insert before it
  }
  if (toColumn === fromColumn) return null; // same-column: native sortable owns it
  return { activeId: rawActiveId, fromColumn, toColumn, beforePath };
}

/**
 * Reorder columns by moving the column `activeId` to the slot currently held by `overId`.
 * Pure: returns a new array, leaving the input untouched. A drop onto itself, an unknown id,
 * or a no-op move returns the original order (referentially the same array when nothing moves).
 * Drives the header drag-reorder (#2); the menu's step-wise move stays a separate path.
 */
export function moveColumn(columns: ColumnDef[], activeId: string, overId: string): ColumnDef[] {
  if (activeId === overId) return columns;
  const from = columns.findIndex((c) => c.id === activeId);
  const to = columns.findIndex((c) => c.id === overId);
  if (from < 0 || to < 0 || from === to) return columns;
  const next = columns.slice();
  const spliced = next.splice(from, 1);
  const moved = spliced[0];
  if (moved === undefined) return columns;
  next.splice(to, 0, moved);
  return next;
}

/** A column renders its cards in a COMPUTED order when it groups or sorts non-manually (#6). Manual
 *  in-column drag-reorder is a no-op there (the order is recomputed every render). */
export function isComputedOrder(board: Board, columnId: string): boolean {
  const col = board.config.columns.find((c) => c.id === columnId);
  if (!col) return false;
  return (col.group ?? "none") !== "none" || (col.sort ?? "manual") !== "manual";
}

/** What a dnd-kit drop should do, after parsing namespaced card ids and applying the drag rules. */
export type DropPlan =
  | { kind: "reorderColumns"; activeId: string; overId: string }
  | { kind: "moveCard"; path: string; overId: string }
  | { kind: "noop" };

/**
 * Decide what a finished drag should do. Pure + UI-free so the rules are unit-testable.
 *
 * Card sortables are namespaced `${columnId}::${card.path}` (#2) so a card placed in both its status
 * column and a cross-board lane (#1) never collides on a single dnd-kit id. This unwraps the active +
 * over ids back to bare ids and routes:
 *  - a bare COLUMN active id → column reorder (#2 header drag);
 *  - a same-column card drop onto a COMPUTED-order column → no-op (#3: manual reorder is meaningless
 *    when the order is grouped/sorted; cross-column moves still flow through);
 *  - otherwise → a card move, with the real path + the real (un-namespaced) over id for resolveDrop.
 */
export function planDrop(
  board: Board,
  rawActiveId: string,
  rawOverId: string,
  columnIds: string[],
): DropPlan {
  if (columnIds.includes(rawActiveId)) {
    return { kind: "reorderColumns", activeId: rawActiveId, overId: rawOverId };
  }
  const { columnId: fromColumn, path: activePath } = splitCardDragId(rawActiveId);
  const over = columnIds.includes(rawOverId)
    ? { columnId: rawOverId, path: rawOverId }
    : splitCardDragId(rawOverId);
  if (over.columnId === fromColumn && isComputedOrder(board, over.columnId)) {
    return { kind: "noop" };
  }
  return { kind: "moveCard", path: activePath, overId: over.path };
}

/**
 * Translate a dnd-kit drop (active card id, the id it was dropped over) into a target
 * column + insertion index among that column's cards with the active card removed.
 * `overId` may be a column id (dropped on the column body) or a card path (dropped on a card,
 * inserting before it). Dropped over itself, as the keyboard's pick-up and put-down in place reports
 * it, the card resolves to the slot it holds. Pure and testable.
 */
export function resolveDrop(
  board: Board,
  activeId: string,
  overId: string,
): { columnId: string; index: number } | null {
  if (board.columns[overId]) {
    const list = board.columns[overId].filter((p) => p !== activeId);
    return { columnId: overId, index: list.length };
  }
  const columnId = columnOf(board, overId);
  if (!columnId) return null;
  const column = board.columns[columnId] ?? [];
  if (overId === activeId) return { columnId, index: column.indexOf(activeId) };
  const list = column.filter((p) => p !== activeId);
  const idx = list.indexOf(overId);
  return { columnId, index: idx === -1 ? list.length : idx };
}
