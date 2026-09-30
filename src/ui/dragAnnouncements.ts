import type { Announcements, ScreenReaderInstructions } from "@dnd-kit/core";
import type { Board as BoardModel } from "../model/types";
import { splitCardDragId } from "../model/board";

/**
 * What a keyboard drag says aloud: card titles and column names, not file paths or slugs. Card ids
 * are namespaced (`col::path`), so the bare path is resolved before the card is looked up.
 */
export function dragAnnouncements(board: BoardModel, columnIds: string[]): Announcements {
  const labelFor = (id: string | number) => {
    const key = String(id);
    if (columnIds.includes(key))
      return board.config.columns.find((c) => c.id === key)?.title ?? key;
    return board.cards[splitCardDragId(key).path]?.title ?? key;
  };
  return {
    onDragStart: ({ active }) => `Picked up ${labelFor(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${labelFor(active.id)} is over ${labelFor(over.id)}.`
        : `${labelFor(active.id)} is no longer over a column.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${labelFor(active.id)} into ${labelFor(over.id)}.`
        : `Dropped ${labelFor(active.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${labelFor(active.id)} was returned.`,
  };
}

export const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "Press Space to pick up a card, use the arrow keys to move it between and within columns, Space again to drop, Escape to cancel. Press Enter to open a card.",
};
