// The write half of the tool surface. Every one of these goes through the same repository port and
// the same reducers the board view uses, so a card an agent touches gets the history lines, the
// checkbox syncing and the fractional ordering it would have got from a person dragging it.

import { z } from "zod";
import { columnOf, parseTodoPath } from "../model/board";
import type { Board } from "../model/types";
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

/**
 * Which column a card ended up in, as the board draws it.
 *
 * `columnOf` answers from the column lists, and only a card with a tile of its own is in one. A
 * card nested under a parent that sits in the same column is drawn inside that parent instead, and
 * a checklist line that lands back in its parent's column stops being a card at all — the board
 * mints no tile for it. Asked about either, `columnOf` says `null`, which about a move that just
 * succeeded reads as failure and invites an agent to retry a write it already made. Both are in
 * their parent's column, so that is what to report.
 */
function landedColumn(board: Board, path: string): string | null {
  const seen = new Set<string>();
  let at: string | undefined = path;
  // Up the nesting until something has a tile: a child of a child drawn inside a grandparent is
  // still in the grandparent's column. A cycle never gets walked at all — the board refuses to
  // nest one and gives its members tiles of their own, so `columnOf` answers on the first look —
  // but `parentOf` does link both ways across one, so `seen` keeps a board that changed underneath
  // this from turning a wrong assumption into a hang.
  while (at !== undefined && !seen.has(at)) {
    const tiled = columnOf(board, at);
    if (tiled !== null) return tiled;
    seen.add(at);
    at = board.placedOf[at] ?? board.parentOf[at] ?? parseTodoPath(at)?.parentPath;
  }
  return null;
}

/** Frontmatter this board owns through a dedicated tool or field; writing it by hand skips that. */
const RESERVED_KEYS: Record<string, string> = {
  status: "a card's column is set by move_card, which also records the move in its history",
  order: "a card's position in its column is set by move_card",
  priority: "use update_card's own `priority` field, so the board remembers the value",
  due: "use update_card's own `due` field",
  // Written by hand, this retitles the card in the frontmatter and nowhere else: the file keeps its
  // old name and every `[[wikilink]]` pointing at it — a parent's checklist line included — still
  // names the card that no longer exists under that title.
  title: "use update_card's own `title` field, which renames the note and its inbound links",
  "folia-board":
    "that flag is what makes a note a board, not a card — setting it on a card would hand agents a second, broken board",
};

const propertyValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A due date, in the one format the board reads. The detail panel writes it from a date picker and
 * so cannot produce anything else; a tool that says `YYYY-MM-DD` and then accepts "next Friday"
 * would put a value in the frontmatter that every date sort and overdue badge silently misreads.
 * Stated as a pattern so it reaches the agent in the published schema, not only on a failed call.
 */
const dueDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "A due date must be written as YYYY-MM-DD, for example 2026-03-14.",
  );

/** Refuse the keys a dedicated tool or field owns, naming the one that should have been used. */
function refuseReservedKeys(properties: Record<string, unknown> | undefined): void {
  for (const key of Object.keys(properties ?? {})) {
    // Own keys only, so a property named "toString" is an ordinary key rather than a match
    // against Object.prototype that reports native code back to the caller.
    const reserved = Object.prototype.hasOwnProperty.call(RESERVED_KEYS, key)
      ? RESERVED_KEYS[key]
      : undefined;
    if (reserved) throw new ToolError(`"${key}" cannot be set through properties: ${reserved}.`);
  }
}

/**
 * Set or clear one frontmatter key. `null` clears it, and only `null` — an agent that writes `""`
 * asked for an empty value, and deleting the key instead is data loss it never asked for and is
 * not told about. `docs/mcp.md` promises exactly this.
 */
async function writeField(
  repo: CardRepository,
  path: string,
  key: string,
  value: string | number | boolean | null,
): Promise<void> {
  if (value === null) await repo.unsetFrontmatterKey(path, key);
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
    priority: z
      .string()
      .optional()
      .describe(
        "A priority value. One the board already uses is preferred; a new one is added to the board's vocabulary, exactly as typing one into the card's details does.",
      ),
    due: dueDate.optional().describe("Due date, `YYYY-MM-DD`."),
  }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    if (!board.config.columns.some((c) => c.id === args.column)) {
      throw new ToolError(
        `Board "${board.config.path}" has no column "${args.column}". Its columns are: ${board.config.columns.map((c) => c.id).join(", ")}.`,
      );
    }
    const path = await repo.createCard(args.title, args.column);
    // The note exists from here on. A field write that fails afterwards must not be reported as
    // "create_card failed", because an agent hearing that creates the card again and the board
    // ends up with two. Name the card that is already there and what still needs doing to it.
    try {
      if (args.description !== undefined) await repo.setDescription(path, args.description);
      if (args.priority !== undefined) {
        await setCardPriority(repo, { path, value: args.priority }, board.config.priorities);
      }
      if (args.due !== undefined) await writeField(repo, path, "due", args.due);
    } catch (e) {
      throw new ToolError(
        `Card "${path}" was created in "${args.column}", but filling in its fields failed: ${e instanceof Error ? e.message : String(e)}. The card is on the board — finish it with update_card rather than creating it again.`,
      );
    }
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
    // the one write that accepts a card without a note behind it. What it cannot do is take a slot:
    // its position comes from where the line sits in its parent's checklist, which is not this
    // tool's to rewrite. Saying so beats silently ignoring the argument.
    const path = resolveCardPath(board, args.card);
    if (board.cards[path]?.todoRef && args.position !== undefined) {
      throw new ToolError(
        `"${path}" is a checklist line; it is ordered by its place in its parent's list, so move_card cannot give it a position. Drop the argument to move it to "${args.column}".`,
      );
    }
    const moved = await moveCardTo(repo, board, {
      path,
      columnId: args.column,
      ...(args.position === undefined ? {} : { index: args.position }),
    });
    // Nothing to write is not the same as nothing to report: a checklist line already claiming the
    // column it was asked to move to is exactly where the caller wants it.
    if (!moved && columnOf(board, path) !== args.column) {
      throw new ToolError(`Nothing to move: "${path}" is not a card on this board.`);
    }
    const after = await repo.loadBoard();
    const slot = (after.columns[args.column] ?? []).indexOf(path);
    return {
      path,
      column: landedColumn(after, path),
      // Only a card with a tile of its own has a slot to report. One drawn inside its parent is
      // ordered by that parent, so a number here would be an invitation to move_card a position
      // this tool would refuse.
      ...(slot < 0 ? {} : { position: slot }),
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
      priority: z
        .string()
        .nullable()
        .optional()
        .describe(
          "A priority value, or null to clear it. A value the board does not know yet is added to its vocabulary, exactly as typing one into the card's details does.",
        ),
      due: dueDate.nullable().optional().describe("Due date `YYYY-MM-DD`, or null to clear it."),
      properties: z
        .record(z.string(), propertyValue)
        .optional()
        .describe("Any other frontmatter keys to set, or null to remove."),
    })
    // Not expressible in the published JSON Schema, so clients see an all-optional object and only
    // meet this at call time; `docs/mcp.md` says so.
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
