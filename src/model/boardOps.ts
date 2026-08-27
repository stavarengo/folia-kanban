// Board actions composed onto the CardRepository port: the pure reducers in board.ts decide WHAT
// to write, this decides which reducer a caller's intent means and hands the result to the port.
//
// It exists because the composition used to live in the React board, which put the fractional-order
// computation for a move ABOVE the contract — a second caller reaching only `CardRepository` would
// have had to reinvent it, and the two would have drifted. Everything that moves a card goes
// through here now, so the board view and the MCP server order cards by the same arithmetic.

import type { Board } from "./types";
import { moveCard, resolveDrop } from "./board";
import type { CardRepository } from "./repo";

/** Where a move lands: a column, and a slot in it. An absent `index` means the end of the column. */
export interface MoveTarget {
  path: string;
  columnId: string;
  index?: number;
}

/** A dnd-kit drop: the dragged card, and the id it was released over (a column id or a card path). */
export interface DropTarget {
  activeId: string;
  overId: string;
}

/**
 * Move or reorder a card. `index` counts slots in the target column with the moved card taken out,
 * so 0 is the top and an absent value appends. Returns false when the board knows no such card,
 * which is the caller's cue that nothing was written.
 */
export async function moveCardTo(
  repo: CardRepository,
  board: Board,
  target: MoveTarget,
): Promise<boolean> {
  const { path, columnId } = target;
  const index = target.index ?? (board.columns[columnId] ?? []).filter((p) => p !== path).length;
  const mutation = moveCard(board, path, columnId, index);
  if (!mutation) return false;
  await repo.applyMove(mutation);
  return true;
}

/** Apply a drag-and-drop release. Returns false when the drop resolves to nothing to write. */
export async function moveCardOver(
  repo: CardRepository,
  board: Board,
  drop: DropTarget,
): Promise<boolean> {
  const resolved = resolveDrop(board, drop.activeId, drop.overId);
  if (!resolved) return false;
  return moveCardTo(repo, board, {
    path: drop.activeId,
    columnId: resolved.columnId,
    index: resolved.index,
  });
}
