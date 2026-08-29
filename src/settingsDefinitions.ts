import type { Setting, SettingDefinition, SettingDefinitionItem } from "obsidian";
import { isBindAddress, normalizeBindAddress } from "./mcp/bindAddress";
import {
  CARD_NEXT_TODOS_MAX,
  EXTRA_ALIASES,
  MCP_TOKEN_COPY,
  MCP_TOKEN_REGENERATE,
  SETTING_CONTROLS,
  SETTING_COPY,
  SETTING_GROUPS,
  SETTING_OPTIONS,
  TOGGLE_SETTING_KEYS,
  ABOUT_HEADING,
  VERSION_SETTING_NAME,
  isRowDisabled,
  type DropdownKey,
  type EditableSettingKey,
  type RowControlSpec,
} from "./settingsLayout";
import {
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  MCP_PORT_MAX,
  MCP_PORT_MIN,
  type KanbanSettings,
} from "./settings";

type ToggleKey = (typeof TOGGLE_SETTING_KEYS)[number];

const isToggleKey = (key: string): key is ToggleKey =>
  (TOGGLE_SETTING_KEYS as readonly string[]).includes(key);

/** What the settings tab can do that is not writing a setting. `renderHeldField` draws the port
 *  and the bind address itself, on a row Obsidian has already given a name and a description:
 *  see {@link heldFieldOutcome} for why neither can be a declarative control. */
export interface SettingTabActions {
  copy: () => void;
  regenerate: () => void;
  renderHeldField: (key: HeldFieldKey, setting: Setting) => void;
}

/** The two fields that are held while they are being typed into rather than written through. */
export type HeldFieldKey = "mcpPort" | "mcpBindAddress";

/** What the bind-address field says when what is in it is not an address. */
export const MCP_BIND_ADDRESS_INVALID =
  "Not an address. Use an IP address such as 127.0.0.1, 0.0.0.0 or 192.168.1.5 — not a name.";

/** What the port field says when what is in it is not a number. Out of range is not refused —
 *  `settingsPatchFor` pulls it into the allowed range — so only text that is not a port lands here. */
export const MCP_PORT_INVALID = `Not a port. Use a number between ${MCP_PORT_MIN} and ${MCP_PORT_MAX}.`;

/** What a field says about a value it refused, when the refusal is worth naming. */
const HELD_FIELD_INVALID: Record<HeldFieldKey, string> = {
  mcpPort: MCP_PORT_INVALID,
  mcpBindAddress: MCP_BIND_ADDRESS_INVALID,
};

/** What {@link heldFieldOutcome} decided. */
export interface HeldFieldOutcome {
  /** What the field must show once focus leaves it — never what was typed and refused, always a
   *  value that is stored, or that leaving the field is about to store. */
  show: string;
  /** The patch to write, or `null` when the value was refused, or is the one already stored *and*
   *  already recorded as chosen — see `alreadySet` on {@link heldFieldOutcome}. */
  commit: Partial<KanbanSettings> | null;
  /** The message shown under the field while it holds something that is not a value, or `null`. */
  error: string | null;
  /** The same message where there is no room for an inline one, or `null` when it is not worth a
   *  notice — which is what an emptied field is. */
  notice: string | null;
}

/**
 * What leaving one of the held fields means: what it must show, what to store, and what to say.
 *
 * Both fields are drawn imperatively on both rendering paths, and this is why. Obsidian 1.13 runs a
 * declarative control's `validate` on every keystroke and writes every accepted one straight
 * through, with no blur to hold it back: typing `192.168.1.55` would bind `192.168.1.5` on the way,
 * restarting the server and announcing it, and every prefix of a port is a port of its own. Holding
 * the field until focus leaves is the only way either setting can be typed at all — and leaving it
 * is then also the only moment the field can be put back to what the server is actually on, which
 * an emptied field showing a grey default otherwise lies about.
 *
 * `alreadySet` is why a value identical to the one on screen can still be worth writing. Settings
 * are stored only where someone set them, so a field showing the default is showing a value nobody
 * chose; typing that same value *is* the choice, and skipping the write because "it did not change"
 * would throw it away. These two fields are where that matters most: a release that ever moves
 * `MCP_DEFAULT_PORT` or the default bind address would otherwise move a server the user had
 * deliberately put there.
 */
export function heldFieldOutcome(
  key: HeldFieldKey,
  typed: string,
  settings: KanbanSettings,
  alreadySet: boolean,
): HeldFieldOutcome {
  const patch = settingsPatchFor(key, typed);
  const accepted = patch?.[key];
  if (accepted === undefined) {
    // An emptied field is someone reaching for the default, not a mistake worth interrupting for;
    // it still gets the inline message while the field is being typed into.
    const error = HELD_FIELD_INVALID[key];
    return {
      show: String(settings[key]),
      commit: null,
      error,
      notice: typed.trim() === "" ? null : error,
    };
  }
  return {
    show: String(accepted),
    commit: accepted === settings[key] && alreadySet ? null : patch,
    error: null,
    notice: null,
  };
}

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
  if (key === "mcpBindAddress") return bindAddressPatchFor(value);
  return numberPatchFor(key, value) ?? dropdownPatchFor(key, value);
}

/**
 * The patch a bind address means, or `null` when it is not one the server could bind to. Refused
 * rather than corrected: an address is not a range with a nearest allowed value, and half of one
 * ("192.168.1") is not a request for anything. What is stored is the normalised form, so the
 * `Origin` check compares the same spelling the transport binds.
 */
function bindAddressPatchFor(value: unknown): Partial<KanbanSettings> | null {
  if (typeof value !== "string" || !isBindAddress(value)) return null;
  return { mcpBindAddress: normalizeBindAddress(value) };
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
 * What every row of one group needs to know about itself: the heading it sits under (which is also
 * a search term), where to read the settings, what the tab can do, and whether the group's rows
 * exist on this platform at all.
 *
 * `visible` is carried down to each row even though the group carries it too, and deliberately:
 * Obsidian documents a group's `visible` as hiding the heading and its contents, but only a row's
 * own `visible` as also taking that row out of the settings search for that render. A phone must
 * not be able to reach the agent-access toggle through a search result for a server it cannot host.
 */
interface RowContext {
  heading: string;
  read: () => KanbanSettings;
  actions: SettingTabActions;
  visible?: boolean;
}

/** One declarative row: the shared copy, the search words the short name gave up, and the control
 *  {@link SETTING_CONTROLS} says it is drawn with. */
function rowDefinition(key: EditableSettingKey, ctx: RowContext): SettingDefinition {
  const { heading, read, actions } = ctx;
  const spec: RowControlSpec = SETTING_CONTROLS[key];
  const base = {
    ...SETTING_COPY[key],
    aliases: [heading, ...(EXTRA_ALIASES[key] ?? [])],
    ...(ctx.visible === undefined ? {} : { visible: ctx.visible }),
  };
  // A held field is not a control at all: it draws itself and writes on blur, and its disabled
  // state is applied there, from `isRowDisabled`, on both rendering paths.
  if (spec.kind === "held") {
    const held = key as HeldFieldKey;
    return {
      ...base,
      render: (setting) => {
        actions.renderHeldField(held, setting);
      },
    };
  }
  const disabled = (): boolean => isRowDisabled(key, read());
  switch (spec.kind) {
    case "dropdown":
      return {
        ...base,
        control: { type: "dropdown", key, options: spec.options, disabled },
      };
    case "toggle":
      return { ...base, control: { type: "toggle", key, disabled } };
    case "slider":
      return {
        ...base,
        control: { type: "slider", key, min: spec.min, max: spec.max, step: spec.step, disabled },
      };
    case "text":
      return {
        ...base,
        control: { type: "text", key, placeholder: spec.placeholder, disabled },
      };
  }
}

/** The two token rows that close the agent-access group. Neither is a setting: one hands the token
 *  over, the other throws it away, and both are dead until agent access is on. */
function tokenRows(ctx: RowContext): SettingDefinition[] {
  const { heading, read, actions } = ctx;
  const off = (): boolean => !read().mcpEnabled;
  const shown = ctx.visible === undefined ? {} : { visible: ctx.visible };
  return [
    {
      name: MCP_TOKEN_COPY.name,
      desc: MCP_TOKEN_COPY.desc,
      aliases: [heading, "mcp", "token", "bearer"],
      action: actions.copy,
      disabled: off,
      ...shown,
    },
    {
      name: MCP_TOKEN_REGENERATE.name,
      desc: MCP_TOKEN_REGENERATE.desc,
      aliases: [heading, "mcp", "token", "regenerate", "revoke"],
      action: actions.regenerate,
      disabled: off,
      ...shown,
    },
  ];
}

/**
 * The settings tab as data, for Obsidian 1.13 and later: it renders the tab from these and indexes
 * them for the settings search. A `disabled` predicate reads the settings as they are when it runs,
 * which is on each render and on each `refreshDomState()` — that is how a row depending on another
 * setting catches up without the tab being redrawn.
 *
 * The shape is {@link SETTING_GROUPS} turned into Obsidian's own groups, so the tab reads as a few
 * headed sections rather than one flat list, and `src/main.ts` walks the same groups to build the
 * imperative tab Obsidian below 1.13 gets.
 */
export function settingDefinitions(
  read: () => KanbanSettings,
  version: string,
  actions: SettingTabActions,
  desktop: boolean,
): SettingDefinitionItem[] {
  return [
    ...SETTING_GROUPS.map((group) => {
      // A phone cannot listen for connections, so the group that promises it can does not appear —
      // rather than switching on, minting a token and quietly doing nothing. The group hides the
      // heading and everything under it; each row carries the same flag so the settings search
      // cannot offer one either. See {@link RowContext}.
      const desktopOnly = group.id === "agentAccess";
      const ctx: RowContext = {
        heading: group.heading,
        read,
        actions,
        ...(desktopOnly ? { visible: desktop } : {}),
      };
      return {
        type: "group" as const,
        heading: group.heading,
        items: [
          ...group.keys.map((key) => rowDefinition(key, ctx)),
          ...(desktopOnly ? tokenRows(ctx) : []),
        ],
        ...(desktopOnly ? { visible: desktop } : {}),
      };
    }),
    {
      type: "group" as const,
      heading: ABOUT_HEADING,
      // Read from the manifest so it always reflects the installed build, never a hardcoded value.
      items: [{ name: VERSION_SETTING_NAME, desc: version, aliases: [ABOUT_HEADING] }],
    },
  ];
}
