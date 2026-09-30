import { useMemo, useState } from "react";
import type { Board as BoardModel, ColumnDef } from "../model/types";
import { filterVisiblePaths, findDoneColumn, relationCounts } from "../model/board";
import { DEFAULT_PRIORITIES } from "../model/priorities";
import { matchCard, parseFilter, type Filter, type MatchContext } from "../model/filter";
import { isCollapsedIn, seenMarkerFor, type BoardSettings } from "../settings";
import { unreadStateOf, type PinnedSeen } from "./context";
import { boardPriorities } from "./cardView";

/** Stable empty contexts map (#14) so the provider value identity doesn't churn pre-load. */
const EMPTY_CONTEXTS = {} as const;

/** Stable empty relation-count map, same reason. */
const EMPTY_RELATION_COUNTS = {} as const;

/**
 * What the board reads off the loaded board, the settings and the search box: the done column,
 * the priority vocabulary, the WIP limits, the contexts and blocking markers every tile reads, and
 * the parsed search with everything it is matched against.
 */
export function useBoardView({
  board,
  settings,
  query,
  today,
  selected,
}: {
  board: BoardModel | null;
  settings: BoardSettings;
  query: string;
  today: string;
  selected: string | null;
}) {
  const doneColumnId = useMemo(
    () => (board ? findDoneColumn(board.config.columns) : null),
    [board],
  );

  // What the board actually knows: its remembered vocabulary plus the values its cards carry.
  // Empty for a board that has never seen a priority — the pickers substitute the todo.txt
  // starting set below, but nothing empty is ever written back to the note.
  const vocabulary = useMemo(
    () => (board ? boardPriorities(board.config.priorities, Object.values(board.cards)) : []),
    [board],
  );
  const priorities = useMemo(
    () => (vocabulary.length ? vocabulary : [...DEFAULT_PRIORITIES]),
    [vocabulary],
  );

  const wipLimits = useMemo(() => wipLimitsOf(board?.config.columns), [board]);

  // Context configs (#14) for the marker provider. Every load() builds a fresh `board.contexts`
  // object; key the memo on its serialized content so its identity only flips when a context's
  // name/color/label actually changes — otherwise every CardItem (a consumer) would re-render on
  // each reload, defeating App's deliberate frontmatter-reference memo optimization.
  const contextsValue = board?.contexts ?? EMPTY_CONTEXTS;
  const contextsKey = JSON.stringify(contextsValue);
  const contexts = useMemo(() => contextsValue, [contextsKey]);

  // Blocking markers: the counts every card tile reads. Recomputed per board load — an edit to
  // one card changes what its neighbours show, so this can't live on the memoized card props.
  const relations = useMemo(
    () => (board ? relationCounts(board, doneColumnId) : EMPTY_RELATION_COUNTS),
    [board, doneColumnId],
  );

  // Parse the query once per change; Board/Column filter with this same parsed §1 Filter.
  const filter = useMemo(() => parseFilter(query), [query]);

  // The open card's seen-marker as it was when it was selected, so an `unread:` filter keeps the
  // card on the board for the whole visit (see `unreadStateOf`). Re-read only when the selection
  // changes: derived during render so it is captured before the panel's own effect marks the
  // comments seen.
  const [pinnedSeen, setPinnedSeen] = useState<PinnedSeen | null>(null);
  if ((pinnedSeen?.path ?? null) !== selected) {
    setPinnedSeen(selected ? { path: selected, seen: seenMarkerFor(settings, selected) } : null);
  }
  const matchCtx = useMemo<MatchContext>(
    () => ({
      today,
      doneColumnId,
      relations,
      unread: unreadStateOf(settings, pinnedSeen),
      me: settings.userName,
    }),
    [today, doneColumnId, relations, settings, pinnedSeen],
  );
  const counts = useMemo(
    () => countCards(board, filter, matchCtx, settings),
    [board, filter, matchCtx, settings],
  );

  return {
    doneColumnId,
    priorities,
    wipLimits,
    contexts,
    relations,
    filter,
    matchCtx,
    counts,
  };
}

function wipLimitsOf(columns: readonly ColumnDef[] | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  for (const c of columns ?? []) if (typeof c.limit === "number") map[c.id] = c.limit;
  return map;
}

/** The toolbar's "N of M". */
function countCards(
  board: BoardModel | null,
  filter: Filter,
  matchCtx: MatchContext,
  settings: BoardSettings,
): { total: number; match: number } {
  let total = 0;
  let match = 0;
  if (board) {
    const matchesFilter = (p: string) => {
      const c = board.cards[p];
      return c != null && matchCard(c, filter, matchCtx);
    };
    // The two halves of "N of M" are deliberately asymmetric. M is every card that EXISTS on the
    // board, nested ones included, so the denominator does not shift while you type. N credits a
    // card only when it both matches AND renders somewhere — `filterVisiblePaths` is the one
    // place that decides "somewhere", mirroring Column: nested under a matching parent that is
    // drawing its children, lifted to a plain column, or standing in a column that actually draws
    // it. Counting nested cards in M is what keeps N ≤ M once a lifted subcard can be credited at
    // all: the old bucket-only denominator could be exceeded by it.
    const visible = filterVisiblePaths(board, {
      matches: matchesFilter,
      showsChildren: (p) => !isCollapsedIn(settings, p),
      ctx: matchCtx,
    });
    for (const path of Object.keys(board.cards)) {
      total++;
      if (visible.has(path) && matchesFilter(path)) match++;
    }
  }
  return { total, match };
}
