import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_NEXT_TODOS_MAX,
  MCP_TOKEN_COPY,
  SETTING_COPY,
  SETTING_OPTIONS,
  TOGGLE_SETTING_KEYS,
  settingDefinitions,
  settingsPatchFor,
} from "../src/settingsDefinitions";
import {
  DEFAULT_SETTINGS,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  MCP_PORT_MAX,
  MCP_PORT_MIN,
  type KanbanSettings,
} from "../src/settings";

const noop = (): void => {};

const definitions = settingDefinitions(() => DEFAULT_SETTINGS, "1.2.3", noop);

/** The keys of every `control` row of the declarative tab, in the order it renders them. */
const controlKeys = definitions.flatMap((d) =>
  "control" in d && d.control ? [d.control.key] : [],
);

describe("settingDefinitions", () => {
  it("exposes every editable setting, and nothing the plugin only keeps for itself", () => {
    expect(new Set(controlKeys)).toEqual(new Set(Object.keys(SETTING_COPY)));
    for (const key of controlKeys) expect(DEFAULT_SETTINGS).toHaveProperty(key);
  });

  it("takes its wording from the shared copy", () => {
    for (const [key, copy] of Object.entries(SETTING_COPY)) {
      const def = definitions.find((d) => "control" in d && d.control?.key === key);
      expect(def).toMatchObject({ name: copy.name, desc: copy.desc });
    }
  });

  // The other rendering of the tab lives in src/main.ts, which cannot be imported here (it pulls in
  // the obsidian runtime, which only exists inside the app). Reading it as text is what is left: a
  // name or description spelled out there again is a second source of truth, and the two would
  // drift the first time one of them is reworded.
  it("is the only place the imperative tab can get a setting's wording from", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    for (const copy of [...Object.values(SETTING_COPY), MCP_TOKEN_COPY]) {
      expect(main).not.toContain(JSON.stringify(copy.name).slice(1, -1));
      expect(main).not.toContain(JSON.stringify(copy.desc).slice(1, -1));
    }
  });

  it("reports the version it is given", () => {
    expect(definitions.at(-1)).toMatchObject({ name: "Version", desc: "1.2.3" });
  });

  it("disables the rows that depend on another setting only while that setting says so", () => {
    const disabledOf = (key: string, settings: KanbanSettings): boolean => {
      const def = settingDefinitions(() => settings, "1.2.3", noop).find(
        (d) => "control" in d && d.control?.key === key,
      );
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
  });

  it("holds the MCP port to the unprivileged range", () => {
    expect(settingsPatchFor("mcpPort", "8080")).toEqual({ mcpPort: 8080 });
    expect(settingsPatchFor("mcpPort", 80)).toEqual({ mcpPort: MCP_PORT_MIN });
    expect(settingsPatchFor("mcpPort", 999999)).toEqual({ mcpPort: MCP_PORT_MAX });
    expect(settingsPatchFor("mcpPort", "not a port")).toBeNull();
  });

  it("trims the name comments are signed with", () => {
    expect(settingsPatchFor("userName", "  alex  ")).toEqual({ userName: "alex" });
  });
});
