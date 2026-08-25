import type { HistoryScope } from "./model/types";
import type { BoardViewMode } from "./viewMode";

export interface KanbanSettings {
  detailPresentation: "side" | "modal";
  sidePanelMode: "split" | "float";
  detailWidth: number;
  addCardFlow: "inline" | "inline-edit" | "detail";
  addCardOpenMode: "default" | "modal" | "side-float" | "side-split";
  cardNextTodos: number;
  historyScope: HistoryScope;
  /** How the board pans horizontally.
   *  - "shift": Shift+drag (or middle-button drag) pans from anywhere, incl. over cards/columns (default).
   *  - "empty": plain left-drag pans, but only from an empty board-background area; cards/columns keep
   *    plain drag for their own interactions. (Middle-button drag still pans from anywhere.) */
  boardPan: "shift" | "empty";
  /** Which view a board note opens in when it is opened as a file (explorer, link, search,
   *  quick switcher, restored tab). A note's own `folia-view` property overrides it. */
  boardNoteDefaultView: BoardViewMode;
}

export const DEFAULT_SETTINGS: KanbanSettings = {
  detailPresentation: "side",
  sidePanelMode: "split",
  detailWidth: 380,
  addCardFlow: "inline",
  addCardOpenMode: "default",
  cardNextTodos: 0,
  historyScope: "all",
  boardPan: "shift",
  boardNoteDefaultView: "board",
};

export const DETAIL_WIDTH_MIN = 280;
export const DETAIL_WIDTH_MAX = 720;
