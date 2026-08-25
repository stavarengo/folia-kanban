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
  /** Whether a card's nested subitems (inline todos preview + subcard files) start expanded or
   *  collapsed when a card has never been toggled explicitly. `collapsedCards` overrides this
   *  per card. */
  subitemsDefault: "expanded" | "collapsed";
  /** Explicit per-card collapse override, keyed by card path — set the first time a card's
   *  subitems toggle is used (directly, or via a column's collapse/expand-all). Absent from this
   *  map means "follow `subitemsDefault`". Plugin data, never written to the note. */
  collapsedCards: Record<string, boolean>;
  /**
   * The name comments added from the board are signed with (`- _<ts> @name:_ …`). Empty (the
   * default) writes them unsigned, exactly as before authorship existed. It is also who "me" is:
   * comments carrying this name are never unread, and an unread comment landing after one of them
   * is what the board calls a reply.
   */
  userName: string;
  /**
   * Read-state for comments, keyed by card path: the marker `seenMarker` builds for the newest
   * comment already seen on that card. Written when its detail panel is open. Never in the note —
   * "Rafa has read this" is personal to one install, not a fact the vault should carry to everyone
   * who has the file. A card missing from this map has never been opened, so all of its comments
   * count as unread.
   */
  commentsSeen: Record<string, string>;
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
  subitemsDefault: "expanded",
  collapsedCards: {},
  userName: "",
  commentsSeen: {},
};

export const DETAIL_WIDTH_MIN = 280;
export const DETAIL_WIDTH_MAX = 720;
