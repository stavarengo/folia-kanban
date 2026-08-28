// The tool kit: what a tool is, how its arguments are validated, and how a tool names the board
// and the card it was asked about. The tools themselves live in boardTools.ts / cardTools.ts.

import { z } from "zod";
import type { Board } from "../model/types";
import type { CardRepository } from "../model/repo";
import type { BoardHost } from "./host";

/**
 * A failure the caller can act on: an unknown board, an ambiguous card reference, a field this
 * tool refuses to write. Reported as a tool error (the model sees the text and can correct
 * itself), never as a protocol error.
 */
export class ToolError extends Error {}

/** JSON Schema as `tools/list` publishes it. */
type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** True when the tool only reads. Published as the `readOnlyHint` annotation. */
  readOnly: boolean;
  /** Validate `args` and run. Throws {@link ToolError} for anything the caller can fix. */
  invoke(host: BoardHost, args: unknown): Promise<unknown>;
}

interface ToolSpec<S extends z.ZodType> {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly?: boolean;
  run(host: BoardHost, args: z.infer<S>): Promise<unknown>;
}

/**
 * Define one tool. The Zod schema is both the runtime guard and the published contract — the JSON
 * Schema clients read is generated from it, so a schema and its validation cannot drift apart.
 */
export function tool<S extends z.ZodType>(spec: ToolSpec<S>): ToolDefinition {
  const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(spec.input, { io: "input" });
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema,
    readOnly: spec.readOnly ?? false,
    invoke: (host, args) => spec.run(host, parseArgs(spec.input, args)),
  };
}

function parseArgs<S extends z.ZodType>(schema: S, args: unknown): z.infer<S> {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) throw new ToolError(z.prettifyError(parsed.error));
  return parsed.data;
}

/** The three arguments most tools take, defined once so their published wording cannot drift. */
export const boardArg = z.string().describe("Vault path of the board note, e.g. `Work/Board.md`.");
export const cardArg = z
  .string()
  .describe("Vault path of the card note, as get_board reports it. A card title also works.");
export const columnArg = z.string().describe("Column id, as get_board reports it — not its title.");

/** The board `path` names, loaded. */
export async function openBoard(
  host: BoardHost,
  path: string,
): Promise<{ repo: CardRepository; board: Board }> {
  const repo = host.repoFor(path);
  if (!repo) {
    const known = host
      .listBoards()
      .map((b) => b.path)
      .join(", ");
    throw new ToolError(
      known
        ? `No board note at "${path}". The boards in this vault are: ${known}.`
        : `No board note at "${path}", and this vault has none. A board is a note with "folia-board: true" in its frontmatter.`,
    );
  }
  return { repo, board: await repo.loadBoard() };
}

/**
 * The card `ref` names. A vault path is the exact form `get_board` hands out and is matched first;
 * a title or file name is accepted too, and is refused rather than guessed when the board has more
 * than one card answering to it.
 */
export function resolveCardPath(board: Board, ref: string): string {
  if (board.cards[ref]) return ref;
  const matches = Object.values(board.cards).filter(
    (c) => c.title === ref || c.basename === ref || c.path === `${ref}.md`,
  );
  if (matches.length === 1) return matches[0]?.path ?? ref;
  if (matches.length > 1) {
    throw new ToolError(
      `"${ref}" names ${matches.length} cards on this board: ${matches.map((c) => c.path).join(", ")}. Pass one of those paths.`,
    );
  }
  throw new ToolError(
    `No card "${ref}" on board "${board.config.path}". Pass a card path as get_board reports it.`,
  );
}

/** A card path that names a real note — everything a write other than a move needs. */
export function resolveNotePath(board: Board, ref: string): string {
  const path = resolveCardPath(board, ref);
  const todoRef = board.cards[path]?.todoRef;
  if (!todoRef) return path;
  throw new ToolError(
    `"${path}" is a checklist line in "${todoRef.parentPath}", not a note of its own. Move it with move_card, or edit line ${todoRef.index} of that note with the subtask tools.`,
  );
}
