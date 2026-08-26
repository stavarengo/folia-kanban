import type { FileOp } from "./model/pathOps";
import { remapPathKeys } from "./model/pathOps";
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
  /** Whether the board-setup actions (create a board, convert a note into one) are offered in the
   *  command palette. */
  boardSetupCommands: boolean;
  /** Whether they are offered wherever Obsidian gives a file or folder a menu (the file explorer, a
   *  tab header, "More options") — on a folder to create a board inside it, on a note to convert
   *  that note. */
  boardSetupFileMenu: boolean;
  /** Whether converting is offered in the right-click menu inside a note's editor. */
  boardSetupEditorMenu: boolean;
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
   * who has the file. A card missing from this map has never been opened on this install, so it
   * falls back to `commentsBaseline`.
   */
  commentsSeen: Record<string, string>;
  /**
   * The moment unread tracking started on this install, as a `stamp()` timestamp, set once by
   * `hydrateSettings` when the stored data has none (first run after installing or upgrading) and
   * never changed after that. It stands in for the marker of every card without a `commentsSeen`
   * entry: comments written up to that minute count as already read, later ones as unread. Without
   * it, the first board opened after an upgrade would light up every card that has ever been
   * commented on. The whole first minute is on the read side (it is a bare marker, no `#count`), so
   * a comment by someone else landing in that same minute goes unnoticed — accepted, one minute
   * once per install. Empty only in `DEFAULT_SETTINGS`, where it means "no baseline, everything
   * counts".
   */
  commentsBaseline: string;
}

/**
 * What a settings write accepts: a plain patch, or a function of the settings as they are at the
 * moment of writing. The function form is for patches that replace one of the path-keyed maps
 * (`collapsedCards`, `commentsSeen`): built from a render's snapshot, two board views writing back
 * to back would each replace the map with their own copy and the second would drop the first's entry.
 */
export type SettingsPatch =
  | Partial<KanbanSettings>
  | ((current: KanbanSettings) => Partial<KanbanSettings>);

/** Returns `current` itself (same reference) when the patch has nothing in it, so callers can skip
 *  the refresh and the disk write an empty patch would otherwise cost. */
export function applySettingsPatch(current: KanbanSettings, patch: SettingsPatch): KanbanSettings {
  const p = typeof patch === "function" ? patch(current) : patch;
  return Object.keys(p).length === 0 ? current : { ...current, ...p };
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
  boardSetupCommands: true,
  boardSetupFileMenu: true,
  boardSetupEditorMenu: true,
  subitemsDefault: "expanded",
  collapsedCards: {},
  userName: "",
  commentsSeen: {},
  commentsBaseline: "",
};

/**
 * Settings as loaded from plugin data: defaults filled in, and the comments baseline stamped with
 * `now` when the stored data carries none. `stampedBaseline` tells the caller to persist that.
 */
export function hydrateSettings(
  loaded: unknown,
  now: string,
): { settings: KanbanSettings; stampedBaseline: boolean } {
  const settings: KanbanSettings = Object.assign({}, DEFAULT_SETTINGS, loaded);
  // A hand-edited data.json can carry `null` for a map; every tile reads these, so it must not.
  if (!settings.collapsedCards) settings.collapsedCards = {};
  if (!settings.commentsSeen) settings.commentsSeen = {};
  if (settings.commentsBaseline) return { settings, stampedBaseline: false };
  return { settings: { ...settings, commentsBaseline: now }, stampedBaseline: true };
}

/**
 * The seen-marker to judge a card's comments against: its own entry when it has been opened here,
 * otherwise the install-time baseline. `undefined` only when neither exists, which makes every
 * comment unread.
 */
export function seenMarkerFor(settings: KanbanSettings, path: string): string | undefined {
  return settings.commentsSeen[path] ?? (settings.commentsBaseline || undefined);
}

/**
 * Every setting keyed by card path. One list, so a file operation that bypasses the plugin's own
 * actions keeps reaching all of them: adding the next path-keyed map means adding it here, not
 * finding this code again.
 */
type PathKeyedMap = {
  [K in keyof KanbanSettings]: KanbanSettings[K] extends Record<string, unknown> ? K : never;
}[keyof KanbanSettings];

const PATH_KEYED_MAPS: readonly PathKeyedMap[] = ["collapsedCards", "commentsSeen"];

/**
 * The settings patch that follows a card file being renamed, moved, or deleted from outside the
 * board. Empty when the operation touched nothing this install remembers, so an unrelated vault
 * edit costs no write.
 */
export function migratePathKeyedSettings(
  settings: KanbanSettings,
  op: FileOp,
): Partial<KanbanSettings> {
  const patch: Partial<KanbanSettings> = {};
  for (const key of PATH_KEYED_MAPS) {
    const next = remapPathKeys<unknown>(settings[key], op);
    if (next) (patch as Record<string, unknown>)[key] = next;
  }
  return patch;
}

export const DETAIL_WIDTH_MIN = 280;
export const DETAIL_WIDTH_MAX = 720;
