import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Board } from "../model/types";
import { isEmptyFilter, matchCard, type Filter, type MatchContext } from "../model/filter";
import { CardItem } from "./CardItem";
import { useMatchContext, useSubitemsCollapse } from "./context";
import type { useColumnCards } from "./useColumnCards";

// Render a card's subtree of genuinely-nested children as a bordered group. Recursive: each child
// renders a nested (non-sortable) CardItem and then, if it has its own children, its own group.
// buildBoard excludes ALL nested cards (any depth) from columns, so rendering the FULL subtree here
// is what keeps grandchildren from vanishing. `seen` guards against any cycle slipping through.
function SubcardGroup({
  parentPath,
  board,
  today,
  selectedPath,
  seen,
  filter,
  matchCtx,
}: {
  parentPath: string;
  board: Board;
  today: string;
  selectedPath: string | null;
  seen: ReadonlySet<string>;
  filter: Filter;
  matchCtx: MatchContext;
}) {
  const subitems = useSubitemsCollapse();
  // A card only reaches this component (as `parentPath`) once it has already earned its own spot
  // — either it matched the filter itself, or filtering is off. So a filtered board only nests a
  // CHILD here when the child ALSO matches on its own merits; one that matches but this parent does
  // not is lifted to the column's top level by Column instead (see `nestedCards`), never rendered
  // twice. A non-matching child is simply hidden — no hollow containers.
  const filtering = !isEmptyFilter(filter);
  const children = (board.childrenOf[parentPath] ?? []).filter((p) => {
    const c = board.cards[p];
    if (!c || seen.has(p)) return false;
    return !filtering || matchCard(c, filter, matchCtx);
  });
  if (children.length === 0) return null;
  const hasVisibleChildren = (path: string) =>
    (board.childrenOf[path] ?? []).some((p) => {
      const c = board.cards[p];
      return c != null && (!filtering || matchCard(c, filter, matchCtx));
    });
  return (
    <div className="folia-subcard-group">
      {children.map((p) => {
        const card = board.cards[p];
        if (!card) return null;
        const next = new Set(seen).add(p);
        return (
          <div key={p} className="folia-subcard">
            <CardItem
              card={card}
              today={today}
              selected={p === selectedPath}
              nested
              hasSubcardChildren={hasVisibleChildren(p)}
            />
            {/* Same rule as the top-level tree below: a collapsed card's own group of children
                stays unmounted, so its toggle really does hide "everything nested under it". */}
            {!subitems.isCollapsed(p) && (
              <SubcardGroup
                parentPath={p}
                board={board}
                today={today}
                selectedPath={selectedPath}
                seen={next}
                filter={filter}
                matchCtx={matchCtx}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A column's cards, in their groups, each with the tree of subcards nested under it. */
export function ColumnCards({
  cards,
  board,
  today,
  selectedPath,
  filter,
}: {
  cards: ReturnType<typeof useColumnCards>;
  board: Board;
  today: string;
  selectedPath: string | null;
  filter: Filter;
}) {
  const subitems = useSubitemsCollapse();
  const matchCtx = useMatchContext();
  const { groups, liftedPaths, liftedParentOf, dragIdFor, globalFiltering } = cards;

  // A card's subitems toggle is only worth showing when expanding it would actually reveal
  // something — under an active filter that means at least one immediate child still matches
  // (a matching grandchild whose own parent does not match surfaces lifted elsewhere, never here).
  const hasVisibleSubcardChildren = (path: string) =>
    (board.childrenOf[path] ?? []).some((p) => {
      const c = board.cards[p];
      return c != null && (!globalFiltering || matchCard(c, filter, matchCtx));
    });

  // Flat list of rendered top-level cards' sortable ids in display order — the SortableContext item
  // set (so dnd sortable identity matches what the user sees, even when grouped/sorted). A lifted
  // card is excluded: it is not a member of ANY column's real bucket, so `resolveDrop`/`columnOf`
  // cannot resolve a drop onto it, and a cross-column drag landing on it would apply `applyReloc`
  // against a path `board.columns` does not hold. Rather than teach every drag-resolution helper a
  // placement that only exists while a filter narrows the view, a lifted card renders
  // non-draggable — the simplest behaviour that cannot silently fail or misfire.
  const orderedDragIds = groups.flatMap((g) =>
    g.cards.filter((c) => !liftedPaths.has(c.path)).map((c) => dragIdFor(c.path)),
  );

  return (
    <SortableContext items={orderedDragIds} strategy={verticalListSortingStrategy}>
      {groups.map((g) => (
        <div key={g.key || "_"} className="folia-card-group" data-group={g.key || undefined}>
          {g.label && <div className="folia-card-group-heading">{g.label}</div>}
          {g.cards.map((c) => (
            <div key={c.path} className="folia-card-tree">
              <CardItem
                card={c}
                // A lifted card gets no dragId at all — see the note on `orderedDragIds` above,
                // and CardItem, which reads the absence as "this tile can't be dragged". It is
                // NOT `nested`: it stands at this column's top level and is drawn full size,
                // told apart by the `↳ parent` reference every subitem in a column carries.
                {...(liftedPaths.has(c.path) ? {} : { dragId: dragIdFor(c.path) })}
                today={today}
                selected={c.path === selectedPath}
                // Only a subitem standing in a column of its own is in `placedOf` (one still
                // living with its card renders inside SubcardGroup below, where the nesting
                // already says whose it is). So this doubles as "show the ↳ reference".
                // `liftedParentOf` extends the same reference to a card lifted here only
                // because the active filter's match reached past a non-matching parent.
                parentPath={board.placedOf[c.path] ?? liftedParentOf[c.path]}
                parentTitle={
                  board.cards[board.placedOf[c.path] ?? liftedParentOf[c.path] ?? ""]?.title
                }
                hasSubcardChildren={hasVisibleSubcardChildren(c.path)}
              />
              {!subitems.isCollapsed(c.path) && (
                <SubcardGroup
                  parentPath={c.path}
                  board={board}
                  today={today}
                  selectedPath={selectedPath}
                  seen={new Set([c.path])}
                  filter={filter}
                  matchCtx={matchCtx}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </SortableContext>
  );
}
