// Whether a card may be written into a column: the column exists, and a lane's rule would draw it
// there. Shared by the tools that set a card's column, so each refuses in the same words.

import { laneMismatch, laneVerdict } from "../model/lanes";
import type { MatchContext } from "../model/filter";
import type { Board, Card } from "../model/types";
import { ToolError } from "./tool";

/** The board really has that column, or an error naming the ones it does have. */
export function requireColumn(board: Board, columnId: string): void {
  if (board.config.columns.some((c) => c.id === columnId)) return;
  throw new ToolError(
    `Board "${board.config.path}" has no column "${columnId}". Its columns are: ${board.config.columns.map((c) => c.id).join(", ")}.`,
  );
}

/**
 * A column with a `filter` rule is a lane: the board fills it from that rule, not from a card's
 * status, so setting a card's status to it does not put the card in the lane. A card the rule
 * rejects would claim a column no view draws it in — the board's fallback column keeps it on
 * screen, but not where the caller asked for it, and the caller would never know.
 *
 * So the write is refused with the rule quoted, rather than performed and warned about. The one
 * thing that is not grounds to refuse is a rule this server cannot fully evaluate: `unread:` reads
 * which comments a person has seen and `assignee:me` the name only the board view is told, and
 * blocking a legitimate move over a rule you cannot read is worse than the write it prevents. Those
 * keep the warning this tool has always returned.
 */
export function refuseLaneMismatch(
  board: Board,
  target: { columnId: string; card: Card; ctx: MatchContext },
  next: string,
): void {
  const check = laneVerdict(board, target.columnId, target.card, target.ctx);
  if (check?.verdict !== "rejects") return;
  throw new ToolError(`${laneMismatch(check.lane, target.card)} ${next}`);
}

/** What remains to be said about a lane whose rule this server cannot fully evaluate. */
export function laneWarning(
  board: Board,
  columnId: string,
  card: Card,
  ctx: MatchContext,
): string | undefined {
  const check = laneVerdict(board, columnId, card, ctx);
  if (check?.verdict !== "unknown") return undefined;
  return `Column "${columnId}" is filled by the rule \`${check.lane.rule}\`, not by a card's status, and part of that rule reads state this server cannot see — which comments a person has read, or who "me" is. The board draws this card there only if it really matches; check it with get_board.`;
}
