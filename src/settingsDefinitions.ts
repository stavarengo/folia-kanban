import type { SettingDefinitionItem } from "obsidian";
import {
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  MCP_PORT_MAX,
  MCP_PORT_MIN,
  type KanbanSettings,
} from "./settings";

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
  | "mcpPort";

/** The settings that are a plain on/off. Kept as a value, not only a type, so `settingsPatchFor`
 *  can recognise one at runtime — a boolean reaching the dropdown branch would be refused. */
export const TOGGLE_SETTING_KEYS = [
  "boardSetupCommands",
  "boardSetupFileMenu",
  "boardSetupEditorMenu",
  "mcpEnabled",
] as const satisfies readonly EditableSettingKey[];

type ToggleKey = (typeof TOGGLE_SETTING_KEYS)[number];

const isToggleKey = (key: string): key is ToggleKey =>
  (TOGGLE_SETTING_KEYS as readonly string[]).includes(key);

type DropdownKey = Exclude<
  EditableSettingKey,
  "detailWidth" | "cardNextTodos" | "userName" | "mcpPort" | ToggleKey
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
 */
export const SETTING_COPY = {
  boardNoteDefaultView: {
    name: "Board notes — open as",
    desc: "How a note with `folia-board: true` opens from the file explorer, a link, search or the quick switcher. A single note can override this with `folia-view: board` or `folia-view: markdown` in its own frontmatter, and the button in the tab header swaps between the two at any time.",
  },
  detailPresentation: {
    name: "Card details — presentation",
    desc: "How the card detail view is shown.",
  },
  sidePanelMode: {
    name: "Side panel — layout",
    desc: "Split shrinks the board to make room; float overlays the columns.",
  },
  detailWidth: {
    name: "Side panel — width (px)",
    desc: "Width of the side detail panel.",
  },
  addCardFlow: {
    name: "Add-card button — flow",
    desc: "Inline adds a card in place; inline-edit then opens the new card's details; detail opens the details to create.",
  },
  addCardOpenMode: {
    name: "Add-card — open new card's details as",
    desc: "How the new card's details open (only used when the flow opens details).",
  },
  cardNextTodos: {
    name: "Card — next todos shown",
    desc: "How many of the next undone todos to preview on each card (0 = none).",
  },
  subitemsDefault: {
    name: "Subitems — default state",
    desc: "Whether a card's nested subitems (inline todos preview + subcard files) start expanded or collapsed. Toggling a card, or a column's collapse/expand-all, overrides this per card.",
  },
  userName: {
    name: "Your name",
    desc: "Signs the comments you write from the board (e.g. “alex” → “- _2026-08-21 11:49 @alex:_ …”), so your own comments never show as unread and a comment landing after one of yours reads as a reply. Leave empty to write comments unsigned.",
  },
  historyScope: {
    name: "History — what to record",
    desc: "Moves = card moves/reorders only; structural = also priority/status/due/order changes; all = also comments + subtasks (the default).",
  },
  boardPan: {
    name: "Board — horizontal drag",
    desc: "How to pan the board sideways. Shift+drag pans from anywhere (incl. over cards); click and drag pans only from empty board space, leaving cards and columns free. Middle-button drag always pans.",
  },
  boardSetupCommands: {
    name: "Board setup — command palette",
    desc: "Offer the two board-setup actions in the command palette: one makes a new note that is already a board, the other adds the board properties to the note you have open.",
  },
  boardSetupFileMenu: {
    name: "Board setup — file menu",
    desc: "Offer them wherever Obsidian gives a file or folder a menu — the file explorer, a tab header, a note's “More options”: on a folder, to make a board inside it; on a note, to turn that note into one.",
  },
  boardSetupEditorMenu: {
    name: "Board setup — editor menu",
    desc: "Offer turning the note into a board from the right-click menu inside its editor.",
  },
  mcpEnabled: {
    name: "Agent access (MCP) — enable",
    desc: "Let AI agents read and change the boards in this vault through an MCP server the plugin hosts on this computer only (127.0.0.1). Every change an agent makes goes through the board's own rules, so cards get the same history lines they get when you edit them by hand. Desktop only; off until you turn it on. See docs/mcp.md for how to connect a client.",
  },
  mcpPort: {
    name: "Agent access (MCP) — port",
    desc: `The loopback port the server listens on (${MCP_PORT_MIN}–${MCP_PORT_MAX}). Change it if something else on this computer already holds it.`,
  },
} as const satisfies Record<EditableSettingKey, { name: string; desc: string }>;

/** The row that hands the bearer token over; not a setting the user edits, so it stands apart. */
export const MCP_TOKEN_COPY = {
  name: "Agent access (MCP) — token",
  desc: "The bearer token an agent must send. Copy it into your MCP client's configuration. Treat it as a password: anything holding it can change every board in this vault.",
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
  name: "Agent access (MCP) — replace token",
  desc: "Issue a new token and forget the old one. Every client configured with the old one stops being able to reach this vault until you paste the new one in.",
  button: "Replace token",
  done: "New token generated and copied to the clipboard.",
  replacedNotCopied:
    "New token generated, but it could not be copied to the clipboard. Use Copy token to get it.",
  replacedButDown:
    "New token generated, but the server did not come back up on it. Check the port setting.",
  missing: "Turn agent access on first — the token is generated then.",
} as const;

/** Placeholder shown in the "Your name" field. */
export const USER_NAME_PLACEHOLDER = "Alex";

/** Label of the row that reports the installed version. */
export const VERSION_SETTING_NAME = "Version";

/** Upper bound of the next-todos preview: more than a handful stops being a preview. */
export const CARD_NEXT_TODOS_MAX = 5;

/** `Object.hasOwn` needs a newer lib target than this build sets; the prototype chain must stay out
 *  of these lookups, so a key like "toString" cannot pass for a setting. */
const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** A control's value as a number, or `null` when it is not one. Deliberately not `Number(value)`:
 *  that reads `null`, `true` and `""` as 0 or 1, so a malformed change event would quietly move a
 *  setting to the bottom of its range instead of being refused. */
const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The settings patch a control's new value means, or `null` when the value is not one this setting
 * accepts. Obsidian hands `setControlValue` an `unknown`, and a hand-edited `data.json` or a future
 * control type could hand over anything, so every value is checked against the setting's own domain
 * before it reaches the stored settings.
 */
export function settingsPatchFor(key: string, value: unknown): Partial<KanbanSettings> | null {
  if (isToggleKey(key)) return typeof value === "boolean" ? { [key]: value } : null;
  if (key === "userName") return typeof value === "string" ? { userName: value.trim() } : null;
  return numberPatchFor(key, value) ?? dropdownPatchFor(key, value);
}

/** The bounds of every setting that is a number, so a value out of range is pulled in, not refused. */
const NUMBER_RANGES = {
  detailWidth: [DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX],
  cardNextTodos: [0, CARD_NEXT_TODOS_MAX],
  mcpPort: [MCP_PORT_MIN, MCP_PORT_MAX],
} as const satisfies Partial<Record<EditableSettingKey, readonly [number, number]>>;

/** The patch a numeric setting's new value means, or `null` when `key` is not one, or not a number. */
function numberPatchFor(key: string, value: unknown): Partial<KanbanSettings> | null {
  if (!hasOwn(NUMBER_RANGES, key)) return null;
  const [min, max] = NUMBER_RANGES[key as keyof typeof NUMBER_RANGES];
  const n = toNumber(value);
  return n === null ? null : { [key]: clamp(Math.round(n), min, max) };
}

/** The patch a dropdown's new value means, or `null` when the setting does not offer that value. */
function dropdownPatchFor(key: string, value: unknown): Partial<KanbanSettings> | null {
  if (!hasOwn(SETTING_OPTIONS, key)) return null;
  const options: Record<string, string> = SETTING_OPTIONS[key as DropdownKey];
  if (typeof value !== "string" || !hasOwn(options, value)) return null;
  // `key` is a DropdownKey and `value` one of the option keys `SETTING_OPTIONS` types against that
  // setting's own union, which is what makes this a valid patch for it.
  return { [key]: value };
}

/**
 * The settings tab as data, for Obsidian 1.13 and later: it renders the tab from these and indexes
 * them for the settings search. A `disabled` predicate reads the settings as they are when it runs,
 * which is on each render and on each `refreshDomState()` — that is how a row depending on another
 * setting catches up without the tab being redrawn.
 */
export function settingDefinitions(
  read: () => KanbanSettings,
  version: string,
  tokenActions: { copy: () => void; regenerate: () => void },
  desktop: boolean,
): SettingDefinitionItem[] {
  const dropdown = (key: DropdownKey, disabled?: () => boolean): SettingDefinitionItem => ({
    ...SETTING_COPY[key],
    control: {
      type: "dropdown",
      key,
      options: SETTING_OPTIONS[key],
      ...(disabled ? { disabled } : {}),
    },
  });

  const toggle = (key: ToggleKey): SettingDefinitionItem => ({
    ...SETTING_COPY[key],
    control: { type: "toggle", key },
    // A phone cannot listen for connections, so the row that promises it can does not appear —
    // rather than switching on, minting a token and quietly doing nothing.
    ...(key === "mcpEnabled" ? { visible: desktop } : {}),
  });

  return [
    dropdown("boardNoteDefaultView"),
    dropdown("detailPresentation"),
    dropdown("sidePanelMode", () => read().detailPresentation === "modal"),
    {
      ...SETTING_COPY.detailWidth,
      control: {
        type: "slider",
        key: "detailWidth",
        min: DETAIL_WIDTH_MIN,
        max: DETAIL_WIDTH_MAX,
        step: 10,
      },
    },
    dropdown("addCardFlow"),
    dropdown("addCardOpenMode", () => read().addCardFlow === "inline"),
    {
      ...SETTING_COPY.cardNextTodos,
      control: { type: "slider", key: "cardNextTodos", min: 0, max: CARD_NEXT_TODOS_MAX, step: 1 },
    },
    dropdown("subitemsDefault"),
    {
      ...SETTING_COPY.userName,
      control: { type: "text", key: "userName", placeholder: USER_NAME_PLACEHOLDER },
    },
    dropdown("historyScope"),
    dropdown("boardPan"),
    ...TOGGLE_SETTING_KEYS.map(toggle),
    {
      ...SETTING_COPY.mcpPort,
      visible: desktop,
      control: {
        type: "number",
        key: "mcpPort",
        min: MCP_PORT_MIN,
        max: MCP_PORT_MAX,
        step: 1,
        disabled: () => !read().mcpEnabled,
      },
    },
    {
      name: MCP_TOKEN_COPY.name,
      desc: MCP_TOKEN_COPY.desc,
      visible: desktop,
      action: tokenActions.copy,
      disabled: () => !read().mcpEnabled,
    },
    {
      name: MCP_TOKEN_REGENERATE.name,
      desc: MCP_TOKEN_REGENERATE.desc,
      visible: desktop,
      action: tokenActions.regenerate,
      disabled: () => !read().mcpEnabled,
    },
    // Read from the manifest so it always reflects the installed build, never a hardcoded value.
    { name: VERSION_SETTING_NAME, desc: version },
  ];
}
