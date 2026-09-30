import { useMemo } from "react";
import type { Board, ColumnDef } from "../model/types";
import { makeCardDragId, nestedCards, splitCardDragId, type DragReloc } from "../model/board";
import { isEmptyFilter, matchCard, parseFilter, type Filter } from "../model/filter";
import { drawnPaths, fallbackColumnOf, laneFill, takesNewCards } from "../model/lanes";
import { describeFill, groupAndSortCards } from "./cardView";
import { useBoardActions, useMatchContext } from "./context";

/** What one column draws, counts and lets be dragged, under the board's search and a live drag. */
export function useColumnCards({
  column,
  cardPaths,
  board,
  filter,
  today,
  doneColumnId,
  dragReloc,
}: {
  column: ColumnDef;
  cardPaths: string[];
  board: Board;
  filter: Filter;
  today: string;
  doneColumnId: string | null;
  dragReloc: DragReloc | undefined;
}) {
  const actions = useBoardActions();
  const matchCtx = useMatchContext();
  // #9: the global search is the single source of truth — a parsed §1 Filter (empty = no filtering).
  const globalFiltering = !isEmptyFilter(filter);
  const columnFilter = column.filter ? parseFilter(column.filter) : null;
  // A lane takes an added card only when the card can carry what its rule asks for; elsewhere the
  // add control would only ever lead to a refusal, so the lane says how it fills instead.
  const { takesAdds, fillNote } = useMemo(
    () => ({
      takesAdds: takesNewCards(board, column.id, matchCtx),
      fillNote: describeFill(laneFill(board, column.id, matchCtx)),
    }),
    [board, column.id, matchCtx],
  );
  const lanePaths = useLanePaths({
    column,
    cardPaths,
    board,
    isLane: columnFilter != null,
    dragReloc,
  });

  // The rendered set additionally ANDs the global search filter (parsed §1 Filter) on top of the
  // lane — net per column: (lane-pull OR status-bucket) AND (empty global OR global matchCard).
  let paths = lanePaths;
  if (globalFiltering)
    paths = paths.filter((p) => {
      const c = board.cards[p];
      return c != null && matchCard(c, filter, matchCtx);
    });

  // `board` is the only input `nestedCards` reads — memoized here so a keystroke in the search box
  // (which changes `filter`, not `board`) rebuilds the whole-board column index once per board
  // rather than once per column per render. The toolbar's tally still rebuilds its own copy per
  // keystroke inside `filterVisiblePaths`; that is one pass over the board for the whole toolbar,
  // against one per column here, which is what this memo is worth.
  const boardNestedCards = useMemo(() => nestedCards(board), [board]);
  // Scoped to a PLAIN column (`columnFilter == null`) on purpose: a filter-lane pulls its population
  // by its own rule against top-level cards only (`topLevelPaths` above) — it has never reached into
  // `childrenOf` — and lifting into it here would show a nested card the lane's own rule never
  // vetted, just because it happens to inherit the lane's column id. That is a bigger feature (lanes
  // reading nested cards) than this fix; a plain column's inherited-column lift is unaffected.
  const liftedParentOf: Record<string, string> =
    globalFiltering && !columnFilter
      ? liftedInto(column.id, board, boardNestedCards, (p) => {
          const c = board.cards[p];
          return c != null && matchCard(c, filter, matchCtx);
        })
      : {};
  if (Object.keys(liftedParentOf).length > 0) paths = [...paths, ...Object.keys(liftedParentOf)];
  const liftedPaths = new Set(Object.keys(liftedParentOf));

  // #6 — group + sort the rendered cards. Defaults (none/manual) yield a single unlabeled group
  // holding the cards in board order, so an un-configured column renders exactly as before.
  const groups = groupAndSortCards(
    paths.flatMap((p) => {
      const c = board.cards[p];
      return c ? [c] : [];
    }),
    {
      group: column.group ?? "none",
      sort: column.sort ?? "manual",
      today,
      doneColumnId,
      priorities: actions.priorities,
      scale: actions.priorityScale,
    },
  );

  return {
    globalFiltering,
    filtering: globalFiltering || columnFilter != null,
    takesAdds,
    fillNote,
    paths,
    // Count + WIP reflect the lane's matched cards for a filter-lane (#1.4), the status bucket
    // otherwise — deliberately not the tiles on screen. The badge answers "how much work is in this
    // column", which no search should change: a lifted subcard is a visitor the filter put here for
    // as long as the filter lasts, and counting it would let typing in the search box trip a WIP
    // limit. Under a filter, then, the badge can read lower than the number of tiles, the same way
    // it has always been able to read higher.
    count: lanePaths.length,
    liftedParentOf,
    liftedPaths,
    groups,
    dragIdFor: dragIdsFor(column.id, dragReloc),
  };
}

/**
 * What this column draws before the search: `drawnPaths`, the model's one definition of column
 * membership. A lane pulls every card standing in a column that its rule matches, wherever that
 * card lives, and ignores its own status bucket; a plain column draws its own bucket plus, in the
 * board's first plain column, any card whose `status` names a lane that will not draw it — which
 * would otherwise be on screen nowhere.
 *
 * A plain column takes that bucket from `cardPaths` rather than from the model, because a
 * cross-column drag in flight shows the dragged card already moved in (`applyReloc` in Board) and
 * the model reads the board as saved. The lane pull and the stranded fallback are unaffected by a
 * drag preview, so they come straight from the model. Memoized: a lane walks every bucket, and a
 * keystroke in the search box must not pay for that.
 */
function useLanePaths({
  column,
  cardPaths,
  board,
  isLane,
  dragReloc,
}: {
  column: ColumnDef;
  cardPaths: string[];
  board: Board;
  isLane: boolean;
  dragReloc: DragReloc | undefined;
}): string[] {
  const matchCtx = useMatchContext();
  // Only a lane and the fallback column are ever given cards from outside their own bucket, so no
  // other column asks the model at all — for them the bucket the prop carries IS the answer.
  const isFallback = !isLane && fallbackColumnOf(board) === column.id;
  const asksTheModel = isLane || isFallback;
  const modelPaths = useMemo(
    () => (asksTheModel ? drawnPaths(board, column.id, matchCtx) : []),
    [asksTheModel, board, column.id, matchCtx],
  );
  const ownPaths = cardPaths.filter((p) => board.cards[p]);
  // A lane's whole population is the model's answer. A plain column keeps the bucket the prop
  // carries — that is the one a drag in flight shows relocated — and the fallback column adds the
  // cards the model gives it from outside that bucket.
  // A stranded card is never in this column's bucket, so `applyReloc` cannot take it out for the
  // duration of a drag the way it does for an ordinary card. Dropping it here by hand is what keeps
  // one card from rendering in two columns at once under one sortable id.
  const draggingPath = dragReloc ? splitCardDragId(dragReloc.activeId).path : null;
  const stranded = useMemo(() => {
    if (!isFallback) return [];
    const own = new Set(board.columns[column.id] ?? []);
    return modelPaths.filter((p) => !own.has(p) && p !== draggingPath);
  }, [board, column.id, isFallback, modelPaths, draggingPath]);
  if (isLane) return modelPaths;
  return stranded.length ? [...ownPaths, ...stranded] : ownPaths;
}

/**
 * A genuinely-nested subcard matches the global filter on its own merits, at any depth. When its
 * immediate parent does NOT also match, nesting it below that parent would leave it invisible
 * (SubcardGroup only renders children that themselves match) — so it is lifted to the top level of
 * the column it would otherwise inherit, carrying a "part of <parent>" reference: the same
 * reference an explicitly-placed subitem already shows (`board.placedOf`). A parent that DOES match
 * keeps the child nested, filtered by SubcardGroup exactly as before. Keyed by the lifted path, to
 * its parent.
 */
function liftedInto(
  columnId: string,
  board: Board,
  nested: ReturnType<typeof nestedCards>,
  matches: (path: string) => boolean,
): Record<string, string> {
  const lifted: Record<string, string> = {};
  for (const n of nested) {
    if (n.column !== columnId || !matches(n.path)) continue;
    if (board.cards[n.parentPath] && matches(n.parentPath)) continue; // stays nested below
    lifted[n.path] = n.parentPath;
  }
  return lifted;
}

/**
 * The sortable id for a card rendered in this column. Normally namespaced `col::path` (so a card
 * mirrored into a cross-board lane (#1) and its status column register two distinct,
 * non-colliding sortables). EXCEPTION: while a cross-column drag is open and lands the active card
 * here (this is its target), that one card keeps its ORIGINAL id (`dragReloc.activeId`, i.e. its
 * SOURCE-column namespacing) — so dnd-kit sees the same sortable identity before and after the
 * relocation and never unmounts the active item mid-drag (which would break the make-room/drop
 * tween). A lane mirror of that same path is unaffected: lanes derive from `board.columns`, not the
 * override, so the relocated card never reaches them. Computed ONCE per column and threaded to both
 * the SortableContext item set and CardItem (the sortable itself) so the two can't diverge.
 */
function dragIdsFor(columnId: string, dragReloc: DragReloc | undefined) {
  const relocActivePath =
    dragReloc && dragReloc.toColumn === columnId ? splitCardDragId(dragReloc.activeId).path : null;
  return (path: string) =>
    path === relocActivePath && dragReloc ? dragReloc.activeId : makeCardDragId(columnId, path);
}
