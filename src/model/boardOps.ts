// Board actions composed onto the CardRepository port: the pure reducers in board.ts decide WHAT
// to write, this decides which reducer a caller's intent means and hands the result to the port.
//
// It exists because the composition used to live in the React board, which put the fractional-order
// computation for a move ABOVE the contract — a second caller reaching only `CardRepository` would
// have had to reinvent it, and the two would have drifted. Everything that moves a card goes
// through here now, so the board view and the MCP server order cards by the same arithmetic.

import type { MatchContext } from "./filter";
import { laneRefusal } from "./lanes";
import type { Board, SubItem } from "./types";
import { moveCard, resolveDrop, syncSubtaskClaim } from "./board";
import type { CardRepository } from "./repo";
import { StaleLineError } from "./repo";

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
  target: { path: string; line: SubItem; done: boolean; ctx?: MatchContext },
): Promise<string | null> {
  const { path, line, done } = target;
  // The follow-up is decided from the same reading of the line the tick was, so the two halves can
  // never name two different lines, and a board one reload behind cannot decide either of them. For
  // a line naming a child note, `syncSubtaskClaim` still refuses unless the board agrees the line
  // carries that `[[link]]` — that half writes into ANOTHER note, and a position edited underneath
  // must not be enough to move somebody else's card. They are two writes, though: a note edited in
  // the moment between them can have the second refused on its own, and that says so rather than
  // leaving the caller to find a ticked box with a claim that never moved.
  await repo.toggleSubtask(path, line, done);
  const sync = syncSubtaskClaim(board, path, line, done);
  if (!sync) return null;
  // The second half files the child into a column, and a lane owns no card: one whose rule the
  // child fails must not be written, or ticking a box would strand somebody else's note. The tick
  // itself stands — it is what the click meant — and the reason comes back for the caller to say.
  const claimed = sync.setFrontmatter?.["status"];
  const child = board.cards[sync.path];
  if (target.ctx && child && typeof claimed === "string" && claimed !== "") {
    const why = laneRefusal(board, claimed, child, target.ctx);
    if (why !== null) return why;
  }
  try {
    await repo.applyMove(sync);
  } catch (e) {
    if (!(e instanceof StaleLineError)) throw e;
    throw new StaleLineError(
      `${e.message} The checkbox was written; keeping the line's own column claim in step with it was not, so the line says two things until the next edit.`,
    );
  }
  return null;
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
