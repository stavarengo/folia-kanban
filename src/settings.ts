import { MCP_DEFAULT_BIND_ADDRESS, isBindAddress } from "./mcp/bindAddress";
import type { FileOp } from "./model/pathOps";
import { remapPathKeys } from "./model/pathOps";
import type { HistoryScope } from "./model/types";
import type { BoardViewMode } from "./viewMode";

/** Where the MCP server listens by default. Neighbour of the Local REST API plugin's 27124. */
const MCP_DEFAULT_PORT = 27125;

/** The range a port setting is held to: the unprivileged ports. */
export const MCP_PORT_MIN = 1024;
export const MCP_PORT_MAX = 65535;

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
  /**
   * Whether the plugin hosts an MCP server so agents can drive the boards in this vault. Off until
   * the user turns it on, desktop only, and bound to loopback unless `mcpBindAddress` says
   * otherwise — see `docs/mcp.md`.
   */
  mcpEnabled: boolean;
  /** The port that server listens on. */
  mcpPort: number;
  /**
   * The address that server binds to. `127.0.0.1` (the default) keeps it reachable from this
   * machine only; anything else — `0.0.0.0` for every address this machine has, or one particular
   * interface — puts it on that network, where any host that has the token can drive every board
   * in this vault. See `docs/mcp.md`.
   */
  mcpBindAddress: string;
  /**
   * The bearer token every MCP request must carry, generated on this install the first time the
   * server is switched on and kept afterwards — a token that changed on each load would break the
   * agent configured against it. Empty means "none generated yet", and the server stays off.
   */
  mcpToken: string;
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

/** The plain patch a write means: the function form resolved against the settings as they are at
 *  the moment of writing. Empty when the write changes nothing. */
export function resolveSettingsPatch(
  current: KanbanSettings,
  patch: SettingsPatch,
): Partial<KanbanSettings> {
  return typeof patch === "function" ? patch(current) : patch;
}

/** Returns `current` itself (same reference) when the patch has nothing in it, so callers can skip
 *  the refresh and the disk write an empty patch would otherwise cost. */
export function applySettingsPatch(current: KanbanSettings, patch: SettingsPatch): KanbanSettings {
  const p = resolveSettingsPatch(current, patch);
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
  mcpEnabled: false,
  mcpPort: MCP_DEFAULT_PORT,
  mcpBindAddress: MCP_DEFAULT_BIND_ADDRESS,
  mcpToken: "",
};

/**
 * Agent access switched on for the first time is when its token comes into existence: this is the
 * patch that mints it, or nothing at all. `mint` is called only then — a token that changed on each
 * load would break the client configured against it — and `desktop` is what keeps a phone from
 * minting a secret for a server it can never run. A patch rather than whole settings because the
 * token has to reach {@link StoredSettings}: minted into the running copy alone it would be
 * re-minted on every launch, silently breaking the client already configured with the old one.
 */
export function mcpTokenPatch(
  settings: KanbanSettings,
  mint: () => string,
  desktop: boolean,
): Partial<KanbanSettings> {
  if (!settings.mcpEnabled || settings.mcpToken || !desktop) return {};
  return { mcpToken: mint() };
}

/**
 * What `data.json` holds: only the settings someone actually set — the user in the settings tab, or
 * the plugin writing its own bookkeeping (`collapsedCards`, `commentsSeen`, `commentsBaseline`,
 * `mcpToken`). Everything absent is answered by `DEFAULT_SETTINGS` at read time, which is what lets
 * a later release change a default and have it reach installs that never chose one, and what lets a
 * feature tell "never set" from a deliberate choice that happens to equal the default. Keys this
 * build does not know about are carried through untouched, so a file written by a newer one
 * survives being opened by an older one.
 */
export type StoredSettings = Partial<KanbanSettings>;

/** The key that says a stored file is already sparse, and the shape this build writes under it. Its
 *  *absence* is the whole test — a file carrying any format was written by a build that recorded
 *  what was set, and pruning one written by a later build would delete choices this build has no
 *  way to recognise. The number says which build wrote the file, not which builds may read it. */
export const SETTINGS_FORMAT_KEY = "settingsFormat";
export const SETTINGS_FORMAT = 2;

/** What is actually written to `data.json`: the sparse settings, marked with the shape they are in
 *  so the next load knows not to prune them again. */
export function settingsForDisk(stored: StoredSettings): Record<string, unknown> {
  return { [SETTINGS_FORMAT_KEY]: SETTINGS_FORMAT, ...stored };
}

/** The settings to run on: what someone set, with every other setting answered by its default. */
export function resolveSettings(stored: StoredSettings): KanbanSettings {
  return { ...DEFAULT_SETTINGS, ...stored };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a stored value is indistinguishable from the setting's default. Only ever asked of a
 *  legacy file, where every key is present and nothing says which of them were chosen. */
function equalsDefault(key: keyof KanbanSettings, value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS[key]);
}

/** What a load produced: the settings to run on, the sparse set to keep on disk, and whether that
 *  set differs from the file it came from and so has to be written back. */
export interface HydratedSettings {
  settings: KanbanSettings;
  stored: StoredSettings;
  needsSave: boolean;
}

/**
 * Settings as loaded from plugin data.
 *
 * A file carrying {@link SETTINGS_FORMAT_KEY} is taken at its word: every key in it was set on
 * purpose, including one whose value happens to equal the default, and every key missing from it
 * was never set. A file without the marker was written by a build that saved the whole merged
 * object on first launch, so it cannot say which of its values anyone chose. **The stated rule for
 * those:** a value equal to that setting's default is read as never set and dropped, once, and the
 * pruned file is marked. Nothing changes for the user — the setting still resolves to the same
 * value — but a later release is then free to move that default, and a value the user had
 * deliberately picked while it equalled the default would move with it. That trade is the price of
 * a file that never recorded the difference. It weighs most on `mcpPort` and `mcpBindAddress`,
 * where a moved default would move where a server listens, so a release that ever moves one of
 * those owes its own answer here.
 *
 * One install can also end up marked and frozen at once, and it is worth naming rather than
 * discovering: a `data.json` shared with a build that predates the marker — a synced vault, a
 * second machine on an older version — is rewritten whole by that build, defaults and marker
 * together, and this one then takes all of it at its word. Nothing breaks and nothing is lost; that
 * install simply keeps the frozen file it had, which is where every install started. The same holds
 * for a deliberate downgrade, and neither re-prunes, because the marker survives.
 *
 * Stored values that are not values at all are dropped rather than repaired in memory, so the file
 * heals instead of carrying the garbage forever, and the comments baseline is stamped with `now`
 * when nothing carries one.
 */
export function hydrateSettings(loaded: unknown, now: string): HydratedSettings {
  const stored: StoredSettings = isRecord(loaded) ? { ...loaded } : {};
  const legacy = !(SETTINGS_FORMAT_KEY in stored);
  delete (stored as Record<string, unknown>)[SETTINGS_FORMAT_KEY];
  let needsSave = legacy;
  if (dropUnusable(stored)) needsSave = true;
  if (legacy) pruneFrozenDefaults(stored);
  // Truthiness, not presence: an empty baseline is not a value anyone can have chosen — it is what
  // `DEFAULT_SETTINGS` carries to mean "no baseline at all", and `seenMarkerFor` reads it as absent
  // — so a stored "" is a file to repair, not a decision to respect.
  if (!stored.commentsBaseline) {
    stored.commentsBaseline = now;
    needsSave = true;
  }
  return { settings: resolveSettings(stored), stored, needsSave };
}

/** Drops what a hand-edited (or hand-corrupted) file carries where a value belongs. Dropped rather
 *  than repaired in the copy in memory, so the file heals on the next write instead of carrying the
 *  same garbage forever. Returns whether anything went. */
function dropUnusable(stored: StoredSettings): boolean {
  let dropped = false;
  const drop = (key: keyof KanbanSettings): void => {
    delete stored[key];
    dropped = true;
  };
  // Every tile reads these, so `null` for a map must not reach them.
  for (const key of ["collapsedCards", "commentsSeen"] as const)
    if (key in stored && !isRecord(stored[key])) drop(key);
  // Same reason, and it decides where a server listens: `null` here would reach `listen` as a
  // non-string and come back as "could not start on address null" with a TypeError attached.
  if (
    "mcpBindAddress" in stored &&
    !(typeof stored.mcpBindAddress === "string" && isBindAddress(stored.mcpBindAddress))
  )
    drop("mcpBindAddress");
  return dropped;
}

/** The one-time reading of a file that predates the marker: a value equal to its default is read as
 *  never set. See {@link hydrateSettings} for what that costs and why it is the rule. */
function pruneFrozenDefaults(stored: StoredSettings): void {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof KanbanSettings)[])
    if (key in stored && equalsDefault(key, stored[key])) delete stored[key];
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
 * Whether one card's nested subitems are collapsed right now: its own override if it has ever been
 * toggled, else the board-wide default. Stated here once because both the UI (the toggle, the
 * groups it unmounts) and the search tally (a match hidden inside a collapsed card is not on
 * screen) have to answer it the same way.
 */
export function isCollapsedIn(settings: KanbanSettings, path: string): boolean {
  return settings.collapsedCards[path] ?? settings.subitemsDefault === "collapsed";
}

/**
 * Every setting keyed by card path. One list, so a file operation that bypasses the plugin's own
 * actions keeps reaching all of them: adding the next path-keyed map means adding it here, not
 * finding this code again.
 */
type PathKeyedMap = {
  [K in keyof KanbanSettings]: KanbanSettings[K] extends Record<string, unknown> ? K : never;
}[keyof KanbanSettings];

// `satisfies` is what makes this a constraint rather than a convention: add a path-keyed map to
// `KanbanSettings` and typecheck fails here until it is listed, so the migration below cannot
// quietly fall behind the settings it is supposed to cover.
const PATH_KEYED_MAPS = {
  collapsedCards: true,
  commentsSeen: true,
} satisfies Record<PathKeyedMap, true>;

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
  for (const key of Object.keys(PATH_KEYED_MAPS) as PathKeyedMap[]) {
    const next = remapPathKeys<unknown>(settings[key], op);
    if (next) (patch as Record<string, unknown>)[key] = next;
  }
  return patch;
}

export const DETAIL_WIDTH_MIN = 280;
export const DETAIL_WIDTH_MAX = 720;
