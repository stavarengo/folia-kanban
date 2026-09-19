// The tool kit: what a tool is, how its arguments are validated, and how a tool names the board
// and the card it was asked about. The tools themselves live in boardTools.ts / cardTools.ts.

import { z } from "zod";
import { boardLinkResolver, columnOf, parseTodoPath } from "../model/board";
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
 * a title or a file name is accepted too, and is refused rather than guessed when the board has
 * more than one card answering to it.
 *
 * A file name is read the way the board itself reads a `[[wikilink]]` written in the board note,
 * so the tools and the board can never bind one name to two different cards: a name two folders
 * share names the card that link would open, rather than nothing. A title has no such reading —
 * it is not a link target — so titles are matched here and nowhere else, and two cards answering
 * to one title are still named rather than guessed between.
 */
export function resolveCardPath(board: Board, ref: string): string {
  // `hasOwn`, not a truthiness test: `board.cards` is a plain object, so a ref of
  // "toString" or "constructor" would otherwise resolve to a function off the prototype and crash
  // somewhere far from here, instead of getting the "no card answers to that" error.
  if (Object.prototype.hasOwnProperty.call(board.cards, ref)) return ref;
  const linked = boardLinkResolver(board, board.config.path)(ref);
  const matches = Object.values(board.cards).filter(
    (c) =>
      // A checklist line standing in a column of its own carries its parent's file name, so
      // matching it by that name would make every such line a rival of the note it lives in. Its
      // own text is its title, which is what it answers to.
      c.title === ref || (!c.todoRef && c.path === linked),
  );
  const ambiguous = (paths: string[]): never => {
    throw new ToolError(
      `"${ref}" names ${paths.length} cards on this board: ${paths.join(", ")}. Pass one of those paths.`,
    );
  };
  const bound = [...new Set(matches.map((c) => c.path))];
  if (bound.length === 1) return bound[0] ?? ref;
  if (bound.length > 1) ambiguous(bound);
  // Nothing bound. The file name may still sit on a card the vault's link resolution passed over —
  // a note outside the card folder can win a bare name — or on two of them at once. A card that
  // owns the name alone is what the caller meant; two are named rather than guessed between.
  const named = [
    ...new Set(
      Object.values(board.cards)
        .filter((c) => !c.todoRef && (c.basename === ref || c.path === `${ref}.md`))
        .map((c) => c.path),
    ),
  ];
  if (named.length === 1) return named[0] ?? ref;
  if (named.length > 1) ambiguous(named);
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
    `"${path}" is a checklist line in "${todoRef.parentPath}", not a note of its own. Move it with move_card, or edit line ${todoRef.line.index} of that note with the subtask tools.`,
  );
}

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
export function landedColumn(board: Board, path: string): string | null {
  const standing = landedOn(board, path);
  return standing === null ? null : columnOf(board, standing);
}

/**
 * The card whose tile actually shows `path` — itself when it has one, else the ancestor it is drawn
 * inside. A lane's rule is asked about THAT card, never about the nested one: a nested card stands
 * in no bucket, so a rule would find nothing to pull and the answer would be a column the board
 * does not draw it in.
 */
export function landedOn(board: Board, path: string): string | null {
  const seen = new Set<string>();
  let at: string | undefined = path;
  // Up the nesting until something has a tile: a child of a child drawn inside a grandparent is
  // still in the grandparent's column. A cycle never gets walked at all — the board refuses to
  // nest one and gives its members tiles of their own, so `columnOf` answers on the first look —
  // but `parentOf` does link both ways across one, so `seen` keeps a board that changed underneath
  // this from turning a wrong assumption into a hang.
  while (at !== undefined && !seen.has(at)) {
    if (columnOf(board, at) !== null) return at;
    seen.add(at);
    at = board.placedOf[at] ?? board.parentOf[at] ?? parseTodoPath(at)?.parentPath;
  }
  return null;
}
