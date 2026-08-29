// Board actions composed onto the CardRepository port: the pure reducers in board.ts decide WHAT
// to write, this decides which reducer a caller's intent means and hands the result to the port.
//
// It exists because the composition used to live in the React board, which put the fractional-order
// computation for a move ABOVE the contract — a second caller reaching only `CardRepository` would
// have had to reinvent it, and the two would have drifted. Everything that moves a card goes
// through here now, so the board view and the MCP server order cards by the same arithmetic.

import type { Board } from "./types";
import { moveCard, resolveDrop, syncSubtaskClaim } from "./board";
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

/**
 * Tick or untick one `## Subtasks` line, and keep the line's `[status:: …]` claim from telling a
 * different story than its checkbox. Two writes rather than one, so the toggle still appends its
 * own history line exactly as it did before the claim existed.
 */
export async function setSubtaskDone(
  repo: CardRepository,
  board: Board,
  target: { path: string; index: number; done: boolean; link?: string },
): Promise<void> {
  const { path, index, done, link } = target;
  await repo.toggleSubtask(path, index, done);
  // `link` matters: for a line naming a child note, `syncSubtaskClaim` refuses to act unless the
  // caller shows the `[[link]]` it read, so that a line that has since been edited underneath is
  // not acted on by index alone. A caller that leaves it out gets the checkbox written and the
  // child left where it was — which is the parity this whole path exists to keep.
  const sync = syncSubtaskClaim(
    board,
    path,
    link === undefined ? { index } : { index, link },
    done,
  );
  if (sync) await repo.applyMove(sync);
}

/**
 * Set (or, with an empty value, clear) a card's priority and let the board note learn from it.
 *
 * What the note learns is the one value being set, and nothing else. The remembered list is a
 * ranking — its order decides a badge's colour and how `sort: priority` breaks ties — so it may
 * only ever grow by a word the user actually chose. Values the cards merely happen to carry are
 * still offered as suggestions (`boardPriorities`), but they are ordered by a tone guess and a
 * spelling tie-break, and writing that order into the note would hand the board a scale nobody
 * authored. Clearing a priority learns nothing either: a removal is not a statement about the
 * vocabulary.
 */
export async function setCardPriority(
  repo: CardRepository,
  target: { path: string; value: string },
): Promise<void> {
  const value = target.value.trim();
  // An empty value clears the key cleanly (the `priority:` line goes away) rather than writing a
  // stray empty value and a misleading `Priority → ` history line.
  if (value === "") {
    await repo.unsetFrontmatterKey(target.path, "priority");
    return;
  }
  await repo.setFrontmatter(target.path, { priority: value });
  // `rememberPriorities` merges against the note itself, so handing it the one new value is
  // enough: whatever the note already holds keeps its place and its spelling.
  await repo.rememberPriorities([value]);
}
