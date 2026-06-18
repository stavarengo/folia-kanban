import { useEffect, useRef, useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, ColumnDef } from "../model/types";
import { makeCardDragId } from "../model/board";
import { CardItem } from "./CardItem";
import { ColumnMenu } from "./ColumnMenu";
import { ColumnEditModal } from "./ColumnEditModal";
import { Icon } from "./icons";
import { useBoardActions, useSettings } from "./context";
import { groupAndSortCards, isEmptyFilter, matchCard, parseFilter, type Filter } from "./cardView";
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
}: {
  parentPath: string;
  board: Board;
  today: string;
  selectedPath: string | null;
  seen: ReadonlySet<string>;
}) {
  const children = (board.childrenOf[parentPath] ?? []).filter(
    (p) => board.cards[p] && !seen.has(p),
  );
  if (children.length === 0) return null;
  return (
    <div className="folia-subcard-group">
      {children.map((p) => {
        const card = board.cards[p];
        if (!card) return null;
        const next = new Set(seen).add(p);
        return (
          <div key={p} className="folia-subcard">
            <CardItem card={card} today={today} selected={p === selectedPath} nested />
            <SubcardGroup
              parentPath={p}
              board={board}
              today={today}
              selectedPath={selectedPath}
              seen={next}
            />
          </div>
        );
      })}
    </div>
  );
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
  const matchCtx = { today, doneColumnId };

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
    column.group ?? "none",
    column.sort ?? "manual",
    today,
    doneColumnId,
  );

  // Flat list of rendered top-level cards' sortable ids in display order — the SortableContext item
  // set (so dnd sortable identity matches what the user sees, even when grouped/sorted). Each id is
  // namespaced by THIS column (`col::path`) so a card mirrored into a cross-board lane (#1) and its
  // status column register two distinct, non-colliding sortables. CardItem builds the matching id.
  const orderedDragIds = groups.flatMap((g) =>
    g.cards.map((c) => makeCardDragId(column.id, c.path)),
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
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- role + tabIndex come from the spread dnd attributes (drag handle); click enters rename
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
                    columnId={column.id}
                    today={today}
                    selected={c.path === selectedPath}
                  />
                  <SubcardGroup
                    parentPath={c.path}
                    board={board}
                    today={today}
                    selectedPath={selectedPath}
                    seen={new Set([c.path])}
                  />
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
