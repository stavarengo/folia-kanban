import { memo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, CardStats, ContextConfig } from "../model/types";
import { sameLine } from "../model/board";
import {
  agentRunChips,
  cardChips,
  cardUrgency,
  isCompletable,
  priorityTone,
  relationChips,
} from "./cardView";
import {
  useBoardActions,
  useContexts,
  type BoardActions,
  useRelationCounts,
  useSettings,
  usePendingLaunch,
  useSubitemsCollapse,
  useUnreadComments,
} from "./context";
import { useReducedMotion } from "./useReducedMotion";
import { TitleError, TitleText } from "./TitleFields";
import { tileName } from "./cardWords";
import { useTileEvents } from "./useTileEvents";
import { useTitleEdit } from "./useTitleEdit";
import {
  AgentCountdown,
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
    onRename: () => title.start(latest.current),
  });

  return (
    <div
      ref={sortable.setNodeRef}
      style={tileStyle(sortable.style, view.ctx)}
      className={tileClassName(card, {
        draggable,
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
        drag={draggable ? sortable : null}
        onOpen={events.open}
        onKeyDown={events.onKeyDown}
        onKeyUp={events.onKeyUp}
        selected={selected}
      />

      {/* Every control below is a sibling of `.folia-card-open`, the tile's own button, and never
          inside it: an interactive element within a `role="button"` is unreachable to assistive
          tech. The same goes for a link in the title, which `.folia-card-main` holds. */}
      <AgentCountdown card={card} />

      {view.hasNestedSubitems && <SubitemsToggle card={card} collapsed={view.subitemsCollapsed} />}

      {parentPath && <ParentRef parentPath={parentPath} parentTitle={parentTitle} />}

      {/* Hidden while renaming: the rename commits on blur, without waiting, so an action clicked out
          of the title <input> would race it and act on the card's old path. */}
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
  const { cardNextTodos, experimentalAgentColumns } = useSettings();
  const subitems = useSubitemsCollapse();
  // Blocking markers come from the board graph (a link on ANOTHER card decides what this one
  // shows), so they arrive through their own context rather than this card's memoized props.
  const relations = useRelationCounts()[card.path];
  // Unread comments (§ unread): read-state lives in plugin data, not the note, so it is read here
  // from settings rather than arriving on the memoized card. `reply` = an unread comment that
  // landed after one of your own.
  const unread = useUnreadComments(card.path, card.stats?.commentMarks);
  const launchPending = usePendingLaunch(card.path) !== null;
  const chips = [
    ...relationChips(relations),
    ...cardChips(card, today, actions.doneColumnId, actions.priorityScale),
    ...(experimentalAgentColumns ? agentRunChips(card) : []),
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
    launchPending,
    agentRuns: experimentalAgentColumns,
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

/** What a pointer does to a draggable tile: the sortable's listeners, less the keyboard's. */
function pointerListeners(listeners: object | undefined): object {
  return Object.fromEntries(
    Object.entries(listeners ?? {}).filter(([name]) => name !== "onKeyDown"),
  );
}

/**
 * The tile's face, in two parts that are siblings on purpose.
 *
 * `.folia-card-open` is the card's own control: the tab stop, the button a screen reader names and
 * activates, and what the keyboard opens, lifts and asks a menu of. It lies over the whole tile
 * and takes no pointer. `.folia-card-main` is what is drawn: the title (or its rename input) and
 * what the card carries. A click or a press lands there, so the mouse opens and drags the card as
 * before. Were the drawing inside the button, a link in the title would be an interactive element
 * nested in another, which no assistive technology can reach.
 */
function CardFace({
  card,
  view,
  title,
  drag,
  onOpen,
  onKeyDown,
  onKeyUp,
  selected,
}: {
  card: Card;
  view: ReturnType<typeof useTileView>;
  title: ReturnType<typeof useTitleEdit>;
  /** The tile's sortable, or null for a tile that can't be dragged. */
  drag: ReturnType<typeof useTileSortable> | null;
  onOpen: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  selected: boolean;
}) {
  const control = useRef<HTMLDivElement | null>(null);
  const setControl = (el: HTMLDivElement | null) => {
    control.current = el;
    drag?.setActivatorNodeRef(el);
  };
  // A click on the face leaves the focus on the card's control, as it would on a button: that is
  // where the dialog hands the focus back to when it closes.
  const openByPointer = () => {
    control.current?.focus({ preventScroll: true });
    onOpen();
  };
  const name = tileName(card, view.unread, view.launchPending, view.agentRuns);
  return (
    <>
      {/* a11y exception (no-static-element-interactions): role + tabIndex come from the spread dnd attributes (sortable: role="button", tabIndex=0) or the explicit non-draggable branch */}
      <div
        className="folia-card-open"
        ref={setControl}
        // A tile that can't be dragged skips the drag attributes (which also supply
        // tabIndex/role), and restores keyboard reachability + open semantics explicitly.
        {...(drag?.attributes ?? { tabIndex: 0, role: "button" })}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        aria-label={name}
        aria-current={selected ? "true" : undefined}
      />
      {/* a11y exception (no-static-element-interactions, click-events-have-key-events): a pointer's way to the card over everything the tile draws; the keyboard's is the `.folia-card-open` button beside it */}
      <div
        className="folia-card-main"
        // The card's whole title, in words, for the pointer: the app shows a label on hover, and
        // the control above, which carries the same one, takes no pointer. This is how a title
        // clipped to three lines is read without opening the card.
        aria-label={name}
        {...pointerListeners(drag?.listeners)}
        onClick={openByPointer}
      >
        <TileTitle card={card} title={title} />
        <CardChips card={card} ctx={view.ctx} chips={view.chips} />
        <CardProgress stats={card.stats} />
        {!view.subitemsCollapsed && view.hasNextTodosPreview && (
          <CardNextTodos stats={card.stats} limit={view.cardNextTodos} />
        )}
        <CardMeta stats={card.stats} unread={view.unread} />
      </div>
    </>
  );
}

/** The card's title on its tile: drawn, or the box it is being renamed in, with why that failed. */
function TileTitle({ card, title }: { card: Card; title: ReturnType<typeof useTitleEdit> }) {
  if (title.editing == null) {
    return (
      <div className="folia-card-title">
        <TitleText title={card.title} sourcePath={card.path} />
      </div>
    );
  }
  return (
    <>
      <input
        ref={title.inputRef}
        className="folia-card-title-input"
        value={title.editing}
        aria-label="Card title"
        aria-invalid={title.error !== null}
        // Stop the face's click/pointer handlers (open, drag) from firing while editing.
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => title.setEditing(e.target.value)}
        onKeyDown={title.onKeyDown}
        onFocus={title.onFocus}
        onBlur={title.onBlur}
      />
      <TitleError failure={title.error} />
    </>
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
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
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
  return { attributes, listeners, setNodeRef, setActivatorNodeRef, style, isDragging };
}

function tileClassName(
  card: Card,
  t: {
    draggable: boolean;
    nested: boolean;
    parentPath: string | undefined;
    selected: boolean;
    isDragging: boolean;
  },
): string {
  return (
    "folia-card" +
    (t.draggable ? "" : " folia-card--static") +
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
