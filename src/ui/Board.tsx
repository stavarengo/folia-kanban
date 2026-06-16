import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Board as BoardModel } from "../model/types";
import { Column } from "./Column";
import { AddColumn } from "./AddColumn";
import { useBoardActions } from "./context";
import { cardChips, priorityTone, type BoardFilters } from "./cardView";

// Shift+drag (and middle-button drag) are reserved for panning the board horizontally, so the
// card-drag activator bows out for them — leaving plain left-drag for dnd-kit as before.
class ShiftAwarePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) =>
        nativeEvent.isPrimary && !nativeEvent.shiftKey && nativeEvent.button === 0,
    },
  ];
}

interface Props {
  board: BoardModel;
  today: string;
  selectedPath: string | null;
  wipLimits: Record<string, number>;
  filters: BoardFilters;
  doneColumnId: string | null;
  onMove: (activeId: string, overId: string) => void;
  onAddCard: (columnId: string, title: string) => void;
}

export function Board({ board, today, selectedPath, wipLimits, filters, doneColumnId, onMove, onAddCard }: Props) {
  const actions = useBoardActions();
  const columnIds = board.config.columns.map((c) => c.id);
  const sensors = useSensors(
    useSensor(ShiftAwarePointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks up / drops; Enter is left free for opening a focused card.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeCard = activeId ? board.cards[activeId] : null;

  // Columns and cards share one DndContext, so both are registered droppables. When a COLUMN is
  // being dragged, restrict collision to column droppables only — otherwise closestCorners can
  // report a card path as the `over` target, and the column-reorder path (which only knows column
  // ids) would silently no-op. Card drags fall through to the default detector unchanged.
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (activeId && columnIds.includes(activeId)) {
        return closestCorners({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => columnIds.includes(String(c.id))),
        });
      }
      return closestCorners(args);
    },
    [activeId, columnIds],
  );

  // Shift+drag (or middle-button drag) pans the board horizontally. The card-drag sensor ignores
  // these gestures (see ShiftAwarePointerSensor), so the two never fight over the same pointer.
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let startX = 0;
    let startScroll = 0;
    let panning = false;
    // True once a pan has actually moved past the threshold. preventDefault() on pointerdown does NOT
    // suppress the high-level `click` the browser later synthesizes, so a shift-press that begins and
    // ends on a card would still fire the card's click-to-open. We track the real pan and swallow that
    // click in the capture phase below.
    let didPan = false;

    const onPointerDown = (e: PointerEvent) => {
      // Reset unconditionally (before the gesture guard) so every gesture starts clean — a middle-button
      // pan emits `auxclick` (never `click`), so its didPan would otherwise go stale and eat the next
      // legitimate left-click.
      didPan = false;
      if (!(e.shiftKey || e.button === 1)) return;
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
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      // Match the card-drag sensor's 5px distance so jitter on a shift-click isn't mistaken for a pan.
      if (Math.abs(e.clientX - startX) > 5) didPan = true;
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

  // Speak card titles and column names (not file paths / slugs) during a keyboard drag.
  const labelFor = (id: string) =>
    board.cards[id]?.basename ?? board.config.columns.find((c) => c.id === id)?.title ?? id;
  const announcements = {
    onDragStart: ({ active }: { active: { id: string | number } }) => `Picked up ${labelFor(String(active.id))}.`,
    onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over ? `${labelFor(String(active.id))} is over ${labelFor(String(over.id))}.` : `${labelFor(String(active.id))} is no longer over a column.`,
    onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over ? `Dropped ${labelFor(String(active.id))} into ${labelFor(String(over.id))}.` : `Dropped ${labelFor(String(active.id))}.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) => `Cancelled. ${labelFor(String(active.id))} was returned.`,
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
        const activeId = String(e.active.id);
        const overId = String(e.over.id);
        // A column drag's active id is a column id; route it to the column-reorder path so
        // resolveDrop (which only understands card ids) never sees it as a no-op.
        if (columnIds.includes(activeId)) {
          actions.reorderColumns(activeId, overId);
          return;
        }
        onMove(activeId, overId);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="mdkb-board" ref={boardRef}>
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          {board.config.columns.map((col, i) => (
            <Column
              key={col.id}
              column={col}
              cardPaths={board.columns[col.id] ?? []}
              board={board}
              today={today}
              selectedPath={selectedPath}
              wipLimit={wipLimits[col.id]}
              filters={filters}
              doneColumnId={doneColumnId}
              isFirst={i === 0}
              isLast={i === board.config.columns.length - 1}
              onAddCard={onAddCard}
            />
          ))}
        </SortableContext>
        <AddColumn />
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
        {activeCard ? (
          <div
            className="mdkb-card mdkb-card-overlay"
            data-prio={
              typeof activeCard.frontmatter.priority === "string" && activeCard.frontmatter.priority
                ? priorityTone(activeCard.frontmatter.priority)
                : undefined
            }
          >
            <div className="mdkb-card-main">
              <div className="mdkb-card-title">{activeCard.basename}</div>
              {(() => {
                const chips = cardChips(activeCard, today, doneColumnId);
                return chips.length > 0 ? (
                  <div className="mdkb-chips">
                    {chips.map((c) => (
                      <span key={c.key} className={`mdkb-chip mdkb-chip-${c.tone}`}>
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
