import type { Board } from "./types";
import type { MatchContext } from "./filter";
import { isDrawnSomewhere } from "./lanes";

/**
 * Every path reachable from `roots` by walking `board.childrenOf` (the same nested-subcard tree
 * `SubcardGroup` renders), roots included. Used by a column's "collapse all / expand all" so it
 * sets every descendant's state, not just the top-level cards — an "expand all" that stopped at
 * the top would leave a grandchild collapsed from an earlier individual toggle. Cycle-safe with
 * the same per-branch `seen` guard `SubcardGroup` uses.
 */
export function subtreePaths(board: Board, roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (path: string, seen: ReadonlySet<string>) => {
    out.push(path);
    for (const child of board.childrenOf[path] ?? []) {
      if (seen.has(child) || !board.cards[child]) continue;
      walk(child, new Set(seen).add(child));
    }
  };
  for (const root of roots) walk(root, new Set([root]));
  return out;
}

/**
 * Every card genuinely nested somewhere in the board that is NOT already surfacing as its own
 * column entry — a real top-level card, or one already lifted into a column of its own via
 * `placedOf` (see `buildBoard`). For each such subcard: the column it would render in if it stood
 * at the top level (its own effective column, walking up through non-placed ancestors exactly as
 * `buildBoard`'s own `effectiveColumnOf` does — `undefined` only for a board with no columns at
 * all) and the parent it is nested directly under.
 *
 * Exists so a filtered view (Column) can lift a matching subcard to the top level of that column
 * with a reference to its parent, instead of leaving it invisible under a parent that does not
 * match. Cycle-safe: `buildBoard` already treats every member of a subcard cycle as a top-level
 * card, so a cyclic chain always resolves through `columns` before this walk could loop — the
 * `seen` guard only protects against that invariant ever slipping.
 */
export interface NestedCard {
  path: string;
  column: string | undefined;
  parentPath: string;
}

export function nestedCards(board: Board): NestedCard[] {
  const columnOfPath: Record<string, string> = {};
  for (const [colId, paths] of Object.entries(board.columns)) {
    for (const p of paths) columnOfPath[p] = colId;
  }
  const effectiveColumnOf = (path: string): string | undefined => {
    let cur = path;
    const seen = new Set<string>();
    while (!(cur in columnOfPath)) {
      if (seen.has(cur)) return undefined;
      seen.add(cur);
      const parent = board.parentOf[cur];
      if (!parent) return undefined;
      cur = parent;
    }
    return columnOfPath[cur];
  };
  const out: NestedCard[] = [];
  for (const path of Object.keys(board.cards)) {
    if (path in columnOfPath) continue;
    const parentPath = board.parentOf[path];
    if (!parentPath) continue;
    out.push({ path, column: effectiveColumnOf(path), parentPath });
  }
  return out;
}

/** What the UI knows and the model cannot work out for itself, injected into `filterVisiblePaths`. */
export interface FilterVisibility {
  /** Does this card match the active filter on its own merits? */
  matches: (path: string) => boolean;
  /** Is this card drawing the group of subcards nested under it, or is it collapsed? */
  showsChildren: (path: string) => boolean;
  /** What a lane's rule is judged against — the same context the board draws with, so the tally
   *  and the columns can never disagree about whether a lane holds a card. */
  ctx: MatchContext;
}

/**
 * Every card path that renders SOMEWHERE on the board under the given rules. Column.tsx owns the
 * drawing and states the same rule again in its own terms — it needs a per-column lifted-parent map
 * this set cannot carry — so the two are a mirrored pair, not one shared implementation. The value
 * of restating it here is that a second consumer (today the toolbar's tally) can ask the question
 * without a DOM, and that the rule can be tested branch by branch. What keeps the pair honest is
 * `test/ui.test.tsx`, which asserts the tally against the tiles a real render produces; a change to
 * Column's lift that is not made here fails there.
 *
 * Branch for branch as Column has it:
 * - a card in some `board.columns` bucket renders there, EXCEPT in a filter-lane's bucket: a lane
 *   ignores its own bucket and pulls by its rule instead, so such a card renders only where some
 *   lane's rule actually reaches it (any lane, not just the one whose id its `status` names — every
 *   lane pulls from every bucket) or, when no lane reaches it at all, in the board's fallback
 *   column (`fallbackColumnOf`), which is what keeps such a card on the board;
 * - a genuinely nested, non-placed card (`nestedCards`) NESTS under its immediate parent when that
 *   parent matches, is itself visible, and is drawing its children;
 * - and is LIFTED to the top level of its inherited column when that parent does NOT match — the
 *   branches are exclusive, exactly as in Column, so a collapsed matching parent hides its child
 *   rather than quietly lifting it. The lift only reaches a PLAIN column, which is where Column
 *   stops too: a lane never shows a card its own rule has not vetted.
 */
export function filterVisiblePaths(board: Board, rules: FilterVisibility): Set<string> {
  const nestedByPath = new Map(nestedCards(board).map((n) => [n.path, n]));
  const laneColumnIds = board.config.columns.filter((c) => c.filter).map((c) => c.id);
  const laneColumnIdSet = new Set(laneColumnIds);
  const columnOfPath: Record<string, string> = {};
  for (const [colId, paths] of Object.entries(board.columns)) {
    for (const p of paths) columnOfPath[p] = colId;
  }
  // Asked of the model, not restated here: `isDrawnSomewhere` is the same rule the columns draw by,
  // including the fallback column and the lane rules this caller cannot evaluate.
  const drawnInItsBucket = (path: string): boolean => {
    const col = columnOfPath[path];
    if (col === undefined || !laneColumnIdSet.has(col)) return true;
    return isDrawnSomewhere(board, path, col, rules.ctx);
  };
  const memo = new Map<string, boolean>();
  const visible = (path: string): boolean => {
    const cached = memo.get(path);
    if (cached !== undefined) return cached;
    const n = nestedByPath.get(path);
    if (!n) return drawnInItsBucket(path);
    memo.set(path, false); // cycle guard while this path's own answer is being computed
    const parentMatches = rules.matches(n.parentPath);
    const nests = parentMatches && visible(n.parentPath) && rules.showsChildren(n.parentPath);
    const lifted = !parentMatches && n.column !== undefined && !laneColumnIdSet.has(n.column);
    const result = rules.matches(path) && (nests || lifted);
    memo.set(path, result);
    return result;
  };
  const out = new Set<string>();
  for (const path of Object.keys(board.cards)) if (visible(path)) out.add(path);
  return out;
}
