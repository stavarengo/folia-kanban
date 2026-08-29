import { MCP_DEFAULT_BIND_ADDRESS } from "./mcp/bindAddress";
import {
  DEFAULT_SETTINGS,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  MCP_PORT_MAX,
  MCP_PORT_MIN,
  type KanbanSettings,
} from "./settings";

// The settings tab as data: what it offers, in what order, under which headings, worded how, and
// what makes a row go inert. Both renderings read it — the declarative definitions Obsidian 1.13
// and later index for the settings search (`./settingsDefinitions`) and the imperative tab
// `src/main.ts` draws below that — so the tab is one tab whichever API is there.

/**
 * The settings a user edits from the settings tab. The rest of `KanbanSettings` is bookkeeping the
 * plugin writes for itself (`collapsedCards`, `commentsSeen`, `commentsBaseline`) and never shows.
 */
export type EditableSettingKey =
  | "boardNoteDefaultView"
  | "detailPresentation"
  | "sidePanelMode"
  | "detailWidth"
  | "addCardFlow"
  | "addCardOpenMode"
  | "cardNextTodos"
  | "subitemsDefault"
  | "userName"
  | "historyScope"
  | "boardPan"
  | "boardSetupCommands"
  | "boardSetupFileMenu"
  | "boardSetupEditorMenu"
  | "mcpEnabled"
  | "mcpPort"
  | "mcpBindAddress";

/** The settings that are a plain on/off. Kept as a value, not only a type, so `settingsPatchFor`
 *  can recognise one at runtime — a boolean reaching the dropdown branch would be refused. */
export const TOGGLE_SETTING_KEYS = [
  "boardSetupCommands",
  "boardSetupFileMenu",
  "boardSetupEditorMenu",
  "mcpEnabled",
] as const satisfies readonly EditableSettingKey[];

/** Every setting whose control is a dropdown, i.e. one with a fixed list of choices. */
export type DropdownKey = Exclude<
  EditableSettingKey,
  | "detailWidth"
  | "cardNextTodos"
  | "userName"
  | "mcpPort"
  | "mcpBindAddress"
  | (typeof TOGGLE_SETTING_KEYS)[number]
>;

/**
 * The choices of every dropdown setting, value -> label, in the order they are offered. Typed
 * against `KanbanSettings` so a value that is not part of a setting's union is a compile error, and
 * used as the single source for both the option list and the validation `settingsPatchFor` runs.
 */
export const SETTING_OPTIONS = {
  boardNoteDefaultView: { board: "The board", markdown: "The markdown editor" },
  detailPresentation: { side: "Side panel", modal: "Modal dialog" },
  sidePanelMode: { split: "Split (shrink the board)", float: "Float (overlay the columns)" },
  addCardFlow: {
    inline: "Inline",
    "inline-edit": "Inline, then open details",
    detail: "Open details to create",
  },
  addCardOpenMode: {
    default: "Use the card-details setting",
    modal: "Modal dialog",
    "side-float": "Side panel (float)",
    "side-split": "Side panel (split)",
  },
  subitemsDefault: { expanded: "Expanded", collapsed: "Collapsed" },
  historyScope: { moves: "Moves only", structural: "Structural changes", all: "Everything" },
  boardPan: { shift: "Shift + click and drag", empty: "Click and drag (empty space only)" },
} as const satisfies { [K in DropdownKey]: Record<KanbanSettings[K] & string, string> };

/**
 * Name and description of every row of the settings tab. Both renderings read from here — the
 * imperative `display()` that Obsidian below 1.13 calls, and the declarative definitions 1.13 and
 * later index for the settings search — so their wording cannot drift apart.
 *
 * Names are short because {@link SETTING_GROUPS} puts each row under a heading that already says
 * what it is about, and a description says what a choice *does* rather than listing the options the
 * control is about to list anyway. What a row depends on is part of its description, in words, and
 * stays there whether or not the row is disabled at that moment — a greyed row with no explanation
 * is the thing this tab was rebuilt to stop doing.
 */
export const SETTING_COPY = {
  boardNoteDefaultView: {
    name: "Open board notes as",
    desc: "Which view a note carrying `folia-board: true` opens in, wherever it is opened from. A single note overrides this with `folia-view: board` or `folia-view: markdown` of its own, and the button in the tab header swaps between the two at any time.",
  },
  detailPresentation: {
    name: "Show details in",
    desc: "Where a card's details open: a panel docked beside the board, or a dialog centred over it.",
  },
  sidePanelMode: {
    name: "Side panel layout",
    desc: "Split shrinks the board to make room for the panel; float lets the panel overlay the columns. Only used when “Show details in” is the side panel — a new card's details, opened by the add-card setting into a panel of their own, carry the layout that setting names.",
  },
  detailWidth: {
    name: "Side panel width",
    desc: "How wide the docked panel is whenever a card's details open in one, in pixels — including when the add-card setting below opens a panel over a modal presentation. Dragging the panel's left border changes this too.",
  },
  addCardFlow: {
    name: "Add-card flow",
    desc: "What the add-card button does: add a card in place, add it and open its details, or open the details and create the card from there.",
  },
  addCardOpenMode: {
    name: "Open the new card's details in",
    desc: "Where a newly added card's details open. Only used by the two flows that open them.",
  },
  cardNextTodos: {
    name: "Next todos shown",
    desc: "How many of a card's next undone todos to preview on its tile. Zero shows none.",
  },
  subitemsDefault: {
    name: "Subitems default state",
    desc: "Whether a card's nested subitems (its inline todos preview and its subcard files) start expanded or collapsed. Toggling a card, or a column's collapse/expand-all, overrides this for that card from then on.",
  },
  userName: {
    name: "Your name",
    desc: "Signs the comments you write from the board (e.g. “alex” → “- _2026-08-21 11:49 @alex:_ …”), so your own comments never show as unread and a comment landing after one of yours reads as a reply. Leave empty to write comments unsigned.",
  },
  historyScope: {
    name: "What history records",
    desc: "Moves records card moves and reorders only; structural adds priority, status and due-date changes; everything adds comments, subtasks and blocking links on top.",
  },
  boardPan: {
    name: "Horizontal drag",
    desc: "How to pan the board sideways. Shift+drag pans from anywhere, including over cards; click and drag pans only from empty board space, leaving cards and columns free to be dragged themselves. Middle-button drag always pans.",
  },
  boardSetupCommands: {
    name: "Board setup in the command palette",
    desc: "Offer the two board-setup actions there: make a new note that is already a board, or add the board properties to the note you have open.",
  },
  boardSetupFileMenu: {
    name: "Board setup in the file menu",
    desc: "Offer them wherever Obsidian gives a file or folder a menu — the file explorer, a tab header, a note's “More options”: on a folder, to make a board inside it; on a note, to turn that note into one.",
  },
  boardSetupEditorMenu: {
    name: "Board setup in the editor menu",
    desc: "Offer turning the note into a board from the right-click menu inside its editor.",
  },
  mcpEnabled: {
    name: "Enable agent access",
    desc: "Let AI agents read and change the boards in this vault through an MCP server the plugin hosts on this computer. Every change an agent makes goes through the board's own rules, so cards get the same history lines they get when you edit them by hand. It listens on this computer only (127.0.0.1) unless you change the bind address below. Desktop only; off until you turn it on. See docs/mcp.md for how to connect a client.",
  },
  mcpPort: {
    name: "Server port",
    desc: `The port the server listens on (${MCP_PORT_MIN}–${MCP_PORT_MAX}). Change it if something else on this computer already holds it. Only used while agent access is on.`,
  },
  mcpBindAddress: {
    name: "Bind address",
    desc: `The address the server listens on. ${MCP_DEFAULT_BIND_ADDRESS} (the default) keeps it on this computer: nothing else can reach it, whatever the network. Any other address — 0.0.0.0 for every IPv4 address this computer has, :: for every address, or one particular interface — puts the board on that network, where any machine that can reach the address and holds the token can read and change every board in this vault. Use it when the client runs somewhere else (a container reaches its host through the gateway address, never through the host's loopback), and know that the token is then the only thing in the way. An IP address, not a name: 0.0.0.0 asks for every IPv4 address this computer has and :: for every address it has, while anything else has to be one it actually has, or the server will not start. Only used while agent access is on.`,
  },
} as const satisfies Record<EditableSettingKey, { name: string; desc: string }>;

/**
 * The control a row is drawn with, so both renderings build the same row from one description
 * instead of each spelling every row out. A dropdown's options are not repeated here: they live in
 * {@link SETTING_OPTIONS}, which is what `settingsPatchFor` validates against.
 */
export type RowControlSpec =
  | { kind: "dropdown"; options: Record<string, string> }
  | { kind: "toggle" }
  | { kind: "slider"; min: number; max: number; step: number }
  | { kind: "text"; placeholder: string }
  | { kind: "held" };

/** Placeholder shown in the "Your name" field. */
export const USER_NAME_PLACEHOLDER = "Alex";

/** Upper bound of the next-todos preview: more than a handful stops being a preview. */
export const CARD_NEXT_TODOS_MAX = 5;

/** What each row is drawn with. `held` means the row draws itself — see {@link heldFieldOutcome}. */
export const SETTING_CONTROLS = {
  boardNoteDefaultView: { kind: "dropdown", options: SETTING_OPTIONS.boardNoteDefaultView },
  detailPresentation: { kind: "dropdown", options: SETTING_OPTIONS.detailPresentation },
  sidePanelMode: { kind: "dropdown", options: SETTING_OPTIONS.sidePanelMode },
  detailWidth: { kind: "slider", min: DETAIL_WIDTH_MIN, max: DETAIL_WIDTH_MAX, step: 10 },
  addCardFlow: { kind: "dropdown", options: SETTING_OPTIONS.addCardFlow },
  addCardOpenMode: { kind: "dropdown", options: SETTING_OPTIONS.addCardOpenMode },
  cardNextTodos: { kind: "slider", min: 0, max: CARD_NEXT_TODOS_MAX, step: 1 },
  subitemsDefault: { kind: "dropdown", options: SETTING_OPTIONS.subitemsDefault },
  userName: { kind: "text", placeholder: USER_NAME_PLACEHOLDER },
  historyScope: { kind: "dropdown", options: SETTING_OPTIONS.historyScope },
  boardPan: { kind: "dropdown", options: SETTING_OPTIONS.boardPan },
  boardSetupCommands: { kind: "toggle" },
  boardSetupFileMenu: { kind: "toggle" },
  boardSetupEditorMenu: { kind: "toggle" },
  mcpEnabled: { kind: "toggle" },
  mcpPort: { kind: "held" },
  mcpBindAddress: { kind: "held" },
} as const satisfies Record<EditableSettingKey, RowControlSpec>;

/**
 * A section of the tab: a heading and the rows under it, in the order they are shown. This is the
 * whole shape of the settings tab, and both renderings walk it — so the grouping and the order are
 * one thing, not two that drift.
 *
 * The order runs from what a user changes to make the plugin fit their vault down to what most
 * vaults never touch: how board notes open, then what a card's details look like, then the cards
 * themselves, then adding one, then who is writing and what gets recorded, then agent access.
 */
export interface SettingGroupSpec {
  /** Identifies the group in code — the agent-access one is desktop-only and carries token rows. */
  id: "boards" | "cardDetails" | "cards" | "addingCards" | "identity" | "agentAccess";
  heading: string;
  keys: readonly EditableSettingKey[];
}

export const SETTING_GROUPS = [
  {
    id: "boards",
    heading: "Boards and board notes",
    keys: [
      "boardNoteDefaultView",
      "boardPan",
      "boardSetupCommands",
      "boardSetupFileMenu",
      "boardSetupEditorMenu",
    ],
  },
  {
    id: "cardDetails",
    heading: "Card details",
    keys: ["detailPresentation", "sidePanelMode", "detailWidth"],
  },
  { id: "cards", heading: "Cards on the board", keys: ["cardNextTodos", "subitemsDefault"] },
  { id: "addingCards", heading: "Adding cards", keys: ["addCardFlow", "addCardOpenMode"] },
  { id: "identity", heading: "Comments and history", keys: ["userName", "historyScope"] },
  {
    id: "agentAccess",
    heading: "Agent access (MCP)",
    keys: ["mcpEnabled", "mcpPort", "mcpBindAddress"],
  },
] as const satisfies readonly SettingGroupSpec[];

/**
 * Extra words the 1.13 settings search should find a row by. Short names read better under a
 * heading but they take words with them — a row called "Side panel layout" no longer contains
 * "card details", and the heading above it is not indexed. Each row therefore carries its own
 * heading plus whatever it used to be called, so a search that used to land on it still does.
 */
export const EXTRA_ALIASES: Partial<Record<EditableSettingKey, readonly string[]>> = {
  boardNoteDefaultView: ["default view", "folia-view", "markdown editor"],
  detailPresentation: ["presentation", "modal", "side panel"],
  sidePanelMode: ["split", "float", "overlay"],
  detailWidth: ["panel width", "pixels", "resize"],
  addCardFlow: ["add card button", "new card", "inline"],
  addCardOpenMode: ["add card", "new card", "modal"],
  cardNextTodos: ["todos", "checklist", "preview"],
  subitemsDefault: ["subcards", "collapse", "expand"],
  userName: ["comments", "author", "signature", "unread"],
  historyScope: ["history scope", "log", "audit"],
  boardPan: ["pan", "scroll sideways", "shift"],
  boardSetupCommands: ["board setup", "create board", "convert to board"],
  boardSetupFileMenu: ["board setup", "create board", "convert to board", "file explorer"],
  boardSetupEditorMenu: ["board setup", "convert to board", "right-click"],
  mcpEnabled: ["mcp", "agent", "server"],
  // Taken from the defaults rather than typed out again: a release that moves either would
  // otherwise leave the search pointing at a value nothing uses.
  mcpPort: ["mcp", "port", String(DEFAULT_SETTINGS.mcpPort)],
  mcpBindAddress: ["mcp", "bind", MCP_DEFAULT_BIND_ADDRESS, "loopback", "network"],
};

/** What a row needs the settings to say before it means anything. A row whose dependency is not met
 *  is disabled rather than hidden: a setting that vanishes is a setting nobody can find again. The
 *  words that explain the dependency live in {@link SETTING_COPY}, always visible. */
const ROW_DISABLED: Partial<Record<EditableSettingKey, (s: KanbanSettings) => boolean>> = {
  // The layout dropdown goes inert under a modal presentation because the one other way a panel
  // opens — "Open the new card's details in", set to a side value — names its own layout and never
  // reads this. The width is deliberately NOT gated the same way: the panel reads it however it was
  // opened, so greying it would be a lie the moment that override is used.
  sidePanelMode: (s) => s.detailPresentation === "modal",
  addCardOpenMode: (s) => s.addCardFlow === "inline",
  mcpPort: (s) => !s.mcpEnabled,
  mcpBindAddress: (s) => !s.mcpEnabled,
};

/** The rows that go inert under another setting. Exported so the guard that every one of them
 *  explains itself can reach all of them, rather than the handful someone remembered to list. */
export const DEPENDENT_SETTING_KEYS = Object.keys(ROW_DISABLED) as EditableSettingKey[];

/** Whether a row is inert as the settings currently stand. Both renderings ask this, so a row
 *  cannot be live on one path and greyed on the other. */
export function isRowDisabled(key: EditableSettingKey, settings: KanbanSettings): boolean {
  return ROW_DISABLED[key]?.(settings) ?? false;
}

/** The rows whose new value changes which *other* rows exist or are live, so the imperative tab has
 *  to be drawn again rather than left as it is. */
export const TAB_REDRAW_KEYS = ["detailPresentation", "addCardFlow", "mcpEnabled"] as const;

/** The row that hands the bearer token over; not a setting the user edits, so it stands apart. */
export const MCP_TOKEN_COPY = {
  name: "Agent token",
  desc: "The bearer token an agent must send. Copy it into your MCP client's configuration. Treat it as a password: anything holding it can change every board in this vault. There is no token until agent access is on.",
  button: "Copy token",
  copied: "Token copied to the clipboard.",
  missing: "Turn agent access on first — the token is generated then.",
} as const;

/**
 * The row that replaces the token. A password that cannot be changed is only a password until it
 * leaks: pasted into the wrong window, committed with a config file, read off a shared screen.
 * Switching agent access off and on again keeps the same token by design, so without this the only
 * way out is hand-editing the plugin's data file.
 */
export const MCP_TOKEN_REGENERATE = {
  name: "Replace the token",
  desc: "Issue a new token and forget the old one. Every client configured with the old one stops being able to reach this vault until you paste the new one in. There is nothing to replace until agent access is on.",
  button: "Replace token",
  done: "New token generated and copied to the clipboard.",
  replacedNotCopied:
    "New token generated, but it could not be copied to the clipboard. Use Copy token to get it.",
  replacedButDown:
    "New token generated, but the server did not come back up on it. Check the port and bind-address settings.",
  missing: "Turn agent access on first — the token is generated then.",
} as const;

/**
 * The heading the version row sits under, and the row's own label.
 *
 * The heading is not decoration. Below Obsidian 1.13 a heading is a row, not a container — a
 * `Setting` with `setHeading()` and siblings after it — so a version row appended after the last
 * section would read as part of that section, which on desktop is agent access. Giving it a
 * heading of its own is what makes the two tabs say the same thing.
 */
export const ABOUT_HEADING = "About";

/** Label of the row that reports the installed version. */
export const VERSION_SETTING_NAME = "Version";
