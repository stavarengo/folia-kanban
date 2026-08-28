// The write half of the tool surface. Every one of these goes through the same repository port and
// the same reducers the board view uses, so a card an agent touches gets the history lines, the
// checkbox syncing and the fractional ordering it would have got from a person dragging it.

import { z } from "zod";
import { columnOf } from "../model/board";
import { moveCardTo, setCardPriority, setSubtaskDone } from "../model/boardOps";
import type { CardRepository } from "../model/repo";
import {
  boardArg,
  cardArg,
  columnArg,
  openBoard,
  resolveCardPath,
  resolveNotePath,
  tool,
  ToolError,
  type ToolDefinition,
} from "./tool";

/** Frontmatter this board owns through a dedicated tool or field; writing it by hand skips that. */
const RESERVED_KEYS: Record<string, string> = {
  status: "a card's column is set by move_card, which also records the move in its history",
  order: "a card's position in its column is set by move_card",
  priority: "use update_card's own `priority` field, so the board remembers the value",
  due: "use update_card's own `due` field",
};

const propertyValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Refuse the keys a dedicated tool or field owns, naming the one that should have been used. */
function refuseReservedKeys(properties: Record<string, unknown> | undefined): void {
  for (const key of Object.keys(properties ?? {})) {
    const reserved = RESERVED_KEYS[key];
    if (reserved) throw new ToolError(`"${key}" cannot be set through properties: ${reserved}.`);
  }
}

/** Set or clear one frontmatter key; `null` clears it. */
async function writeField(
  repo: CardRepository,
  path: string,
  key: string,
  value: string | number | boolean | null,
): Promise<void> {
  if (value === null || value === "") await repo.unsetFrontmatterKey(path, key);
  else await repo.setFrontmatter(path, { [key]: value });
}

const createCard = tool({
  name: "create_card",
  title: "Create a card",
  description:
    "Add a card to a column. It is written into the board's card folder as a new note, exactly as the board's own add-card button writes it.",
  input: z.object({
    board: boardArg,
    title: z.string().min(1).describe("The card's title; it also names the file."),
    column: columnArg,
    description: z.string().optional().describe("Body text above the card's own sections."),
    priority: z.string().optional().describe("A value from the board's priority vocabulary."),
    due: z.string().optional().describe("Due date, `YYYY-MM-DD`."),
  }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    if (!board.config.columns.some((c) => c.id === args.column)) {
      throw new ToolError(
        `Board "${board.config.path}" has no column "${args.column}". Its columns are: ${board.config.columns.map((c) => c.id).join(", ")}.`,
      );
    }
    const path = await repo.createCard(args.title, args.column);
    if (args.description !== undefined) await repo.setDescription(path, args.description);
    if (args.priority !== undefined) {
      await setCardPriority(repo, { path, value: args.priority }, board.config.priorities);
    }
    if (args.due !== undefined) await writeField(repo, path, "due", args.due);
    return { path, column: args.column };
  },
});

const moveCard = tool({
  name: "move_card",
  title: "Move a card",
  description:
    "Move a card to a column, optionally to a given slot in it (0 is the top; leave it out to append). Records the move in the card's history and keeps a parent's checklist box in step, the same way a drag does.",
  input: z.object({
    board: boardArg,
    card: cardArg,
    column: columnArg,
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Slot in the target column, counted with this card taken out. Omit to append."),
  }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    if (!board.config.columns.some((c) => c.id === args.column)) {
      throw new ToolError(
        `Board "${board.config.path}" has no column "${args.column}". Its columns are: ${board.config.columns.map((c) => c.id).join(", ")}.`,
      );
    }
    // A checklist line standing in a column of its own moves too — on its own line — so this is
    // the one write that accepts a card without a note behind it.
    const path = resolveCardPath(board, args.card);
    const moved = await moveCardTo(repo, board, {
      path,
      columnId: args.column,
      ...(args.position === undefined ? {} : { index: args.position }),
    });
    if (!moved) throw new ToolError(`Nothing to move: "${path}" is not a card on this board.`);
    const after = await repo.loadBoard();
    return {
      path,
      column: columnOf(after, path),
      position: (after.columns[args.column] ?? []).indexOf(path),
    };
  },
});

const updateCard = tool({
  name: "update_card",
  title: "Update a card",
  description:
    "Change a card's title, description, priority, due date or any other frontmatter property. Set a value to null to clear it. Use move_card for the column.",
  input: z
    .object({
      board: boardArg,
      card: cardArg,
      title: z
        .string()
        .optional()
        .describe("Retitles the card at whichever source its title comes from."),
      description: z.string().optional(),
      priority: z.string().nullable().optional(),
      due: z.string().nullable().optional(),
      properties: z
        .record(z.string(), propertyValue)
        .optional()
        .describe("Any other frontmatter keys to set, or null to remove."),
    })
    .refine(
      (v) =>
        v.title !== undefined ||
        v.description !== undefined ||
        v.priority !== undefined ||
        v.due !== undefined ||
        v.properties !== undefined,
      { message: "Give at least one field to change." },
    ),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveNotePath(board, args.card);
    refuseReservedKeys(args.properties);
    if (args.description !== undefined) await repo.setDescription(path, args.description);
    if (args.priority !== undefined) {
      await setCardPriority(repo, { path, value: args.priority ?? "" }, board.config.priorities);
    }
    if (args.due !== undefined) await writeField(repo, path, "due", args.due);
    for (const [key, value] of Object.entries(args.properties ?? {})) {
      await writeField(repo, path, key, value);
    }
    // Last, so a failed field write leaves the card where the caller last saw it, under the name
    // they addressed it by, rather than renamed with half the change applied.
    const finalPath = args.title === undefined ? path : await repo.renameCard(path, args.title);
    return { path: finalPath };
  },
});

const addComment = tool({
  name: "add_comment",
  title: "Comment on a card",
  description:
    "Append a comment to a card's `## Comments` section, timestamped and signed with the name configured in the plugin's settings.",
  input: z.object({ board: boardArg, card: cardArg, text: z.string().min(1) }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveNotePath(board, args.card);
    await repo.addComment(path, args.text);
    return { path, comments: (await repo.readBody(path)).comments.length };
  },
});

const addSubtask = tool({
  name: "add_subtask",
  title: "Add a subtask",
  description: "Append an unchecked line to a card's `## Subtasks` checklist.",
  input: z.object({ board: boardArg, card: cardArg, text: z.string().min(1) }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveNotePath(board, args.card);
    await repo.addTodo(path, args.text);
    const subtasks = (await repo.readBody(path)).subtasks;
    return { path, index: subtasks.at(-1)?.index, subtasks: subtasks.length };
  },
});

const setSubtask = tool({
  name: "set_subtask_done",
  title: "Tick or untick a subtask",
  description:
    "Check or uncheck one `## Subtasks` line by its index, as get_card reports it. A line that claims a column of its own is kept in step with its checkbox.",
  input: z.object({
    board: boardArg,
    card: cardArg,
    index: z.number().int().min(0).describe("The subtask's `index`, as get_card reports it."),
    done: z.boolean(),
  }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveNotePath(board, args.card);
    const subtasks = (await repo.readBody(path)).subtasks;
    if (!subtasks.some((s) => s.index === args.index)) {
      throw new ToolError(
        `"${path}" has no subtask ${args.index}. It has ${subtasks.length}, indexed ${subtasks.map((s) => s.index).join(", ") || "not at all"}.`,
      );
    }
    await setSubtaskDone(repo, board, { path, index: args.index, done: args.done });
    return { path, index: args.index, done: args.done };
  },
});

export const CARD_TOOLS: ToolDefinition[] = [
  createCard,
  moveCard,
  updateCard,
  addComment,
  addSubtask,
  setSubtask,
];
