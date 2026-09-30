import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, CardStats, ContextConfig } from "../model/types";
import { sameLine } from "../model/board";
import { cardChips, cardUrgency, isCompletable, priorityTone, relationChips } from "./cardView";
import {
  useBoardActions,
  useContexts,
  type BoardActions,
  useRelationCounts,
  useSettings,
  useSubitemsCollapse,
  useUnreadComments,
} from "./context";
import { useReducedMotion } from "./useReducedMotion";
import { tileName } from "./cardWords";
import { useTileEvents } from "./useTileEvents";
import {
  CardActions,
  CardChips,
  CardMeta,
  CardNextTodos,
  CardProgress,
  ParentRef,
  SubitemsToggle,
} from "./CardTileParts";

interface Props {
  card: Card;
  /** The sortable id to register for this top-level card, computed by Column. Normally namespaced
   *  `${columnId}::${card.path}` (so a card mirrored into a cross-board lane (#1) and its status
   *  column don't collide on one id), but the ORIGINAL id while this card is the target of a live
   *  cross-column relocation (see Column). Column owns it so its SortableContext item set and this
   *  sortable can't diverge. Omitted for nested subcards (which are non-draggable). */
  dragId?: string;
  today: string;
  selected: boolean;
  /** A subcard rendered inside its parent's `.folia-subcard-group`: drawn smaller and quieter than
   *  a tile standing in a column, and not drag-reorderable. A card standing at a column's top level
   *  is never `nested`, even when it cannot be dragged (see `dragId`). */
  nested?: boolean;
  /** Set when this tile is a SUBITEM sitting in a column of its own: the note it belongs to. Drives
   *  the `↳ parent` reference line that replaces the nesting as the visible sign of whose work it is. */
  parentPath?: string | undefined;
  /** That parent's title, for the reference line. */
  parentTitle?: string | undefined;
  /** Whether this card has its own subcard children (a non-empty `board.childrenOf[card.path]`),
   *  computed by the caller (Column/SubcardGroup) since only they hold the board graph. Together
   *  with the card's own inline-todos preview this decides whether the collapse/expand toggle
   *  shows at all — a card with nothing nested gets no control. */
  hasSubcardChildren?: boolean;
}

function CardItemInner({
  card,
  dragId,
  today,
  selected,
  nested = false,
  parentPath,
  parentTitle,
  hasSubcardChildren = false,
}: Props) {
  const actions = useBoardActions();
  // The card as last drawn, for a menu row picked after a reload the open menu outlived.
  const latest = useRef(card);
  latest.current = card;
  // Two ways a tile is not drag-reorderable: it is nested inside its parent's group, or Column
  // withheld a `dragId` because this tile is not a member of any column bucket right now (a subcard
  // the active filter lifted past a non-matching parent — a drop onto it could not be resolved).
  // Either way it must not register as a drop target in the surrounding SortableContext, nor
  // advertise itself as draggable; both keep click/keyboard open and the context menu.
  const draggable = !nested && dragId != null;
  const sortable = useTileSortable(draggable ? dragId : card.path, draggable);
  const title = useTitleEdit(card);
  const view = useTileView(card, today, hasSubcardChildren);
  const events = useTileEvents({
    card,
    latest,
    isDragging: sortable.isDragging,
    canComplete: view.canComplete,
    listeners: sortable.listeners,
    onRename: () => title.setEditing(latest.current.title),
  });

  return (
    <div
      ref={sortable.setNodeRef}
      style={tileStyle(sortable.style, view.ctx)}
      className={tileClassName(card, {
        draggable,
        canComplete: view.canComplete,
        nested,
        parentPath,
        selected,
        isDragging: sortable.isDragging,
      })}
      {...tileData(card, parentPath, today, actions)}
      onContextMenu={events.onContextMenu}
      onPointerDownCapture={events.forgetMenuKey}
    >
      {/* #14 context grouping: a left accent strip, shown only when the context defines a color
          (inset past the priority bar so the two left-edge cues don't overlap). */}
      {view.ctxColor && <span className="folia-card-context-strip" aria-hidden="true" />}
      <CardFace
        card={card}
        view={view}
        title={title}
        dragProps={draggable ? { ...sortable.attributes, ...sortable.listeners } : null}
        onOpen={events.open}
        onKeyDown={events.onKeyDown}
        onKeyUp={events.onKeyUp}
        selected={selected}
      />

      {/* Sibling of `.folia-card-main`, same reason as the buttons below: that div carries
          `role="button"` and a nested interactive element inside it would be unreachable to
          assistive tech. */}
      {view.hasNestedSubitems && <SubitemsToggle card={card} collapsed={view.subitemsCollapsed} />}

      {/* Sibling of `.folia-card-main`, never inside it: that div carries `role="button"` (from the
          drag attributes, or the explicit non-draggable branch), and a button within it is unreachable to
          assistive tech — the same reason the action cluster below lives out here. */}
      {parentPath && <ParentRef parentPath={parentPath} parentTitle={parentTitle} />}

      {/* Hidden while renaming: focus-within would otherwise reveal it over the full-width title
          <input> (which has no right gutter), letting buttons cover the caret/text. */}
      {title.editing == null && (
        <CardActions card={card} notePath={events.notePath} canComplete={view.canComplete} />
      )}
    </div>
  );
}

/** What the tile shows beyond the card itself, read from the board's contexts and settings. */
function useTileView(card: Card, today: string, hasSubcardChildren: boolean) {
  const actions = useBoardActions();
  const contexts = useContexts();
  const { cardNextTodos } = useSettings();
  const subitems = useSubitemsCollapse();
  // Blocking markers come from the board graph (a link on ANOTHER card decides what this one
  // shows), so they arrive through their own context rather than this card's memoized props.
  const relations = useRelationCounts()[card.path];
  // Unread comments (§ unread): read-state lives in plugin data, not the note, so it is read here
  // from settings rather than arriving on the memoized card. `reply` = an unread comment that
  // landed after one of your own.
  const unread = useUnreadComments(card.path, card.stats?.commentMarks);
  const chips = [
    ...relationChips(relations),
    ...cardChips(card, today, actions.doneColumnId, actions.priorityScale),
  ];
  // Context grouping (#14): the card's folder-derived context + its (optional) config. The marker
  // is a left accent strip (inset clear of the priority bar) + a label badge, so cards sharing a
  // context read as a group within a column. Subfolders without a `_context.md` just have a name.
  const ctx = typeof card.context === "string" ? contexts[card.context] : undefined;
  // Subitems (§ collapse): anything that would render nested under this tile — its own inline-todos
  // preview (gated by the same `cardNextTodos` cap the list uses) and/or its subcard children
  // (rendered as a sibling `SubcardGroup` by the caller). No toggle when neither exists.
  const hasNextTodosPreview = cardNextTodos > 0 && (card.stats?.nextTodos.length ?? 0) > 0;
  const hasNestedSubitems = hasSubcardChildren || hasNextTodosPreview;
  return {
    unread,
    chips,
    ctx,
    ctxColor: ctx?.color,
    cardNextTodos,
    hasNextTodosPreview,
    hasNestedSubitems,
    subitemsCollapsed: hasNestedSubitems && subitems.isCollapsed(card.path),
    canComplete: isCompletable(card, actions.doneColumnId),
  };
}

/** The tile's focusable face: the title (or its rename input) and what the card carries. */
function CardFace({
  card,
  view,
  title,
  dragProps,
  onOpen,
  onKeyDown,
  onKeyUp,
  selected,
}: {
  card: Card;
  view: ReturnType<typeof useTileView>;
  title: ReturnType<typeof useTitleEdit>;
  /** The sortable's attributes and listeners, or null for a tile that can't be dragged. */
  dragProps: object | null;
  onOpen: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  selected: boolean;
}) {
  return (
    // a11y exception (no-static-element-interactions): role + tabIndex come from the spread dnd attributes (sortable: role="button", tabIndex=0) or the explicit non-draggable branch
    <div
      className="folia-card-main"
      // A tile that can't be dragged skips the drag listeners/attributes (which also supply
      // tabIndex/role), and restores keyboard reachability + open semantics explicitly.
      {...(dragProps ?? { tabIndex: 0, role: "button" })}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      aria-label={tileName(card, view.unread)}
      aria-current={selected ? "true" : undefined}
    >
      {title.editing != null ? (
        <input
          ref={title.inputRef}
          className="folia-card-title-input"
          value={title.editing}
          aria-label="Card title"
          // Stop the parent's click/pointer/keyboard handlers (open, drag) from firing while editing.
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => title.setEditing(e.target.value)}
          onKeyDown={title.onKeyDown}
          onBlur={title.commit}
        />
      ) : (
        <div className="folia-card-title">{card.title}</div>
      )}
      <CardChips card={card} ctx={view.ctx} chips={view.chips} />
      <CardProgress stats={card.stats} />
      {!view.subitemsCollapsed && view.hasNextTodosPreview && (
        <CardNextTodos stats={card.stats} limit={view.cardNextTodos} />
      )}
      <CardMeta stats={card.stats} unread={view.unread} />
    </div>
  );
}

/**
 * The tile's sortable. Hooks can't be conditional, so a tile that can't be dragged still calls
 * useSortable, disabled. A draggable tile uses the `dragId` Column computed (`col::path`, or the
 * original id while this card is mid cross-column relocation) so the sortable identity matches the
 * column's SortableContext item set — and so the same card in a lane + its status column registers
 * two distinct sortables.
 */
function useTileSortable(id: string, draggable: boolean) {
  const reducedMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
    // null switches off both the make-room slide and the settle.
    ...(reducedMotion ? { transition: null } : {}),
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    // The lifted card is rendered by the DragOverlay; the original collapses to a quiet placeholder.
    // Keep it above settling neighbours so the dashed outline isn't clipped during the drop animation.
    zIndex: isDragging ? 1 : undefined,
  };
  return { attributes, listeners, setNodeRef, style, isDragging };
}

/**
 * #12 inline title edit. Entered via the right-click menu's "Rename" (a single title click can't
 * trigger it — that opens the detail), which sets the draft and swaps in the <input>.
 */
function useTitleEdit(card: Card) {
  const actions = useBoardActions();
  // When set, the title swaps for an <input> seeded with this draft.
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = () => {
    if (editing == null) return;
    const next = editing.trim();
    // Rename only on a real change; empty/whitespace is rejected (revert). renameCard writes the
    // title back to its source (file name, heading or `title` key), link-aware for file renames.
    if (next && next !== card.title) actions.renameCard(card.path, next);
    setEditing(null);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // keep typing (incl. Space) out of the dnd keyboard sensor
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null); // cancel — no write
    }
  };
  // Focus + select-all once the input mounts.
  useEffect(() => {
    if (editing != null) {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    }
  }, [editing != null]);
  return { editing, setEditing, inputRef, commit, onKeyDown };
}

function tileClassName(
  card: Card,
  t: {
    draggable: boolean;
    canComplete: boolean;
    nested: boolean;
    parentPath: string | undefined;
    selected: boolean;
    isDragging: boolean;
  },
): string {
  return (
    "folia-card" +
    (t.draggable ? "" : " folia-card--static") +
    (t.canComplete ? "" : " folia-card--no-complete") +
    (t.nested ? " folia-card--nested" : "") +
    (t.parentPath ? " folia-card--subitem" : "") +
    (card.todoRef ? " folia-card--todo" : "") +
    (t.selected ? " folia-is-selected" : "") +
    (t.isDragging ? " folia-is-dragging" : "") +
    (card.context ? " folia-card--has-context" : "")
  );
}

/** With the context's colour for the accent strip, when the context defines one. */
function tileStyle(style: CSSProperties, ctx: ContextConfig | undefined): CSSProperties {
  return ctx?.color ? { ...style, ["--folia-ctx-color" as string]: ctx.color } : style;
}

/** The tile's data attributes, which the theme and the tests read. */
function tileData(
  card: Card,
  parentPath: string | undefined,
  today: string,
  actions: BoardActions,
): Record<`data-${string}`, string | undefined> {
  const priority = card.frontmatter.priority;
  return {
    "data-testid": "card",
    "data-path": card.path,
    "data-subitem": parentPath ? (card.todoRef ? "todo" : "card") : undefined,
    "data-prio":
      typeof priority === "string" && priority
        ? priorityTone(priority, actions.priorityScale)
        : undefined,
    "data-context": card.context ?? undefined,
    "data-urgency": cardUrgency(card, today, actions.doneColumnId) ?? undefined,
  };
}

function sameStats(a?: CardStats, b?: CardStats): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.checklist === b.checklist &&
    a.checklistDone === b.checklistDone &&
    a.subcards === b.subcards &&
    a.comments === b.comments &&
    a.commentMarks.map((c) => `${c.timestamp}:${c.author ?? ""}`).join("\n") ===
      b.commentMarks.map((c) => `${c.timestamp}:${c.author ?? ""}`).join("\n") &&
    a.nextTodos.map((t) => `${t.index}:${t.text}`).join("\n") ===
      b.nextTodos.map((t) => `${t.index}:${t.text}`).join("\n")
  );
}

/** The tile's reading of its checklist line, which is what its actions carry. */
function sameTodoRef(a: Card, b: Card): boolean {
  if (a.todoRef?.parentPath !== b.todoRef?.parentPath) return false;
  // A line that changed in any part of it has to reach the tile — a kept render would hand the next
  // click the older reading.
  return a.todoRef && b.todoRef
    ? sameLine(a.todoRef.line, b.todoRef.line)
    : a.todoRef === b.todoRef;
}

function sameCard(a: Card, b: Card): boolean {
  return (
    a.path === b.path &&
    a.title === b.title &&
    sameTodoRef(a, b) &&
    a.frontmatter.status === b.frontmatter.status &&
    (a.todoRef != null || a.frontmatter === b.frontmatter) &&
    // Body tags come from the metadata cache as a fresh array each load, so this compares their
    // contents; by reference every card would look changed on every reload.
    (a.bodyTags ?? []).join("\n") === (b.bodyTags ?? []).join("\n") &&
    sameStats(a.stats, b.stats)
  );
}

// A board reload rebuilds Card objects, but an unchanged card keeps the same frontmatter
// reference (Obsidian's metadataCache) — so only genuinely-changed cards re-render.
export const CardItem = memo(
  CardItemInner,
  (a, b) =>
    a.selected === b.selected &&
    a.nested === b.nested &&
    a.dragId === b.dragId &&
    a.today === b.today &&
    a.parentPath === b.parentPath &&
    a.parentTitle === b.parentTitle &&
    a.hasSubcardChildren === b.hasSubcardChildren &&
    sameCard(a.card, b.card),
);
