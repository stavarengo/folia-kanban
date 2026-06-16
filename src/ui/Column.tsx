import { useRef, useState, type CSSProperties } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Board, ColumnDef } from "../model/types";
import { CardItem } from "./CardItem";
import { ColumnMenu } from "./ColumnMenu";
import { ColumnEditModal } from "./ColumnEditModal";
import { Icon } from "./icons";
import { useBoardActions, useSettings } from "./context";
import { cardMatches, groupAndSortCards, hasActiveFilter, matchCard, parseFilter, type BoardFilters } from "./cardView";

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
  const children = (board.childrenOf[parentPath] ?? []).filter((p) => board.cards[p] && !seen.has(p));
  if (children.length === 0) return null;
  return (
    <div className="mdkb-subcard-group">
      {children.map((p) => {
        const next = new Set(seen).add(p);
        return (
          <div key={p} className="mdkb-subcard">
            <CardItem card={board.cards[p]} today={today} selected={p === selectedPath} nested />
            <SubcardGroup parentPath={p} board={board} today={today} selectedPath={selectedPath} seen={next} />
          </div>
        );
      })}
    </div>
  );
}

// Stable per-column accent when the board hasn't assigned a color, so even a plain
// `columns: [todo, doing, done]` board reads as colour-coded (easier to scan at a glance).
const COLUMN_PALETTE = ["#4c9aff", "#8fd14f", "#ffab00", "#9c8cff", "#ff5c5c", "#57d9a3", "#f78fb3", "#9aa0a6"];
function autoColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLUMN_PALETTE[h % COLUMN_PALETTE.length];
}

interface Props {
  column: ColumnDef;
  cardPaths: string[];
  board: Board;
  today: string;
  selectedPath: string | null;
  wipLimit?: number;
  filters: BoardFilters;
  doneColumnId: string | null;
  isFirst: boolean;
  isLast: boolean;
  onAddCard: (columnId: string, title: string) => void;
}

export function Column({ column, cardPaths, board, today, selectedPath, wipLimit, filters, doneColumnId, isFirst, isLast, onAddCard }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const settings = useSettings();
  const actions = useBoardActions();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

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
  const globalFiltering = hasActiveFilter(filters);
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
    ? topLevelPaths.filter((p) => matchCard(board.cards[p], columnFilter, matchCtx))
    : allPaths;
  // The rendered set additionally ANDs the global search filter on top of the lane.
  let paths = lanePaths;
  if (globalFiltering) paths = paths.filter((p) => cardMatches(board.cards[p], today, filters, doneColumnId));
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
    paths.map((p) => board.cards[p]),
    column.group ?? "none",
    column.sort ?? "manual",
    today,
    doneColumnId,
  );

  // Flat list of rendered top-level paths in display order — the SortableContext item set (so dnd
  // sortable identity matches what the user sees, even when grouped/sorted).
  const orderedPaths = groups.flatMap((g) => g.cards.map((c) => c.path));

  const count = countPaths.length;
  const overLimit = wipLimit != null && count > wipLimit;
  const accent = column.color || autoColor(column.id);

  // #10 — de-emphasis. opacity fades the resting column; hoverOpacity reveals it on hover (default:
  // reveal to full when faded). parked shoves the column to the far right (flex `order`) with a
  // large left margin so a rabbit-hole column hides off-screen. All purely presentational.
  const opacity = typeof column.opacity === "number" ? column.opacity : 1;
  const faded = opacity < 1;
  const parked = column.parked === true;
  const style: Record<string, string | number> = { ["--mdkb-col-accent" as string]: accent };
  if (faded) {
    style["--mdkb-col-opacity"] = opacity;
    style["--mdkb-col-hover-opacity"] = typeof column.hoverOpacity === "number" ? column.hoverOpacity : 1;
  }

  return (
    <section
      className={"mdkb-column" + (overLimit ? " is-over-limit" : "") + (faded ? " is-faded" : "") + (parked ? " is-parked" : "")}
      data-testid="column"
      data-column={column.id}
      style={style as CSSProperties}
    >
      <header className="mdkb-column-header">
        <span className="mdkb-column-dot" aria-hidden="true" />
        <span className="mdkb-column-title">{column.title}</span>
        <span
          className={"mdkb-column-count" + (overLimit ? " is-over-limit" : "")}
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
          className="mdkb-icon-btn mdkb-column-menu-btn"
          aria-label={`Column options for ${column.title}`}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
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
            onEdit={() => setEditing(true)}
          />
        )}
      </header>
      <div ref={setNodeRef} className={"mdkb-column-body" + (isOver ? " is-over" : "")}>
        <SortableContext items={orderedPaths} strategy={verticalListSortingStrategy}>
          {groups.map((g) => (
            <div key={g.key || "_"} className="mdkb-card-group" data-group={g.key || undefined}>
              {g.label && <div className="mdkb-card-group-heading">{g.label}</div>}
              {g.cards.map((c) => (
                <div key={c.path} className="mdkb-card-tree">
                  <CardItem card={c} today={today} selected={c.path === selectedPath} />
                  <SubcardGroup parentPath={c.path} board={board} today={today} selectedPath={selectedPath} seen={new Set([c.path])} />
                </div>
              ))}
            </div>
          ))}
        </SortableContext>
        {paths.length === 0 && !adding && (
          filtering ? (
            <div className="mdkb-column-empty is-filtered">
              <span>No matches</span>
            </div>
          ) : (
            <div className="mdkb-column-empty" aria-hidden="true">
              <Icon name="inbox" size={20} />
              <span>Nothing here</span>
            </div>
          )
        )}
        {adding && (
          <div className="mdkb-add-card">
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
            <div className="mdkb-row-actions">
              <button className="mdkb-btn mdkb-btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => submit(false)}>
                Add card
              </button>
              <button className="mdkb-btn" onClick={() => { setAdding(false); setTitle(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {!adding && (
        <button className="mdkb-column-add" aria-label={`Add card to ${column.title}`} onClick={onAddClick}>
          <Icon name="plus" size={15} />
          Add a card
        </button>
      )}
      {editing && <ColumnEditModal column={column} onClose={() => setEditing(false)} />}
    </section>
  );
}
