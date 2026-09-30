import type {
  Board,
  BoardConfig,
  Card,
  CardFrontmatter,
  SubItem,
  SubtaskRef,
  TodoLine,
} from "./types";
import { columnOf, columnTitle, findDoneColumn } from "./boardColumns";
import { nestedCards } from "./boardVisibility";
import { computeDropOrder } from "./cardOrder";
import { boardLinkResolver } from "./linkResolver";
import { makeTodoPath } from "./todoPath";

export interface CardMutation {
  /** The note to write. For an inline todo this is the note that OWNS the checklist line. */
  path: string;
  setFrontmatter?: Partial<CardFrontmatter>;
  /**
   * An inline todo's placement, written to its own `## Subtasks` line instead of to frontmatter:
   * the line's `[status:: …]` field (`null` clears it) and, when the move states one, its checkbox.
   * An absent `done` leaves the box exactly as the note has it. Mutually exclusive with
   * `setFrontmatter` — a checklist line has no frontmatter of its own. The line is named by the
   * reading the move was decided against, so the write refuses a position that has since become
   * another line; its `claim` is left out by a write that replaces the claim for a reason of its own
   * rather than in place of what it said (see {@link SubtaskRef.claim}).
   */
  setSubtaskStatus?: SubtaskRef & { status: string | null; done?: boolean };
  /**
   * Bring an inline todo's `[status:: …]` claim into step with its own checkbox, by the rule in
   * {@link claimInStep} — applied to the claim AND the box the note carries when this lands, not to
   * either as they read when the box was clicked. Both can move in between, and a rule answered
   * half from now and half from then is how an unticked line ends up claiming Done. Nothing is
   * written when the rule moves nothing, so a line that needs no follow-up is not rewritten at all.
   */
  syncClaim?: SubtaskRef & { doneColumn: string };
  /** Frontmatter keys to remove from `path` — how a subcard's own `status` claim is dropped. */
  unsetFrontmatter?: string[];
  /**
   * Checklist lines in OTHER notes to tick or untick along with this move: for each note, the
   * `[[link]]` targets of the lines that name the moved card (see {@link setSubcardDone}). Lines are
   * addressed by their link and never by a position, so a note edited in the meantime can at worst
   * receive no write — never one on somebody else's todo.
   */
  parentLines?: { path: string; links: string[]; done: boolean }[];
  /** History event text to append (timestamp added by the adapter). */
  history?: string;
}

/**
 * Move a checklist line of `parentPath` into `toColumnId`, or back home to wherever its card is
 * with `null`. This is the ONE write behind every way a todo changes column — the drag, the
 * context menu and the detail panel — so a todo cannot end up in a state one of them can produce
 * and another cannot read.
 *
 * The checkbox moves with it: landing in the done column checks the line, any other column unchecks
 * it. That keeps the two ways a todo can say "finished" from disagreeing, since a line sitting in
 * the done column reads as done whether or not anyone ticked its box. Coming home does not touch
 * the checkbox at all — it says where a todo shows, never whether the work is over.
 *
 * `line` is the reading the move was decided against, and nothing else names the line: not a
 * position looked up on `board`, which may have been reloaded onto a shifted note since the drag
 * started or the menu opened. The column being chosen replaces whatever the line claimed, so the
 * claim the write is held to is the one in that reading too.
 */
export function moveSubtask(
  board: Board,
  parentPath: string,
  line: TodoLine,
  toColumnId: string | null,
): CardMutation | null {
  if (!board.cards[parentPath]) return null;
  const home = columnOf(board, parentPath);
  // "The column my card is in" and "no claim of my own" name the same place, and only one of them
  // keeps naming it after the card moves. So a move that lands on the card's own column is written
  // as no claim at all: otherwise dragging a todo back onto its parent would leave a field pinning
  // it to that column, and the todo would pop out on its own the next time the card was dragged.
  const claimTo = toColumnId !== null && toColumnId === home ? null : toColumnId;
  // What the line LITERALLY says, unnormalised — including a value naming no column of this board
  // (a typo, or a column since renamed). The board graph ignores such a value, but the write path
  // must not: normalising it to "no claim" here would make the guard below skip the one write that
  // can clear it, leaving a field no interface could reach and the todo free to detach the day a
  // column with that id appears.
  const claim = line.status ?? null;
  const done = statedDone(board, toColumnId);
  if (claim === claimTo && (done === undefined || line.done === done)) {
    return null; // the line already says this
  }
  // A column chosen by hand replaces whatever the line claimed, so the write may only land on the
  // value it was chosen against: a claim somebody has moved in the meantime is theirs, and the
  // person who picked this column never saw it.
  const at = { ...lineRef(line), claim, status: claimTo };
  return {
    path: parentPath,
    // A move that states the checkbox replaces the box as well as the claim, so it is held to both.
    setSubtaskStatus: done === undefined ? at : { ...at, box: line.done, done },
    history: subtaskMoveHistory(
      board,
      line,
      lineStandsNow(board, parentPath, line, home),
      toColumnId ?? home,
    ),
  };
}

function subtaskMoveHistory(
  board: Board,
  line: TodoLine,
  from: string | null,
  to: string | null,
): string {
  return `Moved subtask "${line.text || "todo"}" from ${columnTitle(board.config, from ?? "\u2014")} to ${columnTitle(board.config, to ?? "\u2014")}`;
}

/**
 * The checkbox a move to `toColumnId` states: ticked in the done column, unticked anywhere else.
 *
 * Naming a column states a done-ness; sending a todo home (`null`) does not. In that second case the
 * checkbox is left out of the write entirely rather than written back to what we believe it
 * currently is — the board we are reading may be one reload behind the note, and a stale belief
 * would tick or untick the wrong way. Read from the column asked for, not the claim that lands:
 * dropping a finished todo on its card's Todo column reopens it, even though the claim is "none".
 */
function statedDone(board: Board, toColumnId: string | null): boolean | undefined {
  return toColumnId === null ? undefined : toColumnId === findDoneColumn(board.config.columns);
}

/**
 * Where the line stands today, for the history line to name. The board's own tile answers that
 * whenever the line being moved is the one the board drew — it knows about lanes, which no rule
 * here could work out. A reading the board no longer holds is of a line the board has not got,
 * and then the only honest answer is the one the line itself gives.
 */
function lineStandsNow(
  board: Board,
  parentPath: string,
  line: TodoLine,
  home: string | null,
): string | null {
  const drawn = board.cards[parentPath]?.subItems?.find((s) => s.index === line.index);
  return drawn !== undefined && sameLine(drawn, line)
    ? (columnOf(board, makeTodoPath(parentPath, line.index)) ?? home)
    : standsIn(board, line, home);
}

/** Where a checklist line sat and what it said — the part of a reading every write is held to. */
function lineRef(line: SubItem): SubtaskRef {
  return { index: line.index, text: line.text, occurrence: line.occurrence };
}

export function isTodoLine(line: SubItem): line is TodoLine {
  return line.kind === "todo";
}

/** Whether two readings of a checklist line say the same thing, position, words, box and claim. */
export function sameLine(a: SubItem, b: SubItem): boolean {
  return (
    a.index === b.index &&
    a.text === b.text &&
    a.occurrence === b.occurrence &&
    a.done === b.done &&
    a.status === b.status &&
    a.kind === b.kind
  );
}

/**
 * The column a checklist line stands in by its own reading — its claim, with the done column
 * winning once the line reads as finished, and its card's own column when it claims none this board
 * draws. The same rule `buildBoard` mints a todo tile by; used where there is no tile to ask,
 * because the line is one a caller read ahead of the board.
 */
function standsIn(board: Board, item: SubItem, home: string | null): string | null {
  const claim = item.status ?? null;
  if (claim === null || !board.config.columns.some((c) => c.id === claim)) return home;
  const doneCol = findDoneColumn(board.config.columns);
  return (item.done || claim === doneCol) && doneCol !== null ? doneCol : claim;
}

/**
 * The tile a lane's rule judges a checklist line by before `columnId` is written onto it: the one
 * the board already draws for that line — it can carry inline fields a rule reads — or else the
 * tile the line would be drawn as, standing there. The board's tile only answers for the line being
 * moved: a caller reading the note ahead of the board can be moving a line the board has at that
 * index under other words, and judging that one would refuse, or wave through, on somebody else's.
 *
 * The tile to be is minted exactly as `buildBoard` mints a placed todo, down to the parent's own
 * name and context, because a lane's rule reads those: judged instead against a bare stand-in, a
 * line whose parent sits in a context would be refused by the very lane that is about to draw it.
 * `null` when the board knows no such card to take them from.
 */
export function todoTile(
  board: Board,
  parentPath: string,
  line: TodoLine,
  columnId: string,
): Card | null {
  const path = makeTodoPath(parentPath, line.index);
  const drawn = board.cards[path];
  if (drawn && drawn.title === line.text) return drawn;
  const parent = board.cards[parentPath];
  if (!parent) return null;
  const card: Card = {
    path,
    basename: parent.basename,
    title: line.text,
    titleSource: "subtask",
    frontmatter: { status: columnId },
    childLinks: [],
    todoRef: { parentPath, line: { ...line, status: columnId } },
  };
  if (parent.context !== undefined) card.context = parent.context;
  return card;
}

/**
 * The checklist line the board read at that position, whole — a write names a line by what it said
 * as well as where it sat, and a claim is decided from what the line itself carries. `null` when
 * this board knows no such line, which is already the answer to "is what was clicked still there".
 */
export function subtaskRef(board: Board, parentPath: string, index: number): SubItem | null {
  return board.cards[parentPath]?.subItems?.find((s) => s.index === index) ?? null;
}

/**
 * Where a checklist line's `[status:: …]` claim belongs, given the box on that same line.
 *
 * A checked box says the work is finished, and finished work belongs in the done column — so a line
 * that claims a column has its claim moved there rather than left saying something the board no
 * longer renders. An unchecked one claiming done drops the claim instead of inventing a column
 * nobody chose: the todo goes back to living with its card, which is where it started. A line
 * claiming nothing is left alone — ticking a plain todo has never placed it anywhere and must not
 * start now — and so is every line on a board with no done column, where "finished work belongs in
 * the done column" names nowhere.
 *
 * Both halves come from the line as the note has it when the write is made, never from a reading
 * taken when a box was clicked: those can be minutes apart, and either half may have moved. Returns
 * the claim unchanged when there is nothing to move.
 */
export function claimInStep(
  claim: string | null,
  done: boolean,
  doneColumn: string | null,
): string | null {
  if (claim === null || doneColumn === null) return claim;
  if (done) return doneColumn;
  return claim === doneColumn ? null : claim;
}

/**
 * The follow-up write that keeps a placed todo's claim in step with its checkbox, or `null` when
 * this line can have nothing to keep in step whatever it claims.
 *
 * For a plain todo that write is {@link claimInStep} applied to the note itself: what the claim
 * should become depends on what it IS, and every caller's reading of that is older than the write —
 * so the rule travels to the write and is answered there, rather than an answer settled here
 * travelling to a line that has moved on. For a line naming a child note the claim lives in the
 * child's own frontmatter, and that write is decided here, from the board.
 *
 * `line` is the checklist line as the CALLER read it, whole — the panel's own reading of the note,
 * the tool's, or the board's when it is the board that was clicked. Every one of them reads it
 * through `parseSubtasks`, so which branch it takes below is the note's own answer to "is this line
 * a todo or a link to a card", never a caller's guess at it. The board is asked only what it alone
 * knows — which column means finished, and where a linked child currently stands.
 */
export function syncSubtaskClaim(
  board: Board,
  parentPath: string,
  line: SubItem,
  done: boolean,
): CardMutation | null {
  const doneCol = findDoneColumn(board.config.columns);
  if (done && doneCol === null) return null; // nowhere to move the claim to; leave the line's own
  if (line.kind === "card") return syncChildClaim(board, parentPath, line, done);
  // With no done column, `claimInStep` moves nothing whatever the line says, so there is nothing to
  // ask the note. Every other case goes to the note as the rule it is: neither the claim the caller
  // read nor the box it just asked for is consulted here, because by the time this is written the
  // note is the only thing that knows either — and an answer taken half from that reading and half
  // from the note is how a line ends up with a box and a claim telling different stories.
  if (doneCol === null) return null;
  return { path: parentPath, syncClaim: { ...lineRef(line), doneColumn: doneCol } };
}

/**
 * The same rule, for a line that names a file: its claim is the child note's own `status`.
 * Ticking sends a child that stands somewhere to Done; unticking one in Done drops its
 * `status` so it rejoins its card; a child claiming nothing is left where it is.
 */
function syncChildClaim(
  board: Board,
  parentPath: string,
  line: SubItem,
  done: boolean,
): CardMutation | null {
  const doneCol = findDoneColumn(board.config.columns);
  const child = linkedChild(board, parentPath, line);
  if (child === null) return null;
  const moving = done ? child.status !== doneCol && doneCol !== null : child.status === doneCol;
  if (!moving) return null;
  // The clicked note's own box was just written by the caller; any other card listing the
  // same child follows along, as it would had the child's tile been dragged.
  // The child's note records it as the move it is, in the words a drag would leave.
  const from = columnTitle(board.config, child.status);
  const mutation: CardMutation = done
    ? {
        path: child.path,
        setFrontmatter: { status: doneCol ?? "" },
        history: `Moved from ${from} to ${columnTitle(board.config, doneCol ?? "")}`,
      }
    : {
        path: child.path,
        unsetFrontmatter: ["status"],
        history: `Moved from ${from} to ${columnTitle(board.config, columnOf(board, parentPath) ?? "\u2014")}`,
      };
  const parentLines = parentLinesOf(board, child.path, done, parentPath);
  if (parentLines.length > 0) mutation.parentLines = parentLines;
  return mutation;
}

/**
 * The card a checklist line links, with the column it claims, or `null` when there is nothing to
 * move. This writes into ANOTHER note, so a position alone is not enough to name it: the caller
 * says which `[[link]]` it showed the person, and a line that no longer carries that link (the
 * note was edited under the open panel) gets no write rather than a wrong one.
 */
function linkedChild(
  board: Board,
  parentPath: string,
  line: SubItem,
): { path: string; status: string } | null {
  const { index, link } = line;
  const item = board.cards[parentPath]?.subItems?.find((s) => s.index === index);
  if (!item) return null;
  if (link === undefined || item.link !== link) return null;
  const child = boardLinkResolver(board, parentPath)(link);
  const status = child === null ? undefined : board.cards[child]?.frontmatter.status;
  if (child === null || status === undefined) return null;
  return { path: child, status };
}

/**
 * The checklist lines, in every card on the board, that name `childPath` and do not already say
 * `done` — what a subcard reaching or leaving the done column must tick or untick so its parent
 * tells the same story an inline todo would. Every card that links the child is included, not
 * only the one `parentOf` picked: the child's progress is a fact about the child, and each of
 * those cards counts the line in its own progress bar. `except` skips a note already written by
 * the caller.
 */
function parentLinesOf(
  board: Board,
  childPath: string,
  done: boolean,
  except?: string,
): NonNullable<CardMutation["parentLines"]> {
  const out: NonNullable<CardMutation["parentLines"]> = [];
  for (const c of Object.values(board.cards)) {
    if (c.todoRef || c.path === childPath || c.path === except) continue;
    // Each note's own links, read from that note: which card `[[A]]` names depends on where it is
    // written, so a resolver bound to one card cannot answer for another's checklist.
    const resolve = boardLinkResolver(board, c.path);
    const links = (c.subItems ?? [])
      .filter(
        (s): s is typeof s & { link: string } =>
          s.kind === "card" &&
          s.link !== undefined &&
          s.done !== done &&
          resolve(s.link) === childPath,
      )
      .map((s) => s.link);
    if (links.length > 0) out.push({ path: c.path, links, done });
  }
  return out;
}

/**
 * The write that keeps the `- [ ] [[Child]]` lines naming `childPath` in step with the column it
 * is being sent to: landing in the done column ticks them, any other column unticks them — the
 * rule {@link moveSubtask} applies to an inline todo's own checkbox. `null` when nothing needs to
 * change, or when the board has no done column and so no column means "finished".
 */
export function syncSubcardLines(
  board: Board,
  childPath: string,
  toColumnId: string,
): CardMutation | null {
  const doneCol = findDoneColumn(board.config.columns);
  if (doneCol === null) return null;
  const parentLines = parentLinesOf(board, childPath, toColumnId === doneCol);
  return parentLines.length === 0 ? null : { path: childPath, parentLines };
}

/**
 * The history-free mutation that reassigns `path` to `toColumnId` — what a column being deleted
 * needs for the cards it leaves behind. Routed through here rather than a direct frontmatter write
 * so an inline todo stranded in that column is rehomed on its own line instead of being handed a
 * synthetic path no file answers to.
 */
export function reassignColumn(
  board: Board,
  path: string,
  toColumnId: string,
): CardMutation | null {
  const card = board.cards[path];
  if (!card) return null;
  const todoRef = card.todoRef;
  if (!todoRef) return { path, setFrontmatter: { status: toColumnId } };
  // The checkbox is left out: a column going away rehomes what it held, it does not decide that the
  // work in it is finished or unfinished. Stating one here would reopen a ticked line every time
  // someone deleted the done column, in their own note, with nothing to undo it.
  return {
    path: todoRef.parentPath,
    // No claim is stated: this write does not replace a value it was chosen against, it rehomes a
    // line out of a column that is going away, and a checked line stands in Done whatever it claims
    // — so the claim the board read there is not the value this is about. Holding the write to it
    // would refuse the rehoming of a line whose claim moved, and leave that line claiming a column
    // that no longer exists once the delete goes through, with nothing left to repeat the edit on.
    setSubtaskStatus: { ...lineRef(todoRef.line), status: toColumnId },
  };
}

/**
 * Move/reorder a card to `toColumnId` at `dropIndex`. Returns the single mutation to apply
 * (status + fractional order + a history line). Pure: does not mutate the board.
 *
 * `moved` is the card as the caller read it when the action started — the tile that was picked
 * up, not a path looked up again here. For a note that is only its identity; for a checklist line
 * standing in a column of its own it is the reading the move is held to, since `board` may have
 * been reloaded onto a note where that tile's position now names another line.
 */
export function moveCard(
  board: Board,
  moved: Card,
  toColumnId: string,
  dropIndex: number,
): CardMutation | null {
  const todoRef = moved.todoRef;
  if (todoRef) return moveSubtask(board, todoRef.parentPath, todoRef.line, toColumnId);
  const cardPath = moved.path;
  const card = board.cards[cardPath];
  if (!card) return null;
  const fromStatus = String(card.frontmatter.status ?? "");
  const mutation: CardMutation = {
    path: cardPath,
    history: moveHistory(board.config, fromStatus, toColumnId),
  };
  // Dropped back on the slot it already holds, the card keeps the order it has: a fresh number for
  // the same place would be a write that changes nothing anyone can see. The same goes for a card
  // drawn inside its parent in that column, which its parent orders rather than any number.
  if (fromStatus !== toColumnId || !holdsSlot(board, cardPath, toColumnId, dropIndex)) {
    const order = computeDropOrder(othersIn(board, toColumnId, cardPath), dropIndex);
    mutation.setFrontmatter = { status: toColumnId, order };
  }
  // The checkbox follows what the tile did: a card with no `status`, or one naming a column since
  // removed, renders in the first column, and a drop there says nothing about finishing — unless
  // that column is Done, where landing is the statement whatever the tile did before.
  const doneCol = findDoneColumn(board.config.columns);
  if (toColumnId !== doneCol && columnOf(board, cardPath) === toColumnId) return mutation;
  const parentLines = syncSubcardLines(board, cardPath, toColumnId)?.parentLines;
  if (parentLines) mutation.parentLines = parentLines;
  return mutation;
}

/**
 * The history line records what the note said: a `status` naming no column of this board is a
 * real change when it is overwritten, even though the tile did not visibly move.
 */
function moveHistory(config: BoardConfig, fromStatus: string, toColumnId: string): string {
  if (fromStatus === toColumnId) return `Reordered within ${columnTitle(config, toColumnId)}`;
  return `Moved from ${columnTitle(config, fromStatus || "—")} to ${columnTitle(config, toColumnId)}`;
}

/** The cards of `columnId` a card dropped there lands among: every one but itself. */
function othersIn(board: Board, columnId: string, cardPath: string): Card[] {
  return (board.columns[columnId] ?? [])
    .filter((p) => p !== cardPath)
    .flatMap((p) => {
      const c = board.cards[p];
      return c !== undefined ? [c] : [];
    });
}

/** Whether `dropIndex` is the slot the card already holds in `columnId`, or its parent orders it there. */
function holdsSlot(board: Board, cardPath: string, columnId: string, dropIndex: number): boolean {
  const slot = (board.columns[columnId] ?? []).indexOf(cardPath);
  return slot === dropIndex || (slot < 0 && nestedCards(board).some((n) => n.path === cardPath));
}
