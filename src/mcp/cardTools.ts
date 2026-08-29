// The write half of the tool surface. Every one of these goes through the same repository port and
// the same reducers the board view uses, so a card an agent touches gets the history lines, the
// checkbox syncing and the fractional ordering it would have got from a person dragging it.

import { z } from "zod";
import { columnOf } from "../model/board";
import type { Board } from "../model/types";
import { moveCardTo, setCardPriority, setSubtaskDone } from "../model/boardOps";
import { descriptionRefusal } from "../model/card";
import { TOOL_REFUSALS } from "../model/properties";
import { BLOCKS } from "../model/relationships";
import type { CardRepository } from "../model/repo";
import {
  boardArg,
  cardArg,
  columnArg,
  landedColumn,
  openBoard,
  resolveCardPath,
  resolveNotePath,
  tool,
  ToolError,
  type ToolDefinition,
} from "./tool";

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

/**
 * Refuse the keys a dedicated tool or field owns, naming the one that should have been used.
 *
 * The board's relationship keys are refused too, and those are not a fixed list: each board names
 * its own in the board note, so they are read from its config rather than hardcoded. Written by
 * hand, a relationship key looks like it worked — the board really does draw the link — while
 * skipping the history line `addRelation` writes and the self-relation it refuses. There is no
 * relationship tool yet to point at, so the error says so plainly instead of naming one.
 */
function refuseReservedKeys(board: Board, properties: Record<string, unknown> | undefined): void {
  // Both ends of every type: a relationship is stored under its key on one card and its inverse on
  // the other, so `blocked-by` written by hand is the same bypass as `blocks`. `BLOCKS` is in the
  // set whether or not the board lists it — every board has it, including notes written before the
  // vocabulary existed.
  const relationKeys = new Set(
    [BLOCKS, ...board.config.relations].flatMap((r) => [r.key, r.inverse]),
  );
  for (const key of Object.keys(properties ?? {})) {
    // Own keys only, so a property named "toString" is an ordinary key rather than a match
    // against Object.prototype that reports native code back to the caller.
    const reserved = Object.prototype.hasOwnProperty.call(TOOL_REFUSALS, key)
      ? TOOL_REFUSALS[key]
      : undefined;
    if (reserved) throw new ToolError(`"${key}" cannot be set through properties: ${reserved}.`);
    if (relationKeys.has(key)) {
      throw new ToolError(
        `"${key}" is one of this board's relationship keys. Writing it here would add the link without the history line the board records for one, and without the check that stops a card relating to itself. This server has no relationship tool yet, so a relationship has to be made in Obsidian.`,
      );
    }
  }
}

/**
 * A warning for a write that lands a card in a column with a filter rule, or `undefined` when there
 * is nothing to warn about.
 *
 * Such a column is a lane: the board fills it from the rule, not from `status`. Setting a card's
 * status to that column therefore does not put it in the lane, and because a card is only ever
 * drawn in its own status column, one that does not match the rule is drawn nowhere at all. The
 * board view has the same wart and accepts it, because a person dragging a card watches it happen;
 * an agent gets no such feedback, so it is told. Refusing outright would be the other option, but
 * the rule cannot be evaluated from here — it would refuse the moves that are perfectly fine along
 * with the ones that are not.
 */
function laneWarning(board: Board, columnId: string): string | undefined {
  const filter = board.config.columns.find((c) => c.id === columnId)?.filter;
  if (!filter) return undefined;
  return `Column "${columnId}" is filled by the rule \`${filter}\`, not by a card's status. This card now claims that column, but the board only draws it there if it matches the rule — check it with get_board, and set the fields the rule asks for if it has gone missing.`;
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

/**
 * A description the plugin would read back as something other than a description is refused, using
 * the same judgement the detail panel makes before it saves one.
 *
 * `setDescription` splices the text in verbatim, so a line reading `## History` inside it does not
 * stay text: the note is parsed back and that heading starts the real History section. An agent
 * could write its own audit trail, and sign a comment with the user's name, through the one tool
 * whose whole purpose is that writes are accountable. The description also silently loses
 * everything below the injected heading, so the call reports success over text that is largely
 * gone. The panel refuses this and says why; so does this.
 */
function refuseUnsafeDescription(description: string): void {
  const refusal = descriptionRefusal(description);
  if (refusal === null) return;
  if (refusal.kind === "heading") {
    throw new ToolError(
      `That description contains "${refusal.line}", which starts a section the board owns. The note would read it as that section rather than as description, and everything after it would stop being description at all. Use add_comment for a comment; history is the board's to write.`,
    );
  }
  if (refusal.kind === "title") {
    throw new ToolError(
      `That description opens with "${refusal.line}", and a card reads its title from the first \`#\` heading. The line would be taken as the title rather than kept as description, and it would not come back. Use \`##\` or lower, or set the title with update_card's own \`title\` field.`,
    );
  }
  throw new ToolError(
    `That description leaves a code fence open ("${refusal.line}"). Everything after it in the note, the board's own sections included, would be swallowed by the fence. Close it and try again.`,
  );
}

/**
 * Text that becomes one Markdown list item has to stay one line.
 *
 * A subtask and a comment are each written as a single `- …` line. A newline in the middle of one
 * is not a longer entry — it is raw Markdown spliced into the note: a second checklist line the
 * caller did not ask for, or a `## History` heading that opens the real section and lets an agent
 * write the record that is supposed to be about it. The panel's subtask control is a one-line
 * input, so this is the first caller that could send a newline at all.
 *
 * What this does not do, and is not meant to, is police what one line may say. A single-line
 * subtask carrying a `[status:: done]` claim promotes itself to a card on the board — and typing
 * exactly that into the panel does the same thing. The tools are meant to be as capable as a
 * person, not more careful than one; it is the forging of the board's own record that is out of
 * bounds.
 */
function refuseMultilineEntry(what: "subtask" | "comment", text: string): void {
  if (!/[\r\n]/.test(text)) return;
  throw new ToolError(
    `A ${what} is written as a single line, so its text cannot contain a line break — spliced into the note, the second line would be read as Markdown of its own rather than as part of what you wrote. Send it as one line${what === "comment" ? ", or as several comments" : ""}.`,
  );
}

/** The board really has that column, or an error naming the ones it does have. */
function requireColumn(board: Board, columnId: string): void {
  if (board.config.columns.some((c) => c.id === columnId)) return;
  throw new ToolError(
    `Board "${board.config.path}" has no column "${columnId}". Its columns are: ${board.config.columns.map((c) => c.id).join(", ")}.`,
  );
}

/**
 * A checklist line standing in a column of its own moves too — on its own line — so move_card is
 * the one write that accepts a card with no note behind it. What it cannot do is take a slot: its
 * position comes from where the line sits in its parent's checklist, which is not this tool's to
 * rewrite. Saying so beats silently ignoring the argument.
 */
function refuseSlotForChecklistLine(
  board: Board,
  path: string,
  args: { column: string; position?: number | undefined },
): void {
  if (!board.cards[path]?.todoRef || args.position === undefined) return;
  throw new ToolError(
    `"${path}" is a checklist line; it is ordered by its place in its parent's list, so move_card cannot give it a position. Drop the argument to move it to "${args.column}".`,
  );
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
    requireColumn(board, args.column);
    // Before the note exists, so a refused description does not leave an empty card behind.
    if (args.description !== undefined) refuseUnsafeDescription(args.description);
    const path = await repo.createCard(args.title, args.column);
    // The note exists from here on. A field write that fails afterwards must not be reported as
    // "create_card failed", because an agent hearing that creates the card again and the board
    // ends up with two. Name the card that is already there and what still needs doing to it.
    try {
      if (args.description !== undefined) await repo.setDescription(path, args.description);
      if (args.priority !== undefined) {
        await setCardPriority(repo, { path, value: args.priority });
      }
      if (args.due !== undefined) await writeField(repo, path, "due", args.due);
    } catch (e) {
      throw new ToolError(
        `Card "${path}" was created in "${args.column}", but filling in its fields failed: ${e instanceof Error ? e.message : String(e)}. The card is on the board — finish it with update_card rather than creating it again.`,
      );
    }
    const warning = laneWarning(board, args.column);
    return { path, column: args.column, ...(warning === undefined ? {} : { warning }) };
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
    requireColumn(board, args.column);
    const path = resolveCardPath(board, args.card);
    refuseSlotForChecklistLine(board, path, args);
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
    const warning = laneWarning(board, args.column);
    return {
      path,
      column: landedColumn(after, path),
      ...(warning === undefined ? {} : { warning }),
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
    refuseReservedKeys(board, args.properties);
    if (args.description !== undefined) {
      refuseUnsafeDescription(args.description);
      await repo.setDescription(path, args.description);
    }
    if (args.priority !== undefined) {
      await setCardPriority(repo, { path, value: args.priority ?? "" });
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
  input: z.object({
    board: boardArg,
    card: cardArg,
    text: z.string().min(1).describe("The comment, as a single line."),
  }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveNotePath(board, args.card);
    refuseMultilineEntry("comment", args.text);
    await repo.addComment(path, args.text);
    return { path, comments: (await repo.readBody(path)).comments.length };
  },
});

const addSubtask = tool({
  name: "add_subtask",
  title: "Add a subtask",
  description: "Append an unchecked line to a card's `## Subtasks` checklist.",
  input: z.object({
    board: boardArg,
    card: cardArg,
    text: z.string().min(1).describe("The subtask, as a single line."),
  }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveNotePath(board, args.card);
    refuseMultilineEntry("subtask", args.text);
    const before = (await repo.readBody(path)).subtasks.length;
    await repo.addTodo(path, args.text);
    const subtasks = (await repo.readBody(path)).subtasks;
    // The line this call added, which with one line written is the one after those already there.
    // Reporting `at(-1)` would name whatever ended up last, and a follow-up set_subtask_done would
    // tick that instead of the caller's own.
    return { path, index: subtasks[before]?.index, subtasks: subtasks.length };
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
    const line = subtasks.find((s) => s.index === args.index);
    if (!line) {
      throw new ToolError(
        `"${path}" has no subtask ${args.index}. It has ${subtasks.length}, indexed ${subtasks.map((s) => s.index).join(", ") || "not at all"}.`,
      );
    }
    // The line's own `[[link]]` goes with it, exactly as the detail panel passes the subtask it
    // drew. Without it a subcard line's checkbox is ticked and the child note is left where it was,
    // which is the one thing this tool promises not to do.
    await setSubtaskDone(repo, board, {
      path,
      index: args.index,
      done: args.done,
      ...(line.link === undefined ? {} : { link: line.link }),
    });
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
