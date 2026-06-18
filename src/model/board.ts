// Pure board graph + drag reducer. No Obsidian dependency.
//
// Parentage has a single source of truth: a card is a subcard of P iff P's `## Subtasks`
// checklist links to it (`- [ ] [[Child]]`). We invert those links to derive parent-of and
// the top-level set. No `parent` frontmatter, so re-parenting is one write and can't desync.

import type { Board, BoardConfig, Card, CardFrontmatter, ColumnDef, ContextConfig } from "./types";

/**
 * The context (#14) a card belongs to, derived purely from its path: the immediate subfolder of
 * `cardFolder` it lives under. A card directly in `cardFolder` (no further `/` after the folder)
 * has no context → undefined. The single source of truth shared by every repo + the board build,
 * so derived context can never diverge between adapters.
 */
export function deriveContext(cardFolder: string, path: string): string | undefined {
  const prefix = cardFolder.replace(/\/+$/, "") + "/";
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined; // file sits directly in the card folder
  return rest.slice(0, slash);
}

/**
 * Resolve a wikilink target to a card path. Prefers an exact path when the link carries a
 * folder segment; otherwise matches by basename, but only when that basename is unambiguous
 * (duplicate basenames across folders resolve to nothing rather than silently binding the wrong one).
 */
function resolveLink(
  link: string,
  byBasename: Map<string, string[]>,
  byPath: Record<string, Card>,
): string | null {
  const noAnchor = link.split("#");
  const noAlias = (noAnchor[0] ?? link).split("|");
  const raw = (noAlias[0] ?? "").trim();
  if (raw.includes("/")) {
    const withMd = /\.md$/i.test(raw) ? raw : raw + ".md";
    if (byPath[withMd]) return withMd;
  }
  const segments = raw.split("/");
  const last = segments[segments.length - 1];
  const base = (last ?? raw).replace(/\.md$/i, "").trim();
  const paths = byBasename.get(base);
  return paths !== undefined && paths.length === 1 ? (paths[0] ?? null) : null;
}

function orderOf(c: Card): number | null {
  const o = c.frontmatter.order;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
}

/**
 * Merge ordered + unordered cards into one stable sequence.
 * Cards with an explicit numeric `order` sort by it. Cards without one are appended after all
 * ordered cards (alphabetically), each with a strictly-distinct effective order BEYOND the max
 * real order — so a synthetic position can never collide with a real `order` value (a collision
 * would make `computeDropOrder` return a duplicate rank and a drop land in the wrong place).
 */
export function columnEffectiveOrders(cards: Card[]): { card: Card; eff: number }[] {
  const ordered = cards
    .filter((c) => orderOf(c) !== null)
    .map((c) => {
      const eff = orderOf(c);
      if (eff === null) throw new Error("invariant: filtered null order");
      return { card: c, eff };
    })
    .sort((a, b) => a.eff - b.eff || a.card.basename.localeCompare(b.card.basename));
  const lastOrdered = ordered[ordered.length - 1];
  const maxEff = lastOrdered !== undefined ? lastOrdered.eff : -1;
  const unordered = cards
    .filter((c) => orderOf(c) === null)
    .sort((a, b) => a.basename.localeCompare(b.basename))
    .map((c, i) => ({ card: c, eff: maxEff + 1 + i }));
  return [...ordered, ...unordered];
}

/**
 * True when a card is genuinely nested: walking its parent chain bottoms out at a parentless
 * top-level root. A chain that loops (mutual / cyclic subcard links) returns false, so cycle
 * members are surfaced as top-level cards instead of silently vanishing from every column.
 */
function isGenuinelyNested(path: string, parentOf: Record<string, string>): boolean {
  let cur: string | undefined = parentOf[path];
  if (!cur) return false;
  const seen = new Set<string>([path]);
  while (cur) {
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = parentOf[cur];
  }
  return true;
}

export function buildBoard(
  config: BoardConfig,
  cards: Card[],
  contexts: Record<string, ContextConfig> = {},
): Board {
  // Derive each card's context from its path (#14): one place, so every card on the board carries
  // the same notion of context the `context:` filter token reads. Path-derived, never written.
  for (const c of cards) {
    const ctx = deriveContext(config.cardFolder, c.path);
    if (ctx !== undefined) c.context = ctx;
  }

  const byBasename = new Map<string, string[]>();
  for (const c of cards) {
    const arr = byBasename.get(c.basename);
    if (arr) arr.push(c.path);
    else byBasename.set(c.basename, [c.path]);
  }

  const cardsByPath: Record<string, Card> = {};
  for (const c of cards) cardsByPath[c.path] = c;

  const parentOf: Record<string, string> = {};
  for (const c of cards) {
    for (const link of c.childLinks) {
      const childPath = resolveLink(link, byBasename, cardsByPath);
      if (childPath && childPath !== c.path && !parentOf[childPath]) {
        parentOf[childPath] = c.path;
      }
    }
  }

  const colIds = new Set(config.columns.map((c) => c.id));
  const firstCol = config.columns[0]?.id;
  const groups: Record<string, Card[]> = {};
  for (const col of config.columns) groups[col.id] = [];
  for (const c of cards) {
    if (isGenuinelyNested(c.path, parentOf)) continue; // real subcards are not on the board top level
    const st = String(c.frontmatter.status ?? "");
    const target = colIds.has(st) ? st : firstCol;
    if (target) {
      const bucket = groups[target];
      if (bucket) bucket.push(c);
    }
  }

  const columns: Record<string, string[]> = {};
  for (const col of config.columns) {
    columns[col.id] = columnEffectiveOrders(groups[col.id] ?? []).map((x) => x.card.path);
  }

  // Inverse of parentOf, but ONLY for genuinely-nested children — so a card in an A<->B cycle
  // (which parentOf links both ways) is excluded here. That keeps childrenOf a forest: cycle
  // members surface only as top-level cards, never doubly as a nested child of each other.
  const childGroups: Record<string, Card[]> = {};
  for (const c of cards) {
    const parent = parentOf[c.path];
    if (!parent || !isGenuinelyNested(c.path, parentOf)) continue;
    (childGroups[parent] ??= []).push(c);
  }
  const childrenOf: Record<string, string[]> = {};
  for (const parent in childGroups) {
    childrenOf[parent] = columnEffectiveOrders(childGroups[parent] ?? []).map((x) => x.card.path);
  }

  return { config, columns, cards: cardsByPath, parentOf, childrenOf, contexts };
}

// ---------------------------------------------------------------------------
// Drag reducer
// ---------------------------------------------------------------------------

// A card can be placed in more than one column at once: its status column AND any cross-board lane
// (#1) whose filter it matches. dnd-kit keys draggables/droppables by id, so two placements sharing a
// bare `card.path` would collide (last-writer-wins, non-deterministic). We therefore give each
// PLACEMENT a unique sortable id, namespaced by the column it renders in: `${columnId}::${card.path}`.
// The separator is the first `::` only — a card path may itself contain `::`, a column id cannot
// (column ids come from frontmatter keys / titleCase and never include it).
const CARD_DRAG_SEP = "::";

/** Build the per-placement sortable id for a card rendered in `columnId`. */
export function makeCardDragId(columnId: string, path: string): string {
  return columnId + CARD_DRAG_SEP + path;
}

/**
 * Parse a per-placement card sortable id back into its column + real card path. Splits on the FIRST
 * `::` so a path containing `::` survives intact. An un-namespaced id (no separator — e.g. a legacy
 * or column id passed by mistake) yields an empty `columnId` and the whole string as `path`.
 */
export function splitCardDragId(id: string): { columnId: string; path: string } {
  const i = id.indexOf(CARD_DRAG_SEP);
  if (i < 0) return { columnId: "", path: id };
  return { columnId: id.slice(0, i), path: id.slice(i + CARD_DRAG_SEP.length) };
}

function between(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (prev !== null) return prev + 1;
  if (next !== null) return next - 1;
  return 0;
}

/** New fractional order for a card dropped at `dropIndex` among `colCards` (moving card excluded). */
export function computeDropOrder(colCards: Card[], dropIndex: number): number {
  const eff = columnEffectiveOrders(colCards).map((x) => x.eff);
  const prev = dropIndex > 0 ? (eff[dropIndex - 1] ?? null) : null;
  const next = dropIndex < eff.length ? (eff[dropIndex] ?? null) : null;
  return between(prev, next);
}

export interface CardMutation {
  path: string;
  setFrontmatter?: Partial<CardFrontmatter>;
  /** History event text to append (timestamp added by the adapter). */
  history?: string;
}

function columnTitle(config: BoardConfig, id: string): string {
  return config.columns.find((c) => c.id === id)?.title ?? id;
}

/**
 * Reorder columns by moving the column `activeId` to the slot currently held by `overId`.
 * Pure: returns a new array, leaving the input untouched. A drop onto itself, an unknown id,
 * or a no-op move returns the original order (referentially the same array when nothing moves).
 * Drives the header drag-reorder (#2); the menu's step-wise move stays a separate path.
 */
export function moveColumn(columns: ColumnDef[], activeId: string, overId: string): ColumnDef[] {
  if (activeId === overId) return columns;
  const from = columns.findIndex((c) => c.id === activeId);
  const to = columns.findIndex((c) => c.id === overId);
  if (from < 0 || to < 0 || from === to) return columns;
  const next = columns.slice();
  const spliced = next.splice(from, 1);
  const moved = spliced[0];
  if (moved === undefined) return columns;
  next.splice(to, 0, moved);
  return next;
}

/** A column renders its cards in a COMPUTED order when it groups or sorts non-manually (#6). Manual
 *  in-column drag-reorder is a no-op there (the order is recomputed every render). */
export function isComputedOrder(board: Board, columnId: string): boolean {
  const col = board.config.columns.find((c) => c.id === columnId);
  if (!col) return false;
  return (col.group ?? "none") !== "none" || (col.sort ?? "manual") !== "manual";
}

/** What a dnd-kit drop should do, after parsing namespaced card ids and applying the drag rules. */
export type DropPlan =
  | { kind: "reorderColumns"; activeId: string; overId: string }
  | { kind: "moveCard"; path: string; overId: string }
  | { kind: "noop" };

/**
 * Decide what a finished drag should do. Pure + UI-free so the rules are unit-testable.
 *
 * Card sortables are namespaced `${columnId}::${card.path}` (#2) so a card placed in both its status
 * column and a cross-board lane (#1) never collides on a single dnd-kit id. This unwraps the active +
 * over ids back to bare ids and routes:
 *  - a bare COLUMN active id → column reorder (#2 header drag);
 *  - a same-column card drop onto a COMPUTED-order column → no-op (#3: manual reorder is meaningless
 *    when the order is grouped/sorted; cross-column moves still flow through);
 *  - otherwise → a card move, with the real path + the real (un-namespaced) over id for resolveDrop.
 */
export function planDrop(
  board: Board,
  rawActiveId: string,
  rawOverId: string,
  columnIds: string[],
): DropPlan {
  if (columnIds.includes(rawActiveId)) {
    return { kind: "reorderColumns", activeId: rawActiveId, overId: rawOverId };
  }
  const { columnId: fromColumn, path: activePath } = splitCardDragId(rawActiveId);
  const overIsColumn = columnIds.includes(rawOverId);
  const over = overIsColumn ? null : splitCardDragId(rawOverId);
  const toColumn = overIsColumn ? rawOverId : (over?.columnId ?? "");
  const realOver = overIsColumn ? rawOverId : (over?.path ?? rawOverId);
  if (toColumn === fromColumn && isComputedOrder(board, toColumn)) {
    return { kind: "noop" };
  }
  return { kind: "moveCard", path: activePath, overId: realOver };
}

/** Column id that currently contains `path`, or null. */
export function columnOf(board: Board, path: string): string | null {
  for (const col of board.config.columns) {
    if (board.columns[col.id]?.includes(path)) return col.id;
  }
  return null;
}

/**
 * Translate a dnd-kit drop (active card id, the id it was dropped over) into a target
 * column + insertion index among that column's cards with the active card removed.
 * `overId` may be a column id (dropped on the column body) or a card path (dropped on a card,
 * inserting before it). Pure and testable.
 */
export function resolveDrop(
  board: Board,
  activeId: string,
  overId: string,
): { columnId: string; index: number } | null {
  if (!board.cards[activeId]) return null;
  if (board.columns[overId]) {
    const list = board.columns[overId].filter((p) => p !== activeId);
    return { columnId: overId, index: list.length };
  }
  const columnId = columnOf(board, overId);
  if (!columnId) return null;
  const list = (board.columns[columnId] ?? []).filter((p) => p !== activeId);
  const idx = list.indexOf(overId);
  return { columnId, index: idx === -1 ? list.length : idx };
}

/**
 * Move/reorder a card to `toColumnId` at `dropIndex`. Returns the single mutation to apply
 * (status + fractional order + a history line). Pure: does not mutate the board.
 */
export function moveCard(
  board: Board,
  cardPath: string,
  toColumnId: string,
  dropIndex: number,
): CardMutation | null {
  const card = board.cards[cardPath];
  if (!card) return null;
  const fromStatus = String(card.frontmatter.status ?? "");
  const colCards = (board.columns[toColumnId] ?? [])
    .filter((p) => p !== cardPath)
    .flatMap((p) => {
      const c = board.cards[p];
      return c !== undefined ? [c] : [];
    });
  const order = computeDropOrder(colCards, dropIndex);
  const history =
    fromStatus === toColumnId
      ? `Reordered within ${columnTitle(board.config, toColumnId)}`
      : `Moved from ${columnTitle(board.config, fromStatus || "—")} to ${columnTitle(board.config, toColumnId)}`;
  return { path: cardPath, setFrontmatter: { status: toColumnId, order }, history };
}
