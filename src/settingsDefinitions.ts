import type { SettingDefinitionItem } from "obsidian";
import { DETAIL_WIDTH_MAX, DETAIL_WIDTH_MIN, type KanbanSettings } from "./settings";

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
  | "boardPan";

type DropdownKey = Exclude<EditableSettingKey, "detailWidth" | "cardNextTodos" | "userName">;

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
    desc: "Moves = card moves/reorders only (default); structural = also priority/status/due/order changes; all = also comments + subtasks.",
  },
  boardPan: {
    name: "Board — horizontal drag",
    desc: "How to pan the board sideways. Shift+drag pans from anywhere (incl. over cards); click and drag pans only from empty board space, leaving cards and columns free. Middle-button drag always pans.",
  },
} as const satisfies Record<EditableSettingKey, { name: string; desc: string }>;

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

/**
 * The settings patch a control's new value means, or `null` when the value is not one this setting
 * accepts. Obsidian hands `setControlValue` an `unknown`, and a hand-edited `data.json` or a future
 * control type could hand over anything, so every value is checked against the setting's own domain
 * before it reaches the stored settings.
 */
export function settingsPatchFor(key: string, value: unknown): Partial<KanbanSettings> | null {
  switch (key) {
    case "detailWidth": {
      const n = Math.round(Number(value));
      return Number.isFinite(n)
        ? { detailWidth: clamp(n, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX) }
        : null;
    }
    case "cardNextTodos": {
      const n = Math.round(Number(value));
      return Number.isFinite(n) ? { cardNextTodos: clamp(n, 0, CARD_NEXT_TODOS_MAX) } : null;
    }
    case "userName":
      return typeof value === "string" ? { userName: value.trim() } : null;
    default: {
      if (!hasOwn(SETTING_OPTIONS, key)) return null;
      const options: Record<string, string> = SETTING_OPTIONS[key as DropdownKey];
      if (typeof value !== "string" || !hasOwn(options, value)) return null;
      // `key` is a DropdownKey and `value` one of the option keys `SETTING_OPTIONS` types against
      // that setting's own union, which is what makes this a valid patch for it.
      return { [key]: value };
    }
  }
}

/**
 * The settings tab as data, for Obsidian 1.13 and later: it renders the tab from these and indexes
 * them for the settings search. `read` is called on every evaluation of a `disabled` predicate, so
 * the rows that depend on another setting follow it without a re-render.
 */
export function settingDefinitions(
  read: () => KanbanSettings,
  version: string,
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
    // Read from the manifest so it always reflects the installed build, never a hardcoded value.
    { name: VERSION_SETTING_NAME, desc: version },
  ];
}
