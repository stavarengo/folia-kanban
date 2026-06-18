import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Board as BoardModel } from "../model/types";
import { planDrop, splitCardDragId } from "../model/board";
import { Column } from "./Column";
import { AddColumn } from "./AddColumn";
import { useBoardActions, useSettings } from "./context";
import { cardChips, priorityTone, type Filter } from "./cardView";

// The pan gesture and the card-drag sensor share the same pointer, so exactly one must claim a given
// press. The live pan mode (settings.boardPan) decides which — but dnd-kit instantiates the sensor
// fresh per activation and only exposes a *static* activator, so it can't read React state directly.
// A module-scoped ref bridges that gap: Board keeps it in sync with the setting, and the activator
// reads it. (One board is mounted at a time, so a single shared ref is safe.)
const panModeRef = { current: "shift" as "shift" | "empty" };

// Whether a plain left-press should start a card drag. In "shift" mode the Shift/middle-button press
// is reserved for panning, so the card sensor bows out for it (current behavior). In "empty" mode
// cards drag on a plain left-press as usual; panning only kicks in on empty board background (handled
// by the pointer listeners below, which never see a press that lands on a draggable card).
class PanAwarePointerSensor extends PointerSensor {
  static override activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) return false;
        if (panModeRef.current === "shift" && nativeEvent.shiftKey) return false;
        return true;
      },
    },
  ];
}

interface Props {
  board: BoardModel;
  today: string;
  selectedPath: string | null;
  wipLimits: Record<string, number>;
  filter: Filter;
  doneColumnId: string | null;
  onMove: (activeId: string, overId: string) => void;
  onAddCard: (columnId: string, title: string) => void;
}

export function Board({
  board,
  today,
  selectedPath,
  wipLimits,
  filter,
  doneColumnId,
  onMove,
  onAddCard,
}: Props) {
  const actions = useBoardActions();
  const { boardPan } = useSettings();
  // Keep the module-scoped ref the sensor (and the pan handler below) reads in sync with the live
  // setting, so toggling it takes effect without re-binding listeners (see PanAwarePointerSensor).
  panModeRef.current = boardPan;

  const columnIds = board.config.columns.map((c) => c.id);
  const sensors = useSensors(
    useSensor(PanAwarePointerSensor, {
      // A short distance threshold lets a click stay a click (never hijacked into a drag) while a
      // deliberate move past 5px crisply commits to a drag. The 5px also matches the column header's
      // click-vs-drag threshold (§4) so card and column drags feel consistent.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks up / drops; Enter is left free for opening a focused card.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  // Card sortables are namespaced `${columnId}::${card.path}` so a card mirrored into a cross-board
  // lane (#1) and its status column don't collide on one id. A column drag's active id is the bare
  // column id. Resolve the active card by parsing the path back out (column ids have no `::`).
  const activeColumnDrag = activeId != null && columnIds.includes(activeId);
  const activeColumn = activeColumnDrag
    ? (board.config.columns.find((c) => c.id === activeId) ?? null)
    : null;
  const activeCard =
    activeId && !activeColumnDrag ? board.cards[splitCardDragId(activeId).path] : null;

  // Columns and cards share one DndContext, so both are registered droppables. When a COLUMN is
  // being dragged, restrict collision to column droppables only — otherwise closestCorners can
  // report a card path as the `over` target, and the column-reorder path (which only knows column
  // ids) would silently no-op. Card drags fall through to the default detector unchanged.
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (activeId && columnIds.includes(activeId)) {
        return closestCorners({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) =>
            columnIds.includes(String(c.id)),
          ),
        });
      }
      return closestCorners(args);
    },
    [activeId, columnIds],
  );

  // Horizontal panning of the board. Two modes (settings.boardPan):
  //  - "shift": Shift+drag (or middle-button drag) pans from anywhere, incl. over cards/columns. The
  //    card-drag sensor bows out for the Shift press (see PanAwarePointerSensor), so the two never
  //    fight over the same pointer.
  //  - "empty": a plain left-drag pans, but only when the press lands on the empty board background
  //    (not a card/column/interactive element); over a card a plain left-drag is a card drag. Shift is
  //    not required. Middle-button drag still pans from anywhere in both modes.
  // The effect reads the live mode each press via panModeRef, so toggling the setting takes effect
  // without re-binding listeners.
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let startX = 0;
    let startScroll = 0;
    let panning = false;
    // True once a pan has actually moved past the threshold. preventDefault() on pointerdown does NOT
    // suppress the high-level `click` the browser later synthesizes, so a press that begins and ends on
    // a card would still fire the card's click-to-open. We track the real pan and swallow that click in
    // the capture phase below.
    let didPan = false;

    // In "empty" mode a plain left-press only pans when it lands on bare board background — never on a
    // card, column, or any interactive control. (.folia-board is the background; the columns/AddColumn
    // are its children, so a press whose closest interactive ancestor is the board itself is "empty".)
    const isEmptyBackground = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      return (
        !!t &&
        !t.closest(".folia-column, .folia-add-column, button, a, input, textarea, [role='button']")
      );
    };

    const shouldPan = (e: PointerEvent) => {
      if (e.button === 1) return true; // middle-button always pans
      if (e.button !== 0) return false;
      if (panModeRef.current === "shift") return e.shiftKey;
      return isEmptyBackground(e); // "empty" mode: plain left-drag on bare background
    };

    const onPointerDown = (e: PointerEvent) => {
      // Reset unconditionally (before the gesture guard) so every gesture starts clean — a middle-button
      // pan emits `auxclick` (never `click`), so its didPan would otherwise go stale and eat the next
      // legitimate left-click.
      didPan = false;
      if (!shouldPan(e)) return;
      panning = true;
      startX = e.clientX;
      startScroll = board.scrollLeft;
      board.classList.add("is-pan-scrolling");
      // Capture keeps move/up events flowing to the board even if the pointer leaves it. Guard the
      // call: a pointer can be absent in odd states (e.g. already released), and a throw here would
      // abort the gesture mid-pan.
      try {
        board.setPointerCapture(e.pointerId);
      } catch {
        /* no active pointer to capture — pan still works via the board-level listeners */
      }
      // NOTE: we deliberately do NOT preventDefault here. In "empty" mode a press lands on bare board
      // background often without moving (a plain click to dismiss a popover / blur an inline editor);
      // preventDefault on pointerdown would suppress the native focus-shift and break that commit-on-blur.
      // We only suppress the default (text selection) once an actual pan starts — see onPointerMove.
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      // Match the card-drag sensor's 5px distance so jitter on a shift-click isn't mistaken for a pan.
      if (Math.abs(e.clientX - startX) > 5) {
        didPan = true;
        // Now it's a real pan: kill the text selection a drag would otherwise paint as it scrolls.
        e.preventDefault();
      }
      board.scrollLeft = startScroll - (e.clientX - startX);
    };
    const end = (e: PointerEvent) => {
      if (!panning) return;
      panning = false;
      board.classList.remove("is-pan-scrolling");
      if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
    };
    // Capture phase fires before the event bubbles to React's delegated root container, so this blocks
    // the card's onClick when a pan ended on it.
    const onClickCapture = (e: MouseEvent) => {
      if (!didPan) return;
      e.stopPropagation();
      e.preventDefault();
      didPan = false;
    };

    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("pointermove", onPointerMove);
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", end);
    board.addEventListener("click", onClickCapture, { capture: true });
    return () => {
      board.removeEventListener("pointerdown", onPointerDown);
      board.removeEventListener("pointermove", onPointerMove);
      board.removeEventListener("pointerup", end);
      board.removeEventListener("pointercancel", end);
      board.removeEventListener("click", onClickCapture, { capture: true });
    };
  }, []);

  // Speak card titles and column names (not file paths / slugs) during a keyboard drag. Card ids are
  // namespaced (`col::path`); resolve the bare path before looking the card up.
  const labelFor = (id: string) => {
    if (columnIds.includes(id)) return board.config.columns.find((c) => c.id === id)?.title ?? id;
    return board.cards[splitCardDragId(id).path]?.basename ?? id;
  };
  const announcements = {
    onDragStart: ({ active }: { active: { id: string | number } }) =>
      `Picked up ${labelFor(String(active.id))}.`,
    onDragOver: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over
        ? `${labelFor(String(active.id))} is over ${labelFor(String(over.id))}.`
        : `${labelFor(String(active.id))} is no longer over a column.`,
    onDragEnd: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over
        ? `Dropped ${labelFor(String(active.id))} into ${labelFor(String(over.id))}.`
        : `Dropped ${labelFor(String(active.id))}.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) =>
      `Cancelled. ${labelFor(String(active.id))} was returned.`,
  };
  const screenReaderInstructions = {
    draggable:
      "Press Space to pick up a card, use the arrow keys to move it between and within columns, Space again to drop, Escape to cancel. Press Enter to open a card.",
  };

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements, screenReaderInstructions }}
      collisionDetection={collisionDetection}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        if (!e.over) return;
        // planDrop unwraps the namespaced card ids (#2), routes column reorders (#2 header drag), and
        // drops a same-column reorder onto a computed-order column (#3). All the rules live in the
        // pure model so they're unit-testable; here we just dispatch the plan.
        const plan = planDrop(board, String(e.active.id), String(e.over.id), columnIds);
        if (plan.kind === "reorderColumns") actions.reorderColumns(plan.activeId, plan.overId);
        else if (plan.kind === "moveCard") onMove(plan.path, plan.overId);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="folia-board" data-pan={boardPan} ref={boardRef}>
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          {board.config.columns.map((col, i) => (
            <Column
              key={col.id}
              column={col}
              cardPaths={board.columns[col.id] ?? []}
              board={board}
              today={today}
              selectedPath={selectedPath}
              {...(wipLimits[col.id] !== undefined ? { wipLimit: wipLimits[col.id] } : {})}
              filter={filter}
              doneColumnId={doneColumnId}
              isFirst={i === 0}
              isLast={i === board.config.columns.length - 1}
              onAddCard={onAddCard}
            />
          ))}
        </SortableContext>
        <AddColumn />
      </div>
      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          // Briefly dim the overlay as it settles into the placeholder, so the lift visibly "lands"
          // rather than blinking out.
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: "var(--folia-opacity-faint)" } },
          }),
        }}
      >
        {activeColumn ? (
          // #1 (fix) — a dragged COLUMN gets a real lifted ghost too (col-header gave columns a
          // sortable but no overlay). A header-only ghost reads as "this column, picked up".
          <div
            className="folia-column folia-column-overlay"
            style={{ ["--folia-col-accent" as string]: activeColumn.color || undefined }}
          >
            <div className="folia-column-header">
              <span className="folia-column-dot" aria-hidden="true" />
              <span className="folia-column-title">{activeColumn.title}</span>
            </div>
          </div>
        ) : activeCard ? (
          <div
            className="folia-card folia-card-overlay"
            data-prio={
              typeof activeCard.frontmatter.priority === "string" && activeCard.frontmatter.priority
                ? priorityTone(activeCard.frontmatter.priority)
                : undefined
            }
          >
            <div className="folia-card-main">
              <div className="folia-card-title">{activeCard.basename}</div>
              {(() => {
                const chips = cardChips(activeCard, today, doneColumnId);
                return chips.length > 0 ? (
                  <div className="folia-chips">
                    {chips.map((c) => (
                      <span key={c.key} className={`folia-chip folia-chip-${c.tone}`}>
                        {c.label}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
