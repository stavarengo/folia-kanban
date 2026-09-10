// The read half of the tool surface: which boards exist, what one board holds, and one card in
// full. Everything is read through the same repository port the board view reads through, so an
// agent sees the board exactly as the columns render it — nested subcards, placed checklist lines
// and all.

import { z } from "zod";
import { boardMatchContext, columnOf } from "../model/board";
import { drawnInColumn, drawnPaths } from "../model/lanes";
import type { MatchContext } from "../model/filter";
import type { Board, Card } from "../model/types";
import {
  boardArg,
  cardArg,
  landedOn,
  openBoard,
  resolveCardPath,
  tool,
  type ToolDefinition,
} from "./tool";

/**
 * What a card looks like in a column listing: enough to decide, not the whole note.
 *
 * A card nested under another one is in no column of its own — the board draws it inside its
 * parent — so it is listed under `children` here. Without that, an agent surveying a board that
 * uses subcards would be shown a board with cards missing and no way to learn their paths.
 */
function cardSummary(board: Board, path: string): Record<string, unknown> {
  const card: Card | undefined = board.cards[path];
  if (!card) return { path, title: path };
  const stats = card.stats;
  const children = board.childrenOf[path];
  return {
    path,
    title: card.title,
    kind: card.todoRef ? "todo" : "note",
    order: card.frontmatter.order,
    priority: card.frontmatter.priority,
    due: card.frontmatter.due,
    // Raw, exactly as its neighbours are: a card may name one person or several, and an agent
    // deciding what to do about that should see which. Reported here and not only by get_card
    // because "who is working on this" is a question about a board, and answering it otherwise
    // costs one call per card. `update_card`'s `properties` can write this shape straight back.
    assignee: card.frontmatter["assignee"],
    context: card.context,
    parent: board.placedOf[path],
    subtasks: stats?.checklist ? { total: stats.checklist, done: stats.checklistDone } : undefined,
    comments: stats?.comments || undefined,
    children: children?.length ? children.map((child) => cardSummary(board, child)) : undefined,
  };
}

const listBoards = tool({
  name: "list_boards",
  title: "List boards",
  description:
    "Every Folia Kanban board in the vault: a note carrying `folia-board: true`. Start here — every other tool addresses a board by the path this returns.",
  input: z.object({}),
  readOnly: true,
  run: (host) => Promise.resolve({ boards: host.listBoards() }),
});

const getBoard = tool({
  name: "get_board",
  title: "Read a board",
  description:
    "A board's columns and the cards in each, in the order the board shows them. Cards nested under another card are reported on their parent, not in the columns. A column carrying a `filter` rule is an auto-populated lane, filled by that rule rather than by a card's status; its rule is resolved here, and it is marked with a `lane` note saying what that means and where the answer can still be incomplete.",
  input: z.object({ board: boardArg }),
  readOnly: true,
  run: async (host, args) => {
    const { board } = await openBoard(host, args.board);
    const ctx = boardMatchContext(board);
    return {
      board: {
        path: board.config.path,
        cardFolder: board.config.cardFolder,
        priorities: board.config.priorities,
        relations: board.config.relations.map((r) => r.key),
        warning: board.cardFolderWarning,
      },
      columns: board.config.columns.map((col) => ({
        id: col.id,
        title: col.title,
        limit: col.limit,
        filter: col.filter,
        cards: drawnPaths(board, col.id, ctx).map((p) => cardSummary(board, p)),
        ...(col.filter ? { lane: LANE_NOTE } : {}),
      })),
    };
  },
});

/**
 * What a column with a `filter` rule is, said to the caller rather than left to be inferred.
 *
 * Such a column is a lane: `cards` above is the rule resolved against every card standing in a
 * column, which is what the board draws, and not the column's own status bucket — the two are
 * different sets, and a card may be drawn in several lanes at once. Saying so is what keeps a
 * caller from reading the listing as ownership and concluding that moving a card out of a lane is
 * the way to change what it is.
 *
 * The one thing this listing can still get wrong is a rule naming `unread:` or `assignee:me`,
 * which read state that lives with the person at the board and not on the card. `boardMatchContext`
 * leaves both out, so such a term matches nothing here.
 */
const LANE_NOTE =
  "This column has a filter rule, so the board fills it with every card matching that rule wherever it lives, and a card listed here may also appear in its own status column. `cards` above is that rule resolved, not this column's status bucket — moving a card out of a lane is not how you change what it is. One gap: a rule naming `unread:` or `assignee:me` reads state that lives with the person at the board and not on the card, so this server cannot resolve it; for such a lane the listing falls back to the cards whose status names it.";

/**
 * The column the board draws a card in. `landedColumn` finds the bucket its tile stands in, which
 * for a lane's bucket is not where the board puts it — so the rule is resolved on top, and this
 * tool agrees with `get_board`'s listing rather than reporting the card's raw `status`.
 */
function shownColumn(board: Board, path: string, ctx: MatchContext): string | null {
  // `landedOn` is the card with the tile — this one, or the ancestor it is drawn inside. The rule
  // is asked about that card, because that is the one standing in a bucket for a lane to pull.
  const standing = landedOn(board, path);
  if (standing === null) return null;
  const at = columnOf(board, standing);
  return at === null ? null : drawnInColumn(board, at, standing, ctx);
}

/** A checklist line standing in a column of its own has no note; say where its text actually is. */
function todoCard(
  board: Board,
  path: string,
  card: Card,
  ctx: MatchContext,
): Record<string, unknown> {
  const ref = card.todoRef;
  return {
    kind: "todo",
    path,
    title: card.title,
    column: shownColumn(board, path, ctx),
    note: ref?.parentPath,
    subtaskIndex: ref?.index,
    claimedColumn: ref?.claim,
    hint: "This card is a checklist line. Read or edit it through the note named in `note`.",
  };
}

const getCard = tool({
  name: "get_card",
  title: "Read a card",
  description:
    "One card in full: its column, frontmatter, description, subtasks, comments, history and relationships.",
  input: z.object({ board: boardArg, card: cardArg }),
  readOnly: true,
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveCardPath(board, args.card);
    const card = board.cards[path];
    const ctx = boardMatchContext(board);
    if (card?.todoRef) return todoCard(board, path, card, ctx);
    const body = await repo.readBody(path);
    return {
      kind: "note",
      path,
      title: card?.title,
      titleSource: card?.titleSource,
      column: shownColumn(board, path, ctx),
      frontmatter: card?.frontmatter,
      context: card?.context,
      parent: board.parentOf[path],
      children: board.childrenOf[path],
      description: body.description,
      subtasks: body.subtasks,
      comments: body.comments,
      history: body.history,
      relations: card?.relations,
    };
  },
});

export const BOARD_TOOLS: ToolDefinition[] = [listBoards, getBoard, getCard];
