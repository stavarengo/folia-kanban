import { useRef } from "react";
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Board as BoardModel, Card } from "../model/types";
import { applyReloc } from "../model/board";
import { Column } from "./Column";
import { AddColumn } from "./AddColumn";
import { useSettings } from "./context";
import type { Filter } from "../model/filter";
import { useReducedMotion } from "./useReducedMotion";
import { PanAwarePointerSensor, panModeRef, useBoardPan } from "./boardPan";
import { useBoardDrag } from "./useBoardDrag";
import { dragAnnouncements, screenReaderInstructions } from "./dragAnnouncements";
import { BoardDragOverlay } from "./BoardDragOverlay";

interface Props {
  board: BoardModel;
  today: string;
  selectedPath: string | null;
  wipLimits: Record<string, number>;
  filter: Filter;
  doneColumnId: string | null;
  /** A card drop: the card as it was when it was picked up, and the id it was released over. */
  onMove: (card: Card, overId: string) => void;
  onAddCard: (columnId: string, title: string) => boolean;
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
  const { boardPan } = useSettings();
  // Keep the module-scoped ref the sensor (and the pan handler) reads in sync with the live
  // setting, so toggling it takes effect without re-binding listeners (see PanAwarePointerSensor).
  panModeRef.current = boardPan;

  const columnIds = board.config.columns.map((c) => c.id);
  const reducedMotion = useReducedMotion();
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
      // Moving a card past the edge scrolls its container; dnd-kit smooths that scroll by default.
      scrollBehavior: reducedMotion ? "auto" : "smooth",
    }),
  );
  const drag = useBoardDrag(board, columnIds, onMove);
  // Card sortables are namespaced `${columnId}::${card.path}` so a card mirrored into a cross-board
  // lane (#1) and its status column don't collide on one id. A column drag's active id is the bare
  // column id.
  const activeColumn =
    drag.activeId != null && columnIds.includes(drag.activeId)
      ? (board.config.columns.find((c) => c.id === drag.activeId) ?? null)
      : null;
  const boardRef = useRef<HTMLDivElement>(null);
  useBoardPan(boardRef);

  // The cards each plain status column should render WHILE a cross-column drag is open: the active
  // card shown moved into its target (gap opened). Lanes (filter columns) deliberately bypass this —
  // they derive from `board.columns` directly in Column, so their mirrors stay uncorrupted. The
  // override only flows through the plain status bucket each column is passed below.
  const effectiveColumns = applyReloc(board.columns, drag.dragReloc);
  const dragReloc = drag.dragReloc;

  return (
    <DndContext
      sensors={sensors}
      accessibility={{
        announcements: dragAnnouncements(board, columnIds),
        screenReaderInstructions,
      }}
      collisionDetection={drag.collisionDetection}
      // Re-measure droppables continuously so the gap opened by `dragReloc` (a real layout shift in
      // the target column) is reflected mid-drag — otherwise dnd-kit keeps stale rects and the make-
      // room tween computes against the pre-gap layout.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      {...drag.handlers}
    >
      <div className="folia-board" data-pan={boardPan} ref={boardRef}>
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          {board.config.columns.map((col, i) => (
            <Column
              key={col.id}
              column={col}
              cardPaths={effectiveColumns[col.id] ?? []}
              board={board}
              today={today}
              selectedPath={selectedPath}
              {...(wipLimits[col.id] !== undefined ? { wipLimit: wipLimits[col.id] } : {})}
              filter={filter}
              doneColumnId={doneColumnId}
              isFirst={i === 0}
              isLast={i === board.config.columns.length - 1}
              {...(dragReloc ? { dragReloc } : {})}
              onAddCard={onAddCard}
            />
          ))}
        </SortableContext>
        <AddColumn />
      </div>
      {/* The guard only skips the pre-mount render, where no drag can be active. */}
      {boardRef.current && (
        <BoardDragOverlay
          body={boardRef.current.ownerDocument.body}
          reducedMotion={reducedMotion}
          activeColumn={activeColumn}
          activeCard={drag.activeCard}
          today={today}
          doneColumnId={doneColumnId}
        />
      )}
    </DndContext>
  );
}
