import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Board as BoardModel } from "../model/types";
import { Column } from "./Column";

interface Props {
  board: BoardModel;
  today: string;
  selectedPath: string | null;
  onOpen: (path: string) => void;
  onMove: (activeId: string, overId: string) => void;
  onAddCard: (columnId: string, title: string) => void;
}

export function Board({ board, today, selectedPath, onOpen, onMove, onAddCard }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        if (e.over) onMove(String(e.active.id), String(e.over.id));
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="mdkb-board">
        {board.config.columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            cardPaths={board.columns[col.id] ?? []}
            board={board}
            today={today}
            selectedPath={selectedPath}
            onOpen={onOpen}
            onAddCard={onAddCard}
          />
        ))}
      </div>
      <DragOverlay>
        {activeId && board.cards[activeId] ? (
          <div className="mdkb-card mdkb-card-overlay">
            <div className="mdkb-card-title">{board.cards[activeId].basename}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
