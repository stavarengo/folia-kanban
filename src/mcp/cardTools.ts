// The write half of the tool surface. Every one of these goes through the same repository port and
// the same reducers the board view uses, so a card an agent touches gets the history lines, the
// checkbox syncing and the fractional ordering it would have got from a person dragging it.

import { z } from "zod";
import { boardMatchContext } from "../model/board";
import { prospectiveCard } from "../model/lanes";
import type { Board } from "../model/types";
import { setCardPriority, setSubtaskDone } from "../model/boardOps";
import { SCALAR_ONLY_KEYS, TOOL_REFUSALS } from "../model/properties";
import { BLOCKS } from "../model/relationships";
import type { CardRepository } from "../model/repo";
import { StaleLineError } from "../model/repo";
import { laneWarning, refuseLaneMismatch, requireColumn } from "./columnChecks";
import { moveCard } from "./moveCard";
import { refuseAuthor, refuseMultilineEntry, refuseUnsafeDescription } from "./refusals";
import {
  boardArg,
  cardArg,
  columnArg,
  openBoard,
  resolveNotePath,
  tool,
  ToolError,
  type ToolDefinition,
} from "./tool";

const scalarPropertyValue = z.union([z.string(), z.number(), z.boolean()]);

/**
 * What a frontmatter value may be through `properties`: a scalar, a list of scalars, or `null` to
 * clear the key. The list case exists because the read side already hands one back — `get_card`
 * and `get_board` report a list-valued key, `assignee` most visibly, exactly as the note holds it
 * — and a tool that could read a list but never write one back would force whoever holds
 * `["alex", "ana maria"]` to either drop a name or fold both into one string the board then reads
 * as a single person. Writing a list still replaces the key wholesale, the same as writing a
 * scalar does. `refuseArrayForScalarKey` below refuses it for the handful of keys a list would
 * actually break; every other key takes the shape it was given.
 */
const propertyValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(scalarPropertyValue),
]);

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
  for (const [key, value] of Object.entries(properties ?? {})) {
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
    // A list is only bad news on the handful of keys the board reads with a plain `String(...)`
    // coercion — see `SCALAR_ONLY_KEYS`. Every other key, Folia's own or the vault's, is handed
    // back whole by `get_card`/`get_board` and may be written back the same shape it came in.
    refuseArrayForScalarKey(key, value);
  }
}

/**
 * The array half of {@link refuseReservedKeys}: split out because it turns on the *value*, not
 * only the key, and `refuseReservedKeys` otherwise never looks past `Object.keys`.
 */
function refuseArrayForScalarKey(key: string, value: unknown): void {
  if (!Array.isArray(value) || !SCALAR_ONLY_KEYS.has(key)) return;
  throw new ToolError(
    `"${key}" feeds a filter that reads one value, not a list — writing a list there is not a wider value, it is one the board would stop matching. Send a single string, number or boolean instead.`,
  );
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
  value: string | number | boolean | (string | number | boolean)[] | null,
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
    requireColumn(board, args.column);
    // Both refusals run before the note exists, so neither leaves an empty card behind. The lane is
    // put to the card `createCard` is about to write: a rule asking for a field this call has no way
    // to set is a rule the new card cannot satisfy.
    if (args.description !== undefined) refuseUnsafeDescription(args.description);
    const laneCtx = boardMatchContext(board);
    const willBe = prospectiveCard(args.title, args.column, {
      ...(args.priority === undefined ? {} : { priority: args.priority }),
      ...(args.due === undefined ? {} : { due: args.due }),
    });
    refuseLaneMismatch(
      board,
      { columnId: args.column, card: willBe, ctx: laneCtx },
      "No card was created. Create it in a column with no rule of its own and give it what the rule asks for with update_card, or pass the fields the rule wants to this call.",
    );
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
    const warning = laneWarning(board, args.column, willBe, laneCtx);
    return { path, column: args.column, ...(warning === undefined ? {} : { warning }) };
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
        .describe(
          "Any other frontmatter keys to set, or null to remove. A value can be a list, for a " +
            "key like `assignee` that names more than one person; writing one replaces the whole " +
            "key, the same as a scalar does. `area` refuses a list — it feeds a filter that " +
            "reads one value.",
        ),
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
    "Append a comment to a card's `## Comments` section, timestamped and signed with the `author` you give. Sign it with your own name: the user's name is theirs, and a comment wearing it is one they will never be shown as new.",
  input: z.object({
    board: boardArg,
    card: cardArg,
    text: z.string().min(1).describe("The comment, as a single line."),
    author: z
      .string()
      .describe("Who is writing, as one word: your own name (`codex`), never the user's."),
  }),
  run: async (host, args) => {
    const { repo, board } = await openBoard(host, args.board);
    const path = resolveNotePath(board, args.card);
    refuseMultilineEntry("comment", args.text);
    refuseAuthor(args.author);
    await repo.addComment(path, args.text, args.author);
    return { path, comments: (await repo.readBody(path)).comments.length };
  },
});

const addSubtask = tool({
  name: "add_subtask",
  title: "Add a subtask",
  description:
    "Append an unchecked line to a card's `## Subtasks` checklist. The reply names the line it wrote, `index`, `text` and `occurrence`, in the words set_subtask_done will expect.",
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
    // tick that instead of the caller's own. Its `text` comes back read from the note rather than
    // echoed from the argument: the note is what set_subtask_done compares against, and what it
    // reads back has been trimmed of the padding and the inline fields the line still carries.
    const added = subtasks[before];
    return {
      path,
      index: added?.index,
      text: added?.text,
      occurrence: added?.occurrence,
      subtasks: subtasks.length,
    };
  },
});

const setSubtask = tool({
  name: "set_subtask_done",
  title: "Tick or untick a subtask",
  description:
    "Check or uncheck one `## Subtasks` line, named by the index AND the text get_card reported for it — and, between lines reading exactly the same, its occurrence. A line that claims a column of its own is kept in step with its checkbox.",
  input: z.object({
    board: boardArg,
    card: cardArg,
    index: z.number().int().min(0).describe("The subtask's `index`, as get_card reports it."),
    text: z
      .string()
      .describe(
        "The subtask's `text`, exactly as get_card reports it in `subtasks`. An index is only a position: pass the words too and the write refuses instead of landing on whatever line has taken that place since you read the card.",
      ),
    occurrence: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "The subtask's `occurrence`, as get_card reports it: which of the lines reading exactly this `text` it is. Pass it and a line added or removed above a pair of identical lines is refused rather than landing on the other one.",
      ),
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
    if (line.text !== args.text) {
      throw new ToolError(
        `Subtask ${args.index} of "${path}" reads "${line.text}", not "${args.text}". The card changed since you read it — read it again and name the line you mean by what it says now.`,
      );
    }
    if (args.occurrence !== undefined && line.occurrence !== args.occurrence) {
      throw new ToolError(
        `Subtask ${args.index} of "${path}" reads "${args.text}", but it is occurrence ${line.occurrence} of the lines reading that, not ${args.occurrence} — a line was added or removed above it since you read the card. Read it again and name the line you mean by what it says now.`,
      );
    }
    // The line goes whole, exactly as the detail panel passes the subtask it drew: its `[[link]]`,
    // without which a subcard's checkbox is ticked and the child note left where it was — the one
    // thing this tool promises not to do — and its own `[status:: …]` claim, which is what deciding
    // where the work now belongs is read from.
    let laneRefused: string | null;
    try {
      laneRefused = await setSubtaskDone(repo, board, {
        path,
        line,
        done: args.done,
        ctx: boardMatchContext(board),
      });
    } catch (e) {
      // The note changed between this call's own read and its write — rarer than a stale index.
      // The refused write did not land; when the tick got through and only its column claim was
      // refused, the message says which half, so a retry knows what it is repeating.
      if (e instanceof StaleLineError) throw new ToolError(e.message);
      throw e;
    }
    return {
      path,
      index: args.index,
      text: args.text,
      done: args.done,
      ...(laneRefused === null
        ? {}
        : {
            warning: `${laneRefused} The box is ticked; the card keeps the column it was in, because a lane draws by its rule and would not have shown it.`,
          }),
    };
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
