// move_card: the one write that takes a card with no note behind it, since a checklist line standing
// in a column of its own moves too — on its own line, held to the reading the caller took of it.

import { z } from "zod";
import {
  boardMatchContext,
  columnOf,
  makeTodoPath,
  moveSubtask,
  parseTodoPath,
  sameLine,
  subtaskRef,
  todoTile,
} from "../model/board";
import { moveCardTo } from "../model/boardOps";
import type { CardRepository } from "../model/repo";
import { StaleLineError } from "../model/repo";
import type { Board, TodoLine } from "../model/types";
import { laneWarning, refuseLaneMismatch, requireColumn } from "./columnChecks";
import {
  boardArg,
  cardArg,
  columnArg,
  landedColumn,
  openBoard,
  resolveCardPath,
  tool,
  ToolError,
} from "./tool";

/**
 * A checklist line as get_board and get_card report it in `line`, handed back. Only what the move
 * is held to is read; anything else the agent copied along is dropped.
 */
const lineArg = z
  .object({
    index: z.number().int().min(0),
    text: z.string(),
    occurrence: z.number().int().min(0),
    done: z.boolean(),
    status: z.string().optional(),
  })
  .describe(
    "Required when `card` is a checklist line: its `line`, exactly as get_board or get_card reported it. A checklist line is named by its position in its note, and a position names whatever line sits there by the time the move lands — so the move is held to this reading, and refused when the note no longer reads that way.",
  );

const input = z.object({
  board: boardArg,
  card: cardArg,
  column: columnArg,
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Slot in the target column, counted with this card taken out. Omit to append."),
  line: lineArg.optional(),
});

type MoveArgs = z.infer<typeof input>;

/**
 * The checklist line `ref` names, as its note and position — or `null` for a card with a note of
 * its own. A `#todo:N` path is taken at its word even when the fresh board draws no tile there any
 * more: the move is decided from the caller's `line`, and the note is what says whether it stands.
 */
function checklistLine(board: Board, ref: string): { parentPath: string; index: number } | null {
  const parsed = parseTodoPath(ref);
  if (parsed && board.cards[parsed.parentPath]) return parsed;
  const todoRef = board.cards[resolveCardPath(board, ref)]?.todoRef;
  return todoRef ? { parentPath: todoRef.parentPath, index: todoRef.line.index } : null;
}

/**
 * The caller's reading of the checklist line at `index`, or a refusal saying what is missing. A line
 * takes no slot: its position comes from where it sits in its parent's checklist, which is not this
 * tool's to rewrite, and saying so beats silently ignoring the argument.
 */
function readingOf(
  board: Board,
  args: MoveArgs,
  at: { parentPath: string; index: number },
): TodoLine {
  if (args.position !== undefined) {
    throw new ToolError(
      `"${args.card}" is a checklist line; it is ordered by its place in its parent's list, so move_card cannot give it a position. Drop the argument to move it to "${args.column}".`,
    );
  }
  if (!args.line) {
    throw new ToolError(
      `"${args.card}" is a checklist line in "${at.parentPath}". Pass its \`line\` exactly as get_board or get_card reported it: a position alone names whatever line sits there by the time the move lands.`,
    );
  }
  const { status, ...read } = args.line;
  if (read.index !== at.index) {
    throw new ToolError(
      `\`line\` is line ${read.index} of "${at.parentPath}", but "${args.card}" names line ${at.index}. Pass the \`line\` reported for this card.`,
    );
  }
  // Whether a line links a child note is decided by its words alone, so a line reading these words
  // at this position is a link now and will be one when the write lands. Its column is the child's.
  const drawn = subtaskRef(board, at.parentPath, at.index);
  if (drawn?.kind === "card" && drawn.text === read.text) {
    throw new ToolError(
      `Line ${at.index} of "${at.parentPath}" links a card of its own, ${read.text}, so it is not moved as a line. Move that card with move_card instead.`,
    );
  }
  return status === undefined ? { ...read, kind: "todo" } : { ...read, status, kind: "todo" };
}

/** Where the card stands once the move is written, as the board now draws it. */
async function landing(
  repo: CardRepository,
  path: string,
  column: string,
  warning: string | undefined,
): Promise<Record<string, unknown>> {
  const after = await repo.loadBoard();
  const slot = (after.columns[column] ?? []).indexOf(path);
  return {
    path,
    column: landedColumn(after, path),
    ...(warning === undefined ? {} : { warning }),
    // Only a card with a tile of its own has a slot to report. One drawn inside its parent is
    // ordered by that parent, so a number here would be an invitation to move_card a position
    // this tool would refuse.
    ...(slot < 0 ? {} : { position: slot }),
  };
}

async function moveChecklistLine(
  repo: CardRepository,
  board: Board,
  at: { parentPath: string; index: number },
  args: MoveArgs,
): Promise<Record<string, unknown>> {
  const { parentPath, index } = at;
  const line = readingOf(board, args, at);
  const ctx = boardMatchContext(board);
  const tile = todoTile(board, parentPath, line, args.column);
  if (tile) {
    refuseLaneMismatch(
      board,
      { columnId: args.column, card: tile, ctx },
      "Nothing was moved. Move it to a column with no rule of its own.",
    );
  }
  const mutation = moveSubtask(board, parentPath, line, args.column);
  if (mutation) {
    try {
      await repo.applyMove(mutation);
    } catch (e) {
      throw e instanceof StaleLineError ? new ToolError(e.message) : e;
    }
  } else {
    // Nothing to write by the caller's reading, so no write is there to refuse a stale one. The
    // board this call just loaded answers instead: a line that no longer reads that way is not one
    // an agent may be told it moved.
    const now = subtaskRef(board, parentPath, index);
    if (!now || !sameLine(now, line)) {
      throw new ToolError(
        `Line ${index} of "${parentPath}" no longer reads the way \`line\` says, so nothing was moved. Read the card again and move the line it has now.`,
      );
    }
  }
  const warning = tile ? laneWarning(board, args.column, tile, ctx) : undefined;
  return landing(repo, makeTodoPath(parentPath, index), args.column, warning);
}

async function moveNote(
  repo: CardRepository,
  board: Board,
  args: MoveArgs,
): Promise<Record<string, unknown>> {
  const path = resolveCardPath(board, args.card);
  if (args.line) {
    throw new ToolError(
      `"${path}" is a note, not a checklist line, so there is no \`line\` to hold its move to. Drop the argument.`,
    );
  }
  const card = board.cards[path];
  if (!card) throw new ToolError(`Nothing to move: "${path}" is not a card on this board.`);
  const ctx = boardMatchContext(board);
  refuseLaneMismatch(
    board,
    { columnId: args.column, card, ctx },
    "Nothing was moved. Give the card what the rule asks for with update_card first, or move it to a column with no rule of its own.",
  );
  const moved = await moveCardTo(repo, board, {
    card,
    columnId: args.column,
    ...(args.position === undefined ? {} : { index: args.position }),
  });
  if (!moved && columnOf(board, path) !== args.column) {
    throw new ToolError(`Nothing to move: "${path}" is not a card on this board.`);
  }
  return landing(repo, path, args.column, laneWarning(board, args.column, card, ctx));
}

export const moveCard = tool({
  name: "move_card",
  title: "Move a card",
  description:
    "Move a card to a column, optionally to a given slot in it (0 is the top; leave it out to append). Records the move in the card's history and keeps a parent's checklist box in step, the same way a drag does. A checklist line standing in a column of its own also needs its `line`, as get_board or get_card reported it.",
  input,
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    requireColumn(board, args.column);
    const todo = checklistLine(board, args.card);
    return todo ? moveChecklistLine(repo, board, todo, args) : moveNote(repo, board, args);
  },
});
