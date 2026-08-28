import { useEffect, useMemo, useRef, useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, ColumnDef } from "../model/types";
import {
  makeCardDragId,
  nestedCards,
  splitCardDragId,
  subtreePaths,
  type DragReloc,
} from "../model/board";
import { CardItem } from "./CardItem";
import { ColumnMenu } from "./ColumnMenu";
import { ColumnEditModal } from "./ColumnEditModal";
import { Icon } from "./icons";
import { useBoardActions, useMatchContext, useSettings, useSubitemsCollapse } from "./context";
import {
  groupAndSortCards,
  isEmptyFilter,
  matchCard,
  parseFilter,
  type Filter,
  type MatchContext,
} from "./cardView";
import { COLUMN_COLORS } from "./columnColors";

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

// A card gets a subitems toggle at all only when something is actually nested under it — mirrors
// CardItem's own `hasNestedSubitems` (subcard children OR an inline-todos preview the current
// `cardNextTodos` setting would show). Column and SubcardGroup both need this to decide which
// paths a collapse-all/expand-all should touch: writing an override for a card with no toggle
// would be a wasted `data.json` entry nothing ever reads.
function hasNestedSubitems(board: Board, cardNextTodos: number, path: string): boolean {
  if ((board.childrenOf[path]?.length ?? 0) > 0) return true;
  const nextTodos = board.cards[path]?.stats?.nextTodos.length ?? 0;
  return cardNextTodos > 0 && nextTodos > 0;
}

// Stable per-column accent when the board hasn't assigned a color, so even a plain
// `columns: [todo, doing, done]` board reads as colour-coded (easier to scan at a glance).
function autoColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  // `h % length` is always in range; the `?? COLUMN_COLORS[0]` only satisfies
  // noUncheckedIndexedAccess (the const tuple's [0] is a known-defined palette colour).
  return COLUMN_COLORS[h % COLUMN_COLORS.length] ?? COLUMN_COLORS[0];
}

interface Props {
  column: ColumnDef;
  cardPaths: string[];
  board: Board;
  today: string;
  selectedPath: string | null;
  wipLimit?: number;
  filter: Filter;
  doneColumnId: string | null;
  isFirst: boolean;
  isLast: boolean;
  /** A live cross-column relocation in progress (set on every column while a card is dragged across).
   *  When this column is the relocation's target, the relocated card must keep its ORIGINAL sortable
   *  id (`dragReloc.activeId`) instead of this column's namespaced id, or dnd-kit unmounts the active
   *  sortable mid-drag and the make-room/drop tween breaks. */
  dragReloc?: DragReloc;
  onAddCard: (columnId: string, title: string) => void;
}

export function Column({
  column,
  cardPaths,
  board,
  today,
  selectedPath,
  wipLimit,
  filter,
  doneColumnId,
  isFirst,
  isLast,
  dragReloc,
  onAddCard,
}: Props) {
  // The column is itself a sortable item (header drag-reorder, #2). Its sortable id IS column.id,
  // which doubles as the body's droppable id — so a card dropped on this column still reports
  // over.id === column.id and resolveDrop keeps bucketing card drops unchanged. (No separate
  // useDroppable: that would register a second droppable under the same id and collide.)
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isOver,
    isDragging,
  } = useSortable({ id: column.id });
  const settings = useSettings();
  const actions = useBoardActions();
  const subitems = useSubitemsCollapse();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // colcfg #8 — the full "Edit column" modal (distinct from the #7 inline title `editing` below).
  const [editModalOpen, setEditModalOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Inline title edit (#7). A click on the title (no meaningful drag movement) enters edit mode;
  // the ≥5px movement threshold that distinguishes drag from click is the dnd sensor's own
  // activationConstraint (distance: 5) — once it fires, dnd takes the pointer and the click never
  // arrives, so click === "did not drag". `justDragged` is a belt-and-braces guard against a
  // trailing click some browsers synthesize after a completed drag.
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(column.title);
  const justDragged = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isDragging) justDragged.current = true;
  }, [isDragging]);

  // Reset the draft if the column title changes underneath us (e.g. a rename from the menu).
  useEffect(() => {
    if (!editing) setTitleDraft(column.title);
  }, [column.title, editing]);

  const enterEdit = () => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    setTitleDraft(column.title);
    setEditing(true);
  };
  const commitTitle = () => {
    if (!editing) return;
    const t = titleDraft.trim();
    if (t && t !== column.title) actions.renameColumn(column.id, t);
    setEditing(false);
  };
  const cancelEdit = () => {
    setTitleDraft(column.title);
    setEditing(false);
  };

  useEffect(() => {
    if (editing) {
      const el = titleInputRef.current;
      el?.focus();
      el?.select();
    }
  }, [editing]);

  // 'detail' flow opens the create form in the detail panel; 'inline'/'inline-edit' use the composer.
  const onAddClick = () => {
    if (settings.addCardFlow === "detail") actions.startCreate(column.id);
    else setAdding(true);
  };

  const submit = (keepOpen: boolean) => {
    const t = title.trim();
    if (t) onAddCard(column.id, t);
    setTitle("");
    if (!keepOpen) setAdding(false);
  };

  const allPaths = cardPaths.filter((p) => board.cards[p]);
  // #9: the global search is the single source of truth — a parsed §1 Filter (empty = no filtering).
  const globalFiltering = !isEmptyFilter(filter);
  const columnFilter = column.filter ? parseFilter(column.filter) : null;
  const matchCtx = useMatchContext();

  // #1 — an area-filtered column is an AUTO-POPULATED LANE, not a within-status filter. When a
  // column carries a non-empty `filter` rule it pulls EVERY top-level card on the board matching
  // the rule (cross-board — status need not equal this column's id), so e.g. `area:research status:todo`
  // surfaces matching cards wherever they live. A card may appear in several lanes and/or in its
  // status column too; we deliberately do NOT de-dupe across columns. A column with no rule keeps
  // showing exactly its own status bucket (`cardPaths`), byte-identical to before.
  const topLevelPaths = columnFilter
    ? board.config.columns.flatMap((c) => board.columns[c.id] ?? []).filter((p) => board.cards[p])
    : allPaths;
  // The lane's own population (matched by the rule) — what the count badge + WIP reflect for a
  // filter-lane. For a plain column this is just the status bucket.
  const lanePaths = columnFilter
    ? topLevelPaths.filter((p) => {
        const c = board.cards[p];
        return c != null && matchCard(c, columnFilter, matchCtx);
      })
    : allPaths;
  // The rendered set additionally ANDs the global search filter (parsed §1 Filter) on top of the
  // lane — net per column: (lane-pull OR status-bucket) AND (empty global OR global matchCard).
  let paths = lanePaths;
  if (globalFiltering)
    paths = paths.filter((p) => {
      const c = board.cards[p];
      return c != null && matchCard(c, filter, matchCtx);
    });
  const filtering = globalFiltering || columnFilter != null;

  // A genuinely-nested subcard matches the global filter on its own merits, at any depth. When its
  // immediate parent does NOT also match, nesting it below that parent would leave it invisible
  // (SubcardGroup only renders children that themselves match) — so it is lifted here to the top
  // level of the column it would otherwise inherit, carrying a "part of <parent>" reference: the
  // same reference an explicitly-placed subitem already shows (`board.placedOf`). A parent that
  // DOES match keeps the child nested, filtered by SubcardGroup exactly as before.
  //
  // Scoped to a PLAIN column (`columnFilter == null`) on purpose: a filter-lane pulls its population
  // by its own rule against top-level cards only (`topLevelPaths` above) — it has never reached into
  // `childrenOf` — and lifting into it here would show a nested card the lane's own rule never
  // vetted, just because it happens to inherit the lane's column id. That is a bigger feature (lanes
  // reading nested cards) than this fix; a plain column's inherited-column lift is unaffected.
  // `board` is the only input `nestedCards` reads — memoized here so a keystroke in the search box
  // (which changes `filter`, not `board`) does not rebuild the whole-board column-index map on
  // every column on every render; only a board reload does.
  const boardNestedCards = useMemo(() => nestedCards(board), [board]);
  const liftedParentOf: Record<string, string> = {};
  if (globalFiltering && !columnFilter) {
    for (const n of boardNestedCards) {
      if (n.column !== column.id) continue;
      const card = board.cards[n.path];
      if (!card || !matchCard(card, filter, matchCtx)) continue;
      const parentCard = board.cards[n.parentPath];
      if (parentCard && matchCard(parentCard, filter, matchCtx)) continue; // stays nested below
      liftedParentOf[n.path] = n.parentPath;
    }
    if (Object.keys(liftedParentOf).length > 0) paths = [...paths, ...Object.keys(liftedParentOf)];
  }
  const liftedPaths = new Set(Object.keys(liftedParentOf));

  // A card's subitems toggle is only worth showing when expanding it would actually reveal
  // something — under an active filter that means at least one immediate child still matches
  // (a matching grandchild whose own parent does not match surfaces lifted elsewhere, never here).
  const hasVisibleSubcardChildren = (path: string) =>
    (board.childrenOf[path] ?? []).some((p) => {
      const c = board.cards[p];
      return c != null && (!globalFiltering || matchCard(c, filter, matchCtx));
    });

  // Count + WIP reflect the lane's matched cards for a filter-lane (#1.4), the status bucket otherwise.
  const countPaths = lanePaths;

  // Drop INTO a filter-lane stays minimal: the existing move path (App.onMove → moveCard) still sets
  // the dropped card's `status` to THIS column's id, exactly as for a normal column. If the lane's
  // rule keys off a different status the card may immediately fall out of the lane again — accepted
  // (#1.6); the lane is a view, not an owner of membership. No special-casing here.

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

  // The sortable id for a card rendered in THIS column. Normally namespaced `col::path` (so a card
  // mirrored into a cross-board lane (#1) and its status column register two distinct, non-colliding
  // sortables). EXCEPTION: while a cross-column drag is open and lands the active card here (this is
  // its target), that one card keeps its ORIGINAL id (`dragReloc.activeId`, i.e. its SOURCE-column
  // namespacing) — so dnd-kit sees the same sortable identity before and after the relocation and
  // never unmounts the active item mid-drag (which would break the make-room/drop tween). A lane
  // mirror of that same path is unaffected: lanes derive from `board.columns`, not the override, so
  // the relocated card never reaches them. Computed ONCE here and threaded to both `orderedDragIds`
  // (the SortableContext item set) and CardItem (the sortable itself) so the two can't diverge.
  const relocActivePath =
    dragReloc && dragReloc.toColumn === column.id ? splitCardDragId(dragReloc.activeId).path : null;
  const dragIdFor = (path: string) =>
    path === relocActivePath && dragReloc ? dragReloc.activeId : makeCardDragId(column.id, path);

  // Flat list of rendered top-level cards' sortable ids in display order — the SortableContext item
  // set (so dnd sortable identity matches what the user sees, even when grouped/sorted). A lifted
  // card (see `liftedPaths` above) is excluded: it is not a member of ANY column's real bucket, so
  // `resolveDrop`/`columnOf` cannot resolve a drop onto it, and a cross-column drag landing on it
  // would apply `applyReloc` against a path `board.columns` does not hold. Rather than teach every
  // drag-resolution helper a placement that only exists while a filter narrows the view, a lifted
  // card renders non-draggable — the simplest behaviour that cannot silently fail or misfire.
  const orderedDragIds = groups.flatMap((g) =>
    g.cards.filter((c) => !liftedPaths.has(c.path)).map((c) => dragIdFor(c.path)),
  );

  const count = countPaths.length;
  const overLimit = wipLimit != null && count > wipLimit;
  const accent = column.color || autoColor(column.id);

  // #10 — de-emphasis. opacity fades the resting column; hoverOpacity reveals it on hover (default:
  // reveal to full when faded). parked shoves the column to the far right (flex `order`) with a
  // large left margin so a rabbit-hole column hides off-screen. All purely presentational.
  const opacity = typeof column.opacity === "number" ? column.opacity : 1;
  const faded = opacity < 1;
  const parked = column.parked === true;
  const style: Record<string, string | number | undefined> = {
    ["--folia-col-accent" as string]: accent,
    // Header drag-reorder (#2): the sortable's live transform/transition move the column as it
    // drags. `transition` is undefined when idle, which React simply omits.
    transform: CSS.Transform.toString(transform),
    transition,
  };
  if (faded) {
    style["--folia-col-opacity"] = opacity;
    style["--folia-col-hover-opacity"] =
      typeof column.hoverOpacity === "number" ? column.hoverOpacity : 1;
  }

  return (
    <section
      // The column root IS the sortable node (header drag-reorder, #2) AND carries colcfg's #10
      // de-emphasis. setNodeRef is the sortable's droppable ref too, so a card dropped on this
      // column still reports over.id === column.id (no separate useDroppable).
      ref={setNodeRef}
      className={
        "folia-column" +
        (overLimit ? " is-over-limit" : "") +
        (faded ? " is-faded" : "") +
        (parked ? " is-parked" : "") +
        (isDragging ? " is-dragging" : "")
      }
      data-testid="column"
      data-column={column.id}
      style={style}
    >
      <header className="folia-column-header">
        <span className="folia-column-dot" aria-hidden="true" />
        {editing ? (
          <input
            ref={titleInputRef}
            className="folia-column-title-input"
            value={titleDraft}
            aria-label={`Rename column ${column.title}`}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelEdit();
              }
            }}
          />
        ) : (
          // ONE header DOM, two intents (§4): the title span is the drag handle (activator +
          // listeners) AND the click target for inline edit. dnd's distance:5 sensor decides:
          // ≥5px movement → drag (the click never fires); a clean click → enterEdit.
          // a11y exception (no-static-element-interactions): role + tabIndex come from the spread dnd attributes (drag handle); click enters rename
          <span
            ref={setActivatorNodeRef}
            className="folia-column-title"
            title="Drag to reorder, click to rename"
            {...attributes}
            {...listeners}
            // Clear any stale post-drag guard at the very start of a fresh gesture, THEN hand the
            // event to dnd's own pointerdown listener. If a real drag follows, the isDragging
            // effect re-arms the flag; if it's a clean click, the flag stays false and the click
            // enters edit. This prevents a suppressed trailing click from eating a later genuine one.
            onPointerDown={(e) => {
              justDragged.current = false;
              listeners?.["onPointerDown"]?.(e);
            }}
            onClick={enterEdit}
            onKeyDown={(e) => {
              // Keyboard affordance for rename (Enter/Space) — the drag listeners own Space for
              // pickup, so only act on a key we add here without breaking the dnd keyboard sensor.
              if (e.key === "Enter") {
                e.preventDefault();
                setTitleDraft(column.title);
                setEditing(true);
              }
            }}
          >
            {column.title}
          </span>
        )}
        <span
          className={"folia-column-count" + (overLimit ? " is-over-limit" : "")}
          role="img"
          title={
            overLimit
              ? `${count} of ${wipLimit} — over the WIP limit`
              : wipLimit != null
                ? `${count} of ${wipLimit} (WIP limit)`
                : `${count} cards`
          }
          aria-label={
            overLimit
              ? `${count} of ${wipLimit}, over the WIP limit`
              : wipLimit != null
                ? `${count} of ${wipLimit} cards`
                : `${count} cards`
          }
        >
          {overLimit && <Icon name="alert" size={12} />}
          {wipLimit != null ? `${count}/${wipLimit}` : count}
        </span>
        <button
          ref={menuBtnRef}
          className="folia-icon-btn folia-column-menu-btn"
          aria-label={`Column options for ${column.title}`}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          // Keep the menu button out of the header's drag/edit gesture (§4.5): swallow the
          // pointerdown so the column sortable never arms, and toggle the menu on click.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
        >
          <Icon name="more" size={16} />
        </button>
        {menuOpen && (
          <ColumnMenu
            column={column}
            isFirst={isFirst}
            isLast={isLast}
            triggerRef={menuBtnRef}
            onClose={() => setMenuOpen(false)}
            onEdit={() => setEditModalOpen(true)}
            // `paths`, not the raw status bucket: what's actually rendered here right now (after
            // the lane rule and the global search filter), so a filtered column only touches what
            // the user can see. The whole family, not just the top-level tiles: an "expand all"
            // that stopped there would leave a grandchild collapsed from an earlier individual
            // toggle still hidden. `subtreePaths` still walks the FULL board.childrenOf tree
            // (it does not know about the filter), so under an active filter it is narrowed to
            // cards that themselves match — the same test SubcardGroup applies to decide what it
            // nests — so a descendant the filter has hidden does not pick up a toggle override the
            // user could not have meant. Further filtered to cards that HAVE subitems (subcard
            // children OR an inline-todos preview) — a card with none has no state to change. That
            // last test is deliberately unfiltered, unlike the toggle CardItem draws: a card whose
            // only child the filter hides shows no toggle right now but will once the filter is
            // cleared, and collapse-all should still have reached it.
            onCollapseAll={() =>
              subitems.setMany(
                subtreePaths(board, paths)
                  .filter((p) => {
                    const c = board.cards[p];
                    return c != null && (!globalFiltering || matchCard(c, filter, matchCtx));
                  })
                  .filter((p) => hasNestedSubitems(board, settings.cardNextTodos, p)),
                true,
              )
            }
            onExpandAll={() =>
              subitems.setMany(
                subtreePaths(board, paths)
                  .filter((p) => {
                    const c = board.cards[p];
                    return c != null && (!globalFiltering || matchCard(c, filter, matchCtx));
                  })
                  .filter((p) => hasNestedSubitems(board, settings.cardNextTodos, p)),
                false,
              )
            }
          />
        )}
      </header>
      {/* No ref here: the section root is the sortable/droppable node (its id === column.id), so a
          card dropped anywhere on the column still reports over.id === column.id. `isOver` comes
          from useSortable and still drives the body drop highlight. */}
      <div className={"folia-column-body" + (isOver ? " is-over" : "")}>
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
        {paths.length === 0 &&
          !adding &&
          (filtering ? (
            <div className="folia-column-empty is-filtered">
              <span>No matches</span>
            </div>
          ) : (
            <div className="folia-column-empty" aria-hidden="true">
              <Icon name="inbox" size={20} />
              <span>Nothing here</span>
            </div>
          ))}
        {adding && (
          <div className="folia-add-card">
            <textarea
              autoFocus
              rows={2}
              value={title}
              placeholder="What needs doing?"
              aria-label="New card title"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(false);
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setTitle("");
                }
              }}
            />
            <div className="folia-row-actions">
              <button
                className="folia-btn folia-btn-primary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submit(false)}
              >
                Add card
              </button>
              <button
                className="folia-btn"
                onClick={() => {
                  setAdding(false);
                  setTitle("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {!adding && (
        <button
          className="folia-column-add"
          aria-label={`Add card to ${column.title}`}
          onClick={onAddClick}
        >
          <Icon name="plus" size={15} />
          Add a card
        </button>
      )}
      {editModalOpen && <ColumnEditModal column={column} onClose={() => setEditModalOpen(false)} />}
    </section>
  );
}
