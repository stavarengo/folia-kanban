import { useCallback, useEffect, useRef, useState } from "react";
import {
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Board as BoardModel, Card } from "../model/types";
import { planDrop, resolveDragReloc, splitCardDragId, type DragReloc } from "../model/board";
import { useBoardActions } from "./context";

/**
 * A drag in flight on the board: what was picked up, the live make-room gap it has opened, and what
 * a drop, a cancel or a hover does to them.
 */
export function useBoardDrag(
  board: BoardModel,
  columnIds: string[],
  /** A card drop: the card as it was when it was picked up, and the id it was released over. */
  onMove: (card: Card, overId: string) => void,
) {
  const actions = useBoardActions();
  const [activeId, setActiveId] = useState<string | null>(null);
  // A live cross-column relocation (the "premium" make-room): while dragging a card OVER a different
  // column, we open a real gap there by rendering the card moved into that column (in the EFFECTIVE
  // columns Board derives). The dragged card keeps its ORIGINAL sortable id throughout so dnd-kit
  // never loses its rect — the make-room/drop tween stays smooth. `null` whenever the drag is same-
  // column (native sortable owns that — its tween is already correct) or not over any column.
  const [dragReloc, setDragReloc] = useState<DragReloc | null>(null);
  // The card as it was when it was picked up, not whatever its path names on a board reloaded since:
  // a line removed above a placed todo hands its path to the line below, and the drop must carry
  // what the person is holding — the overlay shows it, and the write is held to it.
  const [activeCard, setActiveCard] = useState<Card | null>(null);

  // A committed cross-column move KEEPS `dragReloc` through the drop tween + the async persist window
  // (clearing it synchronously in onDragEnd would snap the card back to its source column before
  // onMove resolves — the old fly-back). The reloaded board lands the card at the same slot the gap
  // held, so clearing it WHEN THE NEW BOARD ARRIVES causes no jump.
  //
  // Deps are `[board]` ONLY — never `activeId`. If `activeId` were a dep, this would fire on the
  // `activeId → null` transition inside onDragEnd (before onMove's async load lands the new board),
  // snapping the card back to its source while the overlay is still tweening — the very fly-back this
  // feature kills. Reading `activeId` through a ref keeps that out of the dep set: a background reload
  // that arrives MID-DRAG (activeRef != null) leaves the gap open; only a post-drop reload clears it.
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  useEffect(() => {
    if (activeRef.current == null) setDragReloc(null);
  }, [board]);

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

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setActiveId(id);
    setActiveCard(columnIds.includes(id) ? null : (board.cards[splitCardDragId(id).path] ?? null));
    setDragReloc(null);
  };
  const onDragOver = (e: DragOverEvent) => {
    // Open (or close) the live make-room gap. Cards still PERSIST in onDragEnd; this only drives
    // the on-screen relocation. `resolveDragReloc` (pure, tested) decides the gap from the SAME
    // `over` the drop reads — so the gap position and landed position agree (no one-slot hop).
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    // Once relocated, the card carries its SOURCE-column id, so hovering its OWN placeholder makes
    // `over === id`. That would parse back to fromColumn and read as same-column → collapse the
    // gap → re-measure → re-open: an oscillation loop under continuous measuring. Hold the gap.
    if (overId !== null && overId === id) return;
    const next = resolveDragReloc(id, overId, columnIds);
    setDragReloc((prev) =>
      prev && next && sameReloc(prev, next)
        ? prev // unchanged target — keep the same object so the override doesn't re-render
        : next,
    );
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    setActiveCard(null);
    const reloc = dragReloc;
    if (!e.over) {
      // No drop target → revert to source. No board update is coming, so clear the gap NOW.
      setDragReloc(null);
      return;
    }
    if (reloc) {
      // A committed cross-column move. Persist using the SAME target the gap was drawn from
      // (bare path / column id — never the namespaced active id, which would mis-route through
      // planDrop's split). KEEP `dragReloc` through the drop tween + persist; the board-effect
      // clears it once the reloaded board lands the card at this exact slot (no jump).
      // Nothing was picked up that a board could name, so no reload is coming to close the gap.
      if (activeCard) onMove(activeCard, reloc.beforePath ?? reloc.toColumn);
      else setDragReloc(null);
      return;
    }
    // Same-column reorder or column header drag: the native sortable placeholder already sits at
    // the destination, so planDrop + onMove keep the verified tween. No gap to clear.
    const plan = planDrop(board, String(e.active.id), String(e.over.id), columnIds);
    if (plan.kind === "reorderColumns") actions.reorderColumns(plan.activeId, plan.overId);
    else if (plan.kind === "moveCard" && activeCard) onMove(activeCard, plan.overId);
  };
  const onDragCancel = () => {
    setActiveId(null);
    setActiveCard(null);
    // A cancel returns the card to its source — clear the gap immediately (no board update coming).
    setDragReloc(null);
  };

  return {
    activeId,
    activeCard,
    dragReloc,
    collisionDetection,
    handlers: { onDragStart, onDragOver, onDragEnd, onDragCancel },
  };
}

function sameReloc(a: DragReloc, b: DragReloc): boolean {
  return a.activeId === b.activeId && a.toColumn === b.toColumn && a.beforePath === b.beforePath;
}
