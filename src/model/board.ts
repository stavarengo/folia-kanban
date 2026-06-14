// Pure board graph + drag reducer. No Obsidian dependency.
//
// Parentage has a single source of truth: a card is a subcard of P iff P's `## Subtasks`
// checklist links to it (`- [ ] [[Child]]`). We invert those links to derive parent-of and
// the top-level set. No `parent` frontmatter, so re-parenting is one write and can't desync.

import type { Board, BoardConfig, Card, CardFrontmatter } from "./types";

/** Resolve a wikilink target to a card path by basename. */
function resolveLink(link: string, byBasename: Map<string, string>): string | null {
  const base = link.split("/").pop()!.replace(/\.md$/i, "").split("#")[0].split("|")[0].trim();
  return byBasename.get(base) ?? null;
}

function orderOf(c: Card): number | null {
  const o = c.frontmatter.order;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
}

/**
 * Merge ordered + unordered cards into one stable sequence.
 * Cards with an explicit numeric `order` sort by it; cards without get an effective order
 * equal to their alphabetical index, so a card that later receives a fractional order
 * interleaves correctly while every other card stays untouched on disk.
 */
export function columnEffectiveOrders(cards: Card[]): { card: Card; eff: number }[] {
  const ordered = cards.filter((c) => orderOf(c) !== null).map((c) => ({ card: c, eff: orderOf(c)! }));
  const unordered = cards
    .filter((c) => orderOf(c) === null)
    .sort((a, b) => a.basename.localeCompare(b.basename))
    .map((c, i) => ({ card: c, eff: i }));
  return [...ordered, ...unordered].sort(
    (a, b) => a.eff - b.eff || a.card.basename.localeCompare(b.card.basename),
  );
}

export function buildBoard(config: BoardConfig, cards: Card[]): Board {
  const byBasename = new Map<string, string>();
  for (const c of cards) byBasename.set(c.basename, c.path);

  const cardsByPath: Record<string, Card> = {};
  for (const c of cards) cardsByPath[c.path] = c;

  const parentOf: Record<string, string> = {};
  for (const c of cards) {
    for (const link of c.childLinks) {
      const childPath = resolveLink(link, byBasename);
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
    if (parentOf[c.path]) continue; // subcards are not on the board top level
    const st = String(c.frontmatter.status ?? "");
    const target = colIds.has(st) ? st : firstCol;
    if (target) groups[target].push(c);
  }

  const columns: Record<string, string[]> = {};
  for (const col of config.columns) {
    columns[col.id] = columnEffectiveOrders(groups[col.id]).map((x) => x.card.path);
  }

  return { config, columns, cards: cardsByPath, parentOf };
}

/** Child card paths of a card, in checklist order, existing-only. */
export function childPaths(board: Board, path: string): string[] {
  const card = board.cards[path];
  if (!card) return [];
  const byBasename = new Map<string, string>();
  for (const p in board.cards) byBasename.set(board.cards[p].basename, p);
  const out: string[] = [];
  for (const link of card.childLinks) {
    const child = resolveLink(link, byBasename);
    if (child && child !== path) out.push(child);
  }
  return out;
}

/** Cycle-safe depth-first collection of a card and all its descendants. */
export function subtreePaths(board: Board, path: string, visited = new Set<string>()): string[] {
  if (visited.has(path)) return [];
  visited.add(path);
  const out = [path];
  for (const child of childPaths(board, path)) {
    out.push(...subtreePaths(board, child, visited));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drag reducer
// ---------------------------------------------------------------------------

function between(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (prev !== null) return prev + 1;
  if (next !== null) return next - 1;
  return 0;
}

/** New fractional order for a card dropped at `dropIndex` among `colCards` (moving card excluded). */
export function computeDropOrder(colCards: Card[], dropIndex: number): number {
  const eff = columnEffectiveOrders(colCards).map((x) => x.eff);
  const prev = dropIndex > 0 ? eff[dropIndex - 1] ?? null : null;
  const next = dropIndex < eff.length ? eff[dropIndex] ?? null : null;
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
  const list = board.columns[columnId].filter((p) => p !== activeId);
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
    .map((p) => board.cards[p]);
  const order = computeDropOrder(colCards, dropIndex);
  const history =
    fromStatus === toColumnId
      ? `Reordered within ${columnTitle(board.config, toColumnId)}`
      : `Moved from ${columnTitle(board.config, fromStatus || "—")} to ${columnTitle(board.config, toColumnId)}`;
  return { path: cardPath, setFrontmatter: { status: toColumnId, order }, history };
}
