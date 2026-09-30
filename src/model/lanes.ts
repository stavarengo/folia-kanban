// What a lane is, said once and below the CardRepository port so the board view and the MCP tools
// answer it the same way.
//
// A column carrying a `filter` rule is a LANE: a view of that rule over every card standing in a
// column, wherever that card's `status` says it lives. It is never an owner. A card's `status`
// naming a lane therefore does not put the card in it — only the rule does — which is why filing a
// card into a lane it does not match used to leave it drawn in no column at all.

import {
  judgeCard,
  parseFilter,
  writtenTokens,
  type Filter,
  type FilterKey,
  type FilterVerdict,
  type MatchContext,
} from "./filter";
import { dateOnly } from "./dates";
import { samePriority } from "./priorities";
import type { Board, Card, CardFrontmatter, ColumnDef } from "./types";

/** A column read as the rule it draws by: the rule as written, and the same rule parsed. */
export interface Lane {
  columnId: string;
  title: string;
  /** The rule exactly as the board note wrote it, so a refusal can quote what the card must satisfy. */
  rule: string;
  filter: Filter;
}

function asLane(column: ColumnDef): Lane | null {
  if (!column.filter) return null;
  return {
    columnId: column.id,
    title: column.title,
    rule: column.filter,
    filter: parseFilter(column.filter),
  };
}

// A board's rules parsed once. Keyed on the column list the board was built from, which is a new
// array per load and never mutated, so a reloaded board reparses and a re-render does not.
const laneCache = new WeakMap<readonly ColumnDef[], Lane[]>();

/** The board's lane columns, in board order. Empty for a board whose columns are all plain. */
function lanesOf(board: Board): Lane[] {
  const cached = laneCache.get(board.config.columns);
  if (cached) return cached;
  const lanes = board.config.columns.map(asLane).filter((l): l is Lane => l !== null);
  laneCache.set(board.config.columns, lanes);
  return lanes;
}

/** The lane `columnId` is, or null when that column is plain (or is no column of this board). */
function laneOf(board: Board, columnId: string): Lane | null {
  const column = board.config.columns.find((c) => c.id === columnId);
  return column ? asLane(column) : null;
}

/** How a column would treat a card: the lane it is, and that lane's verdict on the card. */
export interface LaneCheck {
  lane: Lane;
  verdict: FilterVerdict;
}

/** What the lane `columnId` makes of `card`, or null when that column is plain and owns its cards. */
export function laneVerdict(
  board: Board,
  columnId: string,
  card: Card,
  ctx: MatchContext,
): LaneCheck | null {
  const lane = laneOf(board, columnId);
  if (!lane) return null;
  // Judged as the write would leave the card, not as it is now: filing a card into a column sets
  // its `status`, and a rule may read exactly that (`status:`, and the `due:` token's done check).
  // Asking about the card as it stands would refuse a move that is about to become valid, and wave
  // through one that is about to stop being.
  const filed = { ...card, frontmatter: { ...card.frontmatter, status: columnId } };
  return { lane, verdict: judgeCard(filed, lane.filter, ctx) };
}

/**
 * The one sentence a notice and a tool error both say about a card a lane will not draw. Written
 * once because a person dragging a card and an agent calling `move_card` are owed the same
 * explanation; each caller adds its own next step.
 */
export function laneMismatch(lane: Lane, card: Card): string {
  return `"${lane.title}" shows the cards matching \`${lane.rule}\`, and "${card.title}" does not match it.`;
}

/**
 * Why filing `card` into `columnId` would leave it drawn nowhere, or null when the write is safe.
 *
 * Safe covers three cases: the column is plain and owns its cards outright; the column is a lane
 * whose rule the card satisfies; or the column is a lane whose rule this caller cannot fully
 * evaluate ({@link judgeCard} says `unknown` — `unread:` and `assignee:me` read state that is not
 * on the card). Refusing on a rule you cannot read would block a move the board itself would
 * accept, which is a worse failure than the one this guards against.
 */
export function laneRefusal(
  board: Board,
  columnId: string,
  card: Card,
  ctx: MatchContext,
): string | null {
  const check = laneVerdict(board, columnId, card, ctx);
  return check?.verdict === "rejects" ? laneMismatch(check.lane, card) : null;
}

/**
 * The column that draws a card no lane will: the first column that is not itself a lane.
 *
 * `buildBoard` files a card into the column its `status` names, and a lane ignores that bucket, so
 * a card whose `status` names a lane it does not match has a bucket nobody reads. Refusing the
 * writes that produce that state does nothing for the notes already in it — a `status` typed by
 * hand, or written before the refusal existed — so the board draws those cards here instead of
 * losing them. It is the same fallback an unrecognised `status` has always had.
 *
 * A board whose every column carries a rule has no such column: there, a card matching no rule has
 * no place the board can honestly give it, and `undefined` says so.
 */
export function fallbackColumnOf(board: Board): string | undefined {
  return board.config.columns.find((c) => !c.filter)?.id;
}

/**
 * Every card standing in a column of its own, in board order, with the column it stands in. A lane
 * pulls its population from here, and the walk happens once rather than once per path.
 */
function standing(board: Board): { path: string; columnId: string }[] {
  const out: { path: string; columnId: string }[] = [];
  for (const column of board.config.columns) {
    for (const path of board.columns[column.id] ?? []) {
      if (board.cards[path]) out.push({ path, columnId: column.id });
    }
  }
  return out;
}

/**
 * The columns that draw a card standing in `standsIn`, in board order — the ONE rule every other
 * question here is asked through, so a card cannot be claimed by one answer and disowned by another.
 *
 * A plain column owns what stands in it. A lane ignores its own bucket and pulls by its rule from
 * every bucket, so several lanes can draw one card at once, which the board has always allowed. The
 * exception is a rule this caller cannot read ({@link judgeCard} says `unknown`, for `unread:` and
 * `assignee:me`): the lane the card's `status` already names keeps it, since that is where the card
 * claims to be and the rule may well reach it, while another lane does not claim it on a guess.
 *
 * An empty result means nothing draws the card — what {@link fallbackColumnOf} exists to catch.
 */
function drawnBy(
  lanes: readonly Lane[],
  card: Card,
  standsIn: string,
  ctx: MatchContext,
): string[] {
  const pulled = lanes
    .filter((lane) => {
      const verdict = judgeCard(card, lane.filter, ctx);
      return verdict === "matches" || (verdict === "unknown" && lane.columnId === standsIn);
    })
    .map((lane) => lane.columnId);
  // A plain bucket owns its card outright and keeps it whatever the lanes say; a lane's bucket is
  // not ownership at all, so there the lanes are the whole answer — and an empty one means the
  // card would be drawn nowhere.
  return lanes.some((l) => l.columnId === standsIn) ? pulled : [standsIn, ...pulled];
}

/**
 * Cards sitting in a lane's bucket that no lane will draw — the ones {@link fallbackColumnOf} takes
 * in, and the only cards a plain column is ever given from outside its own bucket.
 */
function strandedLanePaths(board: Board, ctx: MatchContext): string[] {
  const lanes = lanesOf(board);
  if (lanes.length === 0) return [];
  const out: string[] = [];
  for (const { path, columnId } of standing(board)) {
    const card = board.cards[path];
    if (card && drawnBy(lanes, card, columnId, ctx).length === 0) out.push(path);
  }
  return out;
}

/**
 * The cards a column draws, in board order — the single definition of column membership, asked the
 * same way by the board view and by anything reading through the port.
 */
export function drawnPaths(board: Board, columnId: string, ctx: MatchContext): string[] {
  const column = board.config.columns.find((c) => c.id === columnId);
  if (!column) return [];
  if (column.filter) {
    const lanes = lanesOf(board);
    const out: string[] = [];
    for (const { path, columnId: from } of standing(board)) {
      const card = board.cards[path];
      if (card && drawnBy(lanes, card, from, ctx).includes(columnId)) out.push(path);
    }
    return out;
  }
  const own = (board.columns[columnId] ?? []).filter((p) => board.cards[p]);
  if (fallbackColumnOf(board) !== columnId) return own;
  const stranded = strandedLanePaths(board, ctx);
  return stranded.length === 0 ? own : [...own, ...stranded];
}

/**
 * Where a card whose tile sits in `columnId` is actually drawn: the first column that draws it, and
 * the fallback column when none does. Asked through {@link drawnBy}, so `get_card` can never name a
 * column `get_board`'s listing disagrees with.
 */
export function drawnInColumn(
  board: Board,
  columnId: string,
  path: string,
  ctx: MatchContext,
): string | null {
  const column = board.config.columns.find((c) => c.id === columnId);
  if (!column) return null;
  const card = board.cards[path];
  if (!card) return null;
  return drawnBy(lanesOf(board), card, column.id, ctx)[0] ?? fallbackColumnOf(board) ?? null;
}

/**
 * The card `CardRepository.createCard(title, columnId)` is about to write, as the board would read
 * it back — enough of one to put a lane's rule to, before a note exists to judge.
 *
 * It mirrors what the adapter writes (`type`, `status`, `created`, plus whatever the caller fills
 * in afterwards) and nothing else, which is the point: a rule asking for a field nobody is setting
 * is a rule the new card will fail, and saying so before the note exists beats creating a card the
 * board draws in a column the caller did not ask for.
 */
export function prospectiveCard(
  title: string,
  columnId: string,
  fields: Partial<CardFrontmatter> = {},
): Card {
  return {
    path: "",
    basename: title,
    title,
    titleSource: "heading",
    frontmatter: { type: "task", status: columnId, created: dateOnly(), ...fields },
    childLinks: [],
  };
}

/** The board's own spelling of a priority a rule names, so `priority:a` writes the `A` it ranks. */
function boardSpelling(board: Board, value: string): string {
  const carried = Object.values(board.cards).map((c) => c.frontmatter.priority);
  const known = [...board.config.priorities, ...carried].find(
    (p): p is string => typeof p === "string" && samePriority(p, value),
  );
  return known ?? value;
}

/** A property a token writes, and whether a second token adds to it or replaces it. */
interface Written {
  key: "area" | "priority" | "tags" | "assignee" | "due";
  value: string;
  list?: true;
}

/**
 * What one token of a rule writes onto an added card, or null when it names nothing a note can
 * simply carry. `status:` is the column the write already names; `context:` is the folder a card
 * lives in; `is:`, `unread:` and `due:soon` or `overdue` describe a state rather than a value; a
 * `none` asks for nothing.
 */
const WRITES: Partial<
  Record<FilterKey, (value: string, board: Board, ctx: MatchContext) => Written | null>
> = {
  area: (value) => ({ key: "area", value }),
  priority: (value, board) => ({ key: "priority", value: boardSpelling(board, value) }),
  tag: (value) => ({ key: "tags", value, list: true }),
  assignee: (value, _board, ctx) => {
    const word = value.toLowerCase();
    const name = word === "none" ? "" : word === "me" ? (ctx.me ?? "").trim() : value;
    return name ? { key: "assignee", value: name, list: true } : null;
  },
  due: (value, _board, ctx) => {
    const word = value.toLowerCase();
    if (word === "today") return { key: "due", value: ctx.today };
    return /^\d{4}-\d{2}-\d{2}$/.test(word) ? { key: "due", value: word } : null;
  },
};

/**
 * What a card added straight into `columnId` is written with, so the lane there draws it: each
 * value its rule names that a note can simply carry ({@link WRITES}), in the case the rule wrote it
 * (a priority in the board's own spelling). Empty for a plain column. Tokens that write nothing —
 * free text included, which is the title's business — are left for {@link takesNewCards} to judge
 * as they stand.
 */
export function laneFill(
  board: Board,
  columnId: string,
  ctx: MatchContext,
): Partial<CardFrontmatter> {
  const lane = laneOf(board, columnId);
  if (!lane) return {};
  const lists: Record<string, string[]> = {};
  const fill: Partial<CardFrontmatter> = {};
  for (const token of writtenTokens(lane.rule)) {
    const written = WRITES[token.key]?.(token.value, board, ctx);
    if (!written) continue;
    if (written.list) (lists[written.key] ??= []).push(written.value);
    else fill[written.key] = written.value;
  }
  // One tag is still a list, as Obsidian writes `tags`; one assignee is the plain name people type.
  for (const [key, values] of Object.entries(lists)) {
    fill[key] = key === "assignee" && values.length === 1 ? values[0] : values;
  }
  return fill;
}

/**
 * Can a card added straight into `columnId` ever be drawn there? True for a plain column, and for
 * a lane whose rule the added card — filled by {@link laneFill} — would not reject. False is a
 * lane whose rule reads something an added card cannot carry (`is:blocked`, `due:overdue`, a
 * `context:` — a new note sits in the card folder itself, which is no context — or two different
 * areas), where offering to add a card would only lead to a refusal.
 *
 * Asked before a title exists, so free text in the rule is set aside: a title can still match it,
 * and whether this one does is the add's own question once it has been typed.
 */
export function takesNewCards(board: Board, columnId: string, ctx: MatchContext): boolean {
  return !rejectedBeyondTitle(
    board,
    columnId,
    prospectiveCard("", columnId, laneFill(board, columnId, ctx)),
    ctx,
  );
}

/**
 * Does the lane `columnId` reject `card` over something other than its words? False for a plain
 * column, and for a card whose only miss is free text in the rule — the one a new title can fix,
 * which is worth telling apart from a rule the card could never meet.
 */
export function rejectedBeyondTitle(
  board: Board,
  columnId: string,
  card: Card,
  ctx: MatchContext,
): boolean {
  const lane = laneOf(board, columnId);
  if (!lane) return false;
  const filed = { ...card, frontmatter: { ...card.frontmatter, status: columnId } };
  return judgeCard(filed, { text: [], tokens: lane.filter.tokens }, ctx) === "rejects";
}

/**
 * Is a card STANDING IN `standsIn` drawn anywhere on the board? False only for one the board would
 * show nowhere at all. Asked only about a card with a tile: a nested card stands in no bucket, and
 * its visibility is its parent's question, not this one's.
 *
 * The tally asks this rather than resolving lane rules itself: two answers to "does a lane draw
 * this" is how a toolbar comes to say "0 of 1" beside a tile the user can plainly see.
 */
export function isDrawnSomewhere(
  board: Board,
  path: string,
  standsIn: string,
  ctx: MatchContext,
): boolean {
  const card = board.cards[path];
  if (!card) return false;
  return (
    drawnBy(lanesOf(board), card, standsIn, ctx).length > 0 || fallbackColumnOf(board) !== undefined
  );
}
