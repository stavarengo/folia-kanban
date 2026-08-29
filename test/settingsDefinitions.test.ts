import type {
  Setting,
  SettingDefinition,
  SettingDefinitionGroup,
  SettingDefinitionItem,
  SettingGroup,
  SettingGroupItem,
} from "obsidian";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MCP_BIND_ADDRESS_INVALID,
  MCP_PORT_INVALID,
  heldFieldOutcome,
  settingDefinitions,
  settingsPatchFor,
  type HeldFieldKey,
} from "../src/settingsDefinitions";
import {
  CARD_NEXT_TODOS_MAX,
  DEPENDENT_SETTING_KEYS,
  MCP_TOKEN_COPY,
  MCP_TOKEN_REGENERATE,
  SETTING_CONTROLS,
  SETTING_COPY,
  SETTING_GROUPS,
  SETTING_OPTIONS,
  TOGGLE_SETTING_KEYS,
  USER_NAME_PLACEHOLDER,
  isRowDisabled,
  type EditableSettingKey,
} from "../src/settingsLayout";
import {
  DEFAULT_SETTINGS,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  MCP_PORT_MAX,
  MCP_PORT_MIN,
  type KanbanSettings,
} from "../src/settings";
import { MCP_DEFAULT_BIND_ADDRESS } from "../src/mcp/bindAddress";

const noop = (): void => {};

const definitions = settingDefinitions(
  () => DEFAULT_SETTINGS,
  "1.2.3",
  { copy: noop, regenerate: noop, renderHeldField: noop },
  true,
);

/**
 * Every string, and every template literal, spelled out in `src/main.ts` — comments stripped first,
 * so prose about a setting is not mistaken for the setting's own wording.
 */
const mainStringLiterals = (): string[] => {
  const source = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const literal = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  return [...source.matchAll(literal)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
};

const truth = (v: boolean | (() => boolean) | undefined): boolean =>
  typeof v === "function" ? v() : (v ?? true);

/** A headed section of the tab. */
const isGroup = (item: SettingDefinitionItem): item is SettingDefinitionGroup =>
  "type" in item && item.type === "group";

/** A plain row, as opposed to the group that holds it or a sub-page (which this tab never makes). */
const isRow = (item: SettingDefinitionItem | SettingGroupItem): item is SettingDefinition =>
  !("type" in item);

/**
 * Every row of the tab, in the order it renders them, each carrying the heading it sits under and
 * whether that whole group is shown. The tab is a list of groups now, so anything asking "is this
 * row there, and is it live" has to walk into them.
 */
const rowsOf = (
  items: SettingDefinitionItem[],
): { row: SettingDefinition; heading: string | null; groupShown: boolean }[] =>
  items.flatMap((item) => {
    if (!isGroup(item)) return isRow(item) ? [{ row: item, heading: null, groupShown: true }] : [];
    const groupShown = truth(item.visible);
    const heading = item.heading ?? null;
    return (item.items ?? []).filter(isRow).map((row) => ({ row, heading, groupShown }));
  });

const rows = rowsOf(definitions).map((r) => r.row);

/** The keys of every `control` row of the declarative tab, in the order it renders them. */
const controlKeys = rows.flatMap((d) => ("control" in d && d.control ? [d.control.key] : []));

/** The port and the bind address are not controls: they draw themselves, because Obsidian's
 *  declarative controls write on every keystroke and offer no blur to hold that back. */
const HELD_KEYS = ["mcpPort", "mcpBindAddress"] as const satisfies readonly HeldFieldKey[];

const heldRow = (key: HeldFieldKey) => rows.find((d) => d.name === SETTING_COPY[key].name);

/** Every setting the tab offers, however the row that offers it is built. */
const editableKeys = [...controlKeys, ...HELD_KEYS];

describe("settingDefinitions", () => {
  it("exposes every editable setting, and nothing the plugin only keeps for itself", () => {
    expect(new Set(editableKeys)).toEqual(new Set(Object.keys(SETTING_COPY)));
    for (const key of editableKeys) expect(DEFAULT_SETTINGS).toHaveProperty(key);
  });

  it("takes its wording from the shared copy", () => {
    for (const [key, copy] of Object.entries(SETTING_COPY)) {
      const def = rows.find(
        (d) => ("control" in d && d.control?.key === key) || d.name === copy.name,
      );
      expect(def).toMatchObject({ name: copy.name, desc: copy.desc });
    }
  });

  // The other rendering of the tab lives in src/main.ts, which cannot be imported here (it pulls in
  // the obsidian runtime, which only exists inside the app). Reading it as text is what is left: a
  // name, description or heading spelled out there again is a second source of truth, and the two
  // would drift the first time one of them is reworded. What is read is every string literal that
  // file holds, with its comments taken out first — wording duplicated for real is always a
  // literal, while a whole-file search would trip over any word that also lives in an identifier.
  it("is the only place the imperative tab can get the tab's wording from", () => {
    const literals = mainStringLiterals();
    const wording = [
      ...SETTING_GROUPS.map((g) => g.heading),
      ...Object.values(SETTING_COPY).flatMap((c) => [c.name, c.desc]),
      ...[MCP_TOKEN_COPY, MCP_TOKEN_REGENERATE].flatMap((c) => [c.name, c.desc, c.button]),
    ];
    for (const text of wording)
      expect(
        literals.filter((l) => l.includes(text)),
        text,
      ).toEqual([]);
  });

  it("reports the version it is given", () => {
    expect(definitions.at(-1)).toMatchObject({ name: "Version", desc: "1.2.3" });
  });

  // The tab used to be one flat list of fourteen rows whose only grouping was a naming convention
  // inside the row names ("Side panel — ..."). The groups are the structure now, and this is what
  // stops a row from being added to the copy and forgotten by the layout, or listed twice.
  it("lays the tab out as the groups it declares, with every setting under exactly one heading", () => {
    expect(definitions.filter(isGroup).map((g) => g.heading)).toEqual(
      SETTING_GROUPS.map((g) => g.heading),
    );
    const laidOut = SETTING_GROUPS.flatMap((g) => [...g.keys]);
    expect(new Set(laidOut)).toEqual(new Set(Object.keys(SETTING_COPY)));
    expect(laidOut).toHaveLength(new Set(laidOut).size);
  });

  // A short name reads better under a heading but takes words with it: "Side panel layout" no
  // longer contains "card details", and Obsidian does not index the heading above it. Every row
  // carries its own heading as a search term so a search that used to land on it still does.
  it("gives every row the heading it sits under as a search term", () => {
    for (const { row, heading } of rowsOf(definitions)) {
      if (heading === null) continue;
      expect(row.aliases ?? [], row.name).toContain(heading);
    }
  });

  // `renderRow` in src/main.ts casts a "held" row's key to `HeldFieldKey`. A third held row added
  // to the controls without being added to that type would make the cast lie, silently.
  it("holds exactly the two fields the held-field type names", () => {
    const held = Object.entries(SETTING_CONTROLS)
      .filter(([, spec]) => spec.kind === "held")
      .map(([key]) => key);
    expect(new Set(held)).toEqual(new Set(HELD_KEYS));
  });

  it("keeps the name field's placeholder on the row that asks for a name", () => {
    const control = rows.find((d) => "control" in d && d.control?.key === "userName")?.control;
    expect(control && "placeholder" in control ? control.placeholder : null).toBe(
      USER_NAME_PLACEHOLDER,
    );
  });

  // Greying a row without saying why is what made the old tab hard to read. The words stay whether
  // or not the row is live, because a description Obsidian fixes at render time cannot appear only
  // when the dependency is unmet.
  it("says in words what every dependent row waits for", () => {
    // Iterated, not listed: a row gated later must earn its explanation too, and a hand-written
    // list is exactly how the two agent-access fields came to be greyed with nothing saying why.
    for (const key of DEPENDENT_SETTING_KEYS)
      expect(SETTING_COPY[key].desc, key).toMatch(/\bOnly used\b/);
    expect(SETTING_COPY.sidePanelMode.desc).toContain(
      "Only used when details open in the side panel",
    );
    expect(SETTING_COPY.addCardOpenMode.desc).toContain(
      "Only used by the two flows that open them",
    );
    // The token rows are gated the same way without being settings, so they are named here.
    for (const copy of [MCP_TOKEN_COPY, MCP_TOKEN_REGENERATE])
      expect(copy.desc, copy.name).toContain("until agent access is on");
  });

  // Both tabs ask this one question, so a row cannot be live on one path and greyed on the other.
  it("reads a row's dependency the same way for whichever tab is asking", () => {
    const modal: KanbanSettings = { ...DEFAULT_SETTINGS, detailPresentation: "modal" };
    const side: KanbanSettings = { ...DEFAULT_SETTINGS, detailPresentation: "side" };
    expect(isRowDisabled("sidePanelMode", modal)).toBe(true);
    expect(isRowDisabled("sidePanelMode", side)).toBe(false);
    // `addCardOpenMode` set to a side value opens a panel even under a modal presentation, and the
    // panel reads the width whichever way it opened, so the width row stays live.
    for (const settings of [modal, side])
      expect(isRowDisabled("detailWidth", settings)).toBe(false);
    expect(isRowDisabled("addCardOpenMode", { ...DEFAULT_SETTINGS, addCardFlow: "inline" })).toBe(
      true,
    );
    expect(isRowDisabled("mcpPort", DEFAULT_SETTINGS)).toBe(true);
    expect(isRowDisabled("mcpPort", { ...DEFAULT_SETTINGS, mcpEnabled: true })).toBe(false);
    // A row nothing gates is never greyed, whatever the settings say.
    const ungated: EditableSettingKey[] = [
      "boardNoteDefaultView",
      "userName",
      "historyScope",
      "detailWidth",
    ];
    for (const key of ungated) expect(isRowDisabled(key, modal), key).toBe(false);
  });

  it("disables the rows that depend on another setting only while that setting says so", () => {
    const disabledOf = (key: string, settings: KanbanSettings): boolean => {
      const def = rowsOf(
        settingDefinitions(
          () => settings,
          "1.2.3",
          { copy: noop, regenerate: noop, renderHeldField: noop },
          true,
        ),
      )
        .map((r) => r.row)
        .find((d) => "control" in d && d.control?.key === key);
      // Without this, a renamed or dropped setting would make every "not disabled" case below pass
      // for the wrong reason: no definition found, so nothing to be disabled.
      if (!def || !("control" in def) || !def.control) throw new Error(`no control for ${key}`);
      const { disabled } = def.control;
      return typeof disabled === "function" ? disabled() : Boolean(disabled);
    };

    expect(disabledOf("sidePanelMode", { ...DEFAULT_SETTINGS, detailPresentation: "side" })).toBe(
      false,
    );
    expect(disabledOf("sidePanelMode", { ...DEFAULT_SETTINGS, detailPresentation: "modal" })).toBe(
      true,
    );
    expect(disabledOf("addCardOpenMode", { ...DEFAULT_SETTINGS, addCardFlow: "inline" })).toBe(
      true,
    );
    expect(disabledOf("addCardOpenMode", { ...DEFAULT_SETTINGS, addCardFlow: "detail" })).toBe(
      false,
    );
    // The width is never greyed: "Open the new card's details in" can open a side panel over a
    // modal presentation, and the panel reads this width however it was opened.
    expect(disabledOf("detailWidth", { ...DEFAULT_SETTINGS, detailPresentation: "modal" })).toBe(
      false,
    );
  });
});

describe("settingsPatchFor", () => {
  it("accepts every option a dropdown offers, and the value that setting starts on", () => {
    for (const [key, options] of Object.entries(SETTING_OPTIONS)) {
      for (const value of Object.keys(options))
        expect(settingsPatchFor(key, value)).toEqual({ [key]: value });
      expect(Object.keys(options)).toContain(DEFAULT_SETTINGS[key as keyof KanbanSettings]);
    }
  });

  it("refuses a value the setting does not offer, an unknown key, and a prototype key", () => {
    expect(settingsPatchFor("boardPan", "sideways")).toBeNull();
    expect(settingsPatchFor("boardPan", 1)).toBeNull();
    expect(settingsPatchFor("commentsSeen", {})).toBeNull();
    expect(settingsPatchFor("toString", "shift")).toBeNull();
    expect(settingsPatchFor("userName", 42)).toBeNull();
  });

  it("keeps the numeric settings inside the range their control offers", () => {
    expect(settingsPatchFor("detailWidth", 400)).toEqual({ detailWidth: 400 });
    expect(settingsPatchFor("detailWidth", 10)).toEqual({ detailWidth: DETAIL_WIDTH_MIN });
    expect(settingsPatchFor("detailWidth", 9999)).toEqual({ detailWidth: DETAIL_WIDTH_MAX });
    expect(settingsPatchFor("detailWidth", "nope")).toBeNull();
    // Number("") / Number(null) / Number(true) are 0, 0 and 1: read as numbers they would move a
    // setting to the bottom of its range instead of being refused.
    expect(settingsPatchFor("detailWidth", null)).toBeNull();
    expect(settingsPatchFor("detailWidth", "")).toBeNull();
    expect(settingsPatchFor("detailWidth", "   ")).toBeNull();
    expect(settingsPatchFor("cardNextTodos", true)).toBeNull();
    expect(settingsPatchFor("cardNextTodos", null)).toBeNull();
    expect(settingsPatchFor("cardNextTodos", Number.NaN)).toBeNull();
    // A control that reports its value as a numeric string is still a number.
    expect(settingsPatchFor("detailWidth", "420")).toEqual({ detailWidth: 420 });
    expect(settingsPatchFor("cardNextTodos", -3)).toEqual({ cardNextTodos: 0 });
    expect(settingsPatchFor("cardNextTodos", 99)).toEqual({ cardNextTodos: CARD_NEXT_TODOS_MAX });
  });

  it("accepts a boolean for an on/off setting and refuses anything else", () => {
    for (const key of TOGGLE_SETTING_KEYS) {
      expect(settingsPatchFor(key, true)).toEqual({ [key]: true });
      expect(settingsPatchFor(key, false)).toEqual({ [key]: false });
      // A toggle falling through to the dropdown branch would be refused, and the setting would
      // render, click, and silently never persist.
      expect(settingsPatchFor(key, "true")).toBeNull();
      expect(settingsPatchFor(key, 1)).toBeNull();
      expect(typeof DEFAULT_SETTINGS[key]).toBe("boolean");
    }
  });

  it("keeps the board-setup affordances on and agent access off out of the box", () => {
    expect(DEFAULT_SETTINGS.boardSetupCommands).toBe(true);
    expect(DEFAULT_SETTINGS.boardSetupFileMenu).toBe(true);
    expect(DEFAULT_SETTINGS.boardSetupEditorMenu).toBe(true);
    // Agent access opens a port; nothing should do that until the user asks for it.
    expect(DEFAULT_SETTINGS.mcpEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.mcpToken).toBe("");
    // And when it is turned on, it is on this machine only until the user says otherwise.
    expect(DEFAULT_SETTINGS.mcpBindAddress).toBe(MCP_DEFAULT_BIND_ADDRESS);
  });

  it("holds the MCP port to the unprivileged range", () => {
    expect(settingsPatchFor("mcpPort", "8080")).toEqual({ mcpPort: 8080 });
    expect(settingsPatchFor("mcpPort", 80)).toEqual({ mcpPort: MCP_PORT_MIN });
    expect(settingsPatchFor("mcpPort", 999999)).toEqual({ mcpPort: MCP_PORT_MAX });
    expect(settingsPatchFor("mcpPort", "not a port")).toBeNull();
  });

  // Not clamped the way the port is: an address has no nearest allowed value, and half of one is
  // not a request for anything, so a value that is not an address is refused outright.
  it("takes a bind address only when it is one, and stores one spelling of it", () => {
    expect(settingsPatchFor("mcpBindAddress", "0.0.0.0")).toEqual({ mcpBindAddress: "0.0.0.0" });
    expect(settingsPatchFor("mcpBindAddress", " 192.168.1.5 ")).toEqual({
      mcpBindAddress: "192.168.1.5",
    });
    expect(settingsPatchFor("mcpBindAddress", "[::1]")).toEqual({ mcpBindAddress: "::1" });
    for (const bad of [
      "",
      "192.168.1",
      "999.1.1.1",
      "evil.example",
      // A name, however special: it lands on 127.0.0.1 or ::1 depending on a hosts file.
      "localhost",
      "192.168.1.5%eth0",
      27125,
      null,
    ]) {
      expect(settingsPatchFor("mcpBindAddress", bad), String(bad)).toBeNull();
    }
  });

  // The declarative control is what could not be used here: Obsidian runs its `validate` on every
  // keystroke and writes every accepted one through, so typing 192.168.1.55 would bind
  // 192.168.1.5 on the way, and there is no blur to hold that back.
  it("draws the port and the bind address itself rather than as a control", () => {
    for (const key of HELD_KEYS) {
      const row = heldRow(key);
      expect(row, key).toBeDefined();
      expect(row && "render" in row && typeof row.render, key).toBe("function");
      expect(row && "control" in row && row.control, key).toBeFalsy();
    }
  });

  it("hands the row it is asked to draw to the tab, with the key it belongs to", () => {
    const drawn: HeldFieldKey[] = [];
    const defs = settingDefinitions(
      () => DEFAULT_SETTINGS,
      "1.2.3",
      {
        copy: noop,
        regenerate: noop,
        renderHeldField: (key) => drawn.push(key),
      },
      true,
    );
    for (const key of HELD_KEYS) {
      const row = rowsOf(defs)
        .map((r) => r.row)
        .find((d) => d.name === SETTING_COPY[key].name);
      // The row hands both straight on and reads neither, so nothing has to stand in for them.
      if (row && "render" in row) row.render({} as Setting, {} as SettingGroup);
    }
    expect(drawn).toEqual([...HELD_KEYS]);
  });

  // What the field must show once focus leaves it is the whole point: an emptied one showing a
  // grey 127.0.0.1 while the server is on 0.0.0.0 is the field lying about where the server is.
  it("puts a refused field back to what is really stored, and says why", () => {
    const stored = { ...DEFAULT_SETTINGS, mcpBindAddress: "0.0.0.0", mcpPort: 8080 };
    expect(heldFieldOutcome("mcpBindAddress", "localhost", stored, true)).toEqual({
      show: "0.0.0.0",
      commit: null,
      error: MCP_BIND_ADDRESS_INVALID,
      notice: MCP_BIND_ADDRESS_INVALID,
    });
    expect(heldFieldOutcome("mcpPort", "not a port", stored, true)).toEqual({
      show: "8080",
      commit: null,
      error: MCP_PORT_INVALID,
      notice: MCP_PORT_INVALID,
    });
  });

  // Emptying the field is how someone reaches for the default, not a mistake to be told about —
  // but the field still goes back to the truth rather than showing the placeholder.
  it("puts an emptied field back without interrupting", () => {
    const stored = { ...DEFAULT_SETTINGS, mcpBindAddress: "0.0.0.0" };
    for (const typed of ["", "   "]) {
      expect(
        heldFieldOutcome("mcpBindAddress", typed, stored, true),
        JSON.stringify(typed),
      ).toEqual({
        show: "0.0.0.0",
        commit: null,
        error: MCP_BIND_ADDRESS_INVALID,
        notice: null,
      });
    }
  });

  it("commits a value that was meant, in the spelling that gets stored", () => {
    expect(heldFieldOutcome("mcpBindAddress", " [::1] ", DEFAULT_SETTINGS, false)).toEqual({
      show: "::1",
      commit: { mcpBindAddress: "::1" },
      error: null,
      notice: null,
    });
    // Out of range is pulled into it, and the field then shows where it landed rather than what
    // was typed.
    expect(heldFieldOutcome("mcpPort", "80", DEFAULT_SETTINGS, false)).toEqual({
      show: String(MCP_PORT_MIN),
      commit: { mcpPort: MCP_PORT_MIN },
      error: null,
      notice: null,
    });
  });

  // Every write restarts the server. Re-typing the address it is already on must not.
  it("writes nothing when the value is the one already stored", () => {
    expect(
      heldFieldOutcome("mcpBindAddress", MCP_DEFAULT_BIND_ADDRESS, DEFAULT_SETTINGS, true),
    ).toEqual({
      show: MCP_DEFAULT_BIND_ADDRESS,
      commit: null,
      error: null,
      notice: null,
    });
    expect(
      heldFieldOutcome("mcpPort", String(DEFAULT_SETTINGS.mcpPort), DEFAULT_SETTINGS, true).commit,
    ).toBeNull();
  });

  // Settings are stored only where someone set them, so a field showing a default is showing a
  // value nobody chose. Typing that value is the choice, and dropping the write as a no-op would
  // throw it away — leaving a later release free to move the server the user deliberately put here.
  it("commits a value equal to the default when the default is all that was showing", () => {
    expect(
      heldFieldOutcome("mcpBindAddress", MCP_DEFAULT_BIND_ADDRESS, DEFAULT_SETTINGS, false).commit,
    ).toEqual({ mcpBindAddress: MCP_DEFAULT_BIND_ADDRESS });
    expect(
      heldFieldOutcome("mcpPort", String(DEFAULT_SETTINGS.mcpPort), DEFAULT_SETTINGS, false).commit,
    ).toEqual({ mcpPort: DEFAULT_SETTINGS.mcpPort });
  });

  it("trims the name comments are signed with", () => {
    expect(settingsPatchFor("userName", "  alex  ")).toEqual({ userName: "alex" });
  });
});

describe("agent access on a platform that cannot host it", () => {
  const tabRows = (desktop: boolean) =>
    rowsOf(
      settingDefinitions(
        () => DEFAULT_SETTINGS,
        "1.2.3",
        { copy: noop, regenerate: noop, renderHeldField: noop },
        desktop,
      ),
    );

  const named = (desktop: boolean, name: string) =>
    tabRows(desktop).find((r) => r.row.name === name);

  /** A row is shown only if its group is: hiding the group is what takes the agent-access rows off
   *  a platform that cannot host a server, heading and all. */
  const visibleOf = (found: ReturnType<typeof named>): boolean => {
    if (!found) return false;
    return found.groupShown && truth("visible" in found.row ? found.row.visible : undefined);
  };

  /** A row's own flag, ignoring its group's. Obsidian documents only this one as also taking the
   *  row out of the settings search, which is the difference between a row a phone cannot see and
   *  one a phone can still find, tap, and use to mint a token for a server it cannot host. */
  const rowsOwnVisible = (found: ReturnType<typeof named>): boolean | undefined => {
    if (!found || !("visible" in found.row)) return undefined;
    const { visible } = found.row;
    return typeof visible === "function" ? visible() : visible;
  };

  // Toggling it on used to persist the setting and mint a token for a server the phone can never
  // run, and say nothing about it. Now the three rows simply are not there.
  it("hides every agent-access row on mobile and shows them on desktop", () => {
    for (const name of [
      SETTING_COPY.mcpEnabled.name,
      SETTING_COPY.mcpPort.name,
      SETTING_COPY.mcpBindAddress.name,
      MCP_TOKEN_COPY.name,
      MCP_TOKEN_REGENERATE.name,
    ]) {
      expect(visibleOf(named(false, name)), `${name} on mobile`).toBe(false);
      expect(visibleOf(named(true, name)), `${name} on desktop`).toBe(true);
    }
  });

  // The group's own `visible` hides the heading and its rows, but Obsidian documents only a row's
  // own `visible` as excluding it from the settings search too. Both are set, and this is the half
  // a refactor to group-level visibility would quietly drop.
  it("marks each agent-access row invisible in its own right, not only its group", () => {
    for (const name of [
      SETTING_COPY.mcpEnabled.name,
      SETTING_COPY.mcpPort.name,
      SETTING_COPY.mcpBindAddress.name,
      MCP_TOKEN_COPY.name,
      MCP_TOKEN_REGENERATE.name,
    ]) {
      expect(rowsOwnVisible(named(false, name)), `${name} on mobile`).toBe(false);
      expect(rowsOwnVisible(named(true, name)), `${name} on desktop`).toBe(true);
    }
    // And nothing else carries a flag it does not need.
    expect(rowsOwnVisible(named(false, SETTING_COPY.historyScope.name))).toBeUndefined();
  });

  it("leaves every other row alone on mobile", () => {
    expect(visibleOf(named(false, SETTING_COPY.historyScope.name))).toBe(true);
  });

  // A token that cannot be replaced is a password only until it leaks. The row is there, and it is
  // dead until there is a token to replace.
  it("offers replacing the token, disabled until agent access is on", () => {
    const found = named(true, MCP_TOKEN_REGENERATE.name);
    expect(found).toBeDefined();
    const disabled = found && "disabled" in found.row ? found.row.disabled : undefined;
    expect(typeof disabled === "function" ? disabled() : false).toBe(true);
    const on = rowsOf(
      settingDefinitions(
        () => ({ ...DEFAULT_SETTINGS, mcpEnabled: true }),
        "1.2.3",
        { copy: noop, regenerate: noop, renderHeldField: noop },
        true,
      ),
    ).find((r) => r.row.name === MCP_TOKEN_REGENERATE.name)?.row;
    const onDisabled = on && "disabled" in on ? on.disabled : undefined;
    expect(typeof onDisabled === "function" ? onDisabled() : false).toBe(false);
  });

  it("runs the action it was given", () => {
    let called = 0;
    const row = rowsOf(
      settingDefinitions(
        () => DEFAULT_SETTINGS,
        "1.2.3",
        {
          copy: noop,
          regenerate: () => {
            called += 1;
          },
          renderHeldField: noop,
        },
        true,
      ),
    ).find((r) => r.row.name === MCP_TOKEN_REGENERATE.name)?.row;
    const action = row && "action" in row ? row.action : undefined;
    // Obsidian hands the row element and its index; neither is read here.
    action?.(document.createElement("div"), 0);
    expect(called).toBe(1);
  });
});
