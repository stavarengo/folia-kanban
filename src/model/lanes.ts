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
  type Filter,
  type FilterVerdict,
  type MatchContext,
} from "./filter";
import { dateOnly } from "./dates";
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

/** The board's lane columns, in board order. Empty for a board whose columns are all plain. */
export function lanesOf(board: Board): Lane[] {
  return board.config.columns.map(asLane).filter((l): l is Lane => l !== null);
}

/** The lane `columnId` is, or null when that column is plain (or is no column of this board). */
export function laneOf(board: Board, columnId: string): Lane | null {
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
 * The one sentence a toast and a tool error both say about a card a lane will not draw. Written
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
 * Cards sitting in a lane's bucket that no lane will draw — the ones {@link fallbackColumnOf} takes
 * in. Only a card every lane actively REJECTS counts: a lane whose rule this caller cannot evaluate
 * ({@link judgeCard} says `unknown`) may well be drawing the card, and moving it to the fallback
 * column on a guess would report a position nobody can see.
 */
export function strandedLanePaths(board: Board, ctx: MatchContext): string[] {
  const lanes = lanesOf(board);
  if (lanes.length === 0) return [];
  const laneIds = new Set(lanes.map((l) => l.columnId));
  return standing(board)
    .filter(({ path, columnId }) => {
      if (!laneIds.has(columnId)) return false;
      const card = board.cards[path];
      return card != null && lanes.every((lane) => judgeCard(card, lane.filter, ctx) === "rejects");
    })
    .map(({ path }) => path);
}

/**
 * The cards a column draws, in board order — the single definition of column membership, asked the
 * same way by the board view and by anything reading through the port.
 *
 * A lane ignores its own bucket and pulls every card standing in a column that its rule matches,
 * wherever that card lives; a card can therefore be drawn by several lanes at once, which the board
 * has always allowed. A plain column draws its own bucket, and the fallback column additionally
 * draws whatever no lane would ({@link strandedLanePaths}).
 */
export function drawnPaths(board: Board, columnId: string, ctx: MatchContext): string[] {
  const lane = laneOf(board, columnId);
  if (lane) {
    return standing(board)
      .filter(({ path, columnId: from }) => {
        const card = board.cards[path];
        if (card == null) return false;
        const verdict = judgeCard(card, lane.filter, ctx);
        // `unknown` is a rule this caller cannot read. A card standing in this lane's own bucket
        // stays listed under it — that is where its `status` puts it and the board may well be
        // drawing it — while a card from elsewhere is not claimed on a guess.
        return verdict === "matches" || (verdict === "unknown" && from === columnId);
      })
      .map(({ path }) => path);
  }
  const own = (board.columns[columnId] ?? []).filter((p) => board.cards[p]);
  if (fallbackColumnOf(board) !== columnId) return own;
  const stranded = strandedLanePaths(board, ctx);
  return stranded.length === 0 ? own : [...own, ...stranded];
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

/**
 * Where a card whose tile sits in `columnId` is actually drawn. The same column when that column is
 * plain or is a lane whose rule reaches the card; the fallback column when the card's own bucket is
 * a lane that will not have it; `null` when nothing draws it at all.
 *
 * `get_card` and `get_board` would otherwise disagree about such a card — one reading `status`, the
 * other reading the board — and one server giving two answers about one card is worse than either.
 */
export function drawnInColumn(
  board: Board,
  columnId: string,
  path: string,
  ctx: MatchContext,
): string | null {
  const column = board.config.columns.find((c) => c.id === columnId);
  if (!column) return null;
  if (!column.filter) return column.id;
  return drawnPaths(board, column.id, ctx).includes(path)
    ? column.id
    : (fallbackColumnOf(board) ?? null);
}
