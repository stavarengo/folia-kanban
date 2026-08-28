// The read half of the tool surface: which boards exist, what one board holds, and one card in
// full. Everything is read through the same repository port the board view reads through, so an
// agent sees the board exactly as the columns render it — nested subcards, placed checklist lines
// and all.

import { z } from "zod";
import type { Board, Card } from "../model/types";
import { columnOf } from "../model/board";
import { boardArg, cardArg, openBoard, resolveCardPath, tool, type ToolDefinition } from "./tool";

/** What a card looks like in a column listing: enough to decide, not the whole note. */
function cardSummary(board: Board, path: string): Record<string, unknown> {
  const card: Card | undefined = board.cards[path];
  if (!card) return { path, title: path };
  const stats = card.stats;
  return {
    path,
    title: card.title,
    kind: card.todoRef ? "todo" : "note",
    order: card.frontmatter.order,
    priority: card.frontmatter.priority,
    due: card.frontmatter.due,
    context: card.context,
    parent: board.placedOf[path],
    subtasks: stats?.checklist ? { total: stats.checklist, done: stats.checklistDone } : undefined,
    comments: stats?.comments || undefined,
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
    "A board's columns and the cards in each, in the order the board shows them. Cards nested under another card are reported on their parent, not in the columns.",
  input: z.object({ board: boardArg }),
  readOnly: true,
  run: async (host, args) => {
    const { board } = await openBoard(host, args.board);
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
        cards: (board.columns[col.id] ?? []).map((p) => cardSummary(board, p)),
      })),
    };
  },
});

/** A checklist line standing in a column of its own has no note; say where its text actually is. */
function todoCard(board: Board, path: string, card: Card): Record<string, unknown> {
  const ref = card.todoRef;
  return {
    kind: "todo",
    path,
    title: card.title,
    column: columnOf(board, path),
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
    if (card?.todoRef) return todoCard(board, path, card);
    const body = await repo.readBody(path);
    return {
      kind: "note",
      path,
      title: card?.title,
      titleSource: card?.titleSource,
      column: columnOf(board, path),
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
