import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_NEXT_TODOS_MAX,
  MCP_TOKEN_COPY,
  MCP_TOKEN_REGENERATE,
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
import { MCP_DEFAULT_BIND_ADDRESS } from "../src/mcp/bindAddress";

const noop = (): void => {};

const definitions = settingDefinitions(
  () => DEFAULT_SETTINGS,
  "1.2.3",
  { copy: noop, regenerate: noop },
  true,
);

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
      const def = settingDefinitions(
        () => settings,
        "1.2.3",
        { copy: noop, regenerate: noop },
        true,
      ).find((d) => "control" in d && d.control?.key === key);
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
    expect(settingsPatchFor("mcpBindAddress", "localhost")).toEqual({
      mcpBindAddress: "localhost",
    });
    for (const bad of ["", "192.168.1", "999.1.1.1", "evil.example", 27125, null]) {
      expect(settingsPatchFor("mcpBindAddress", bad), String(bad)).toBeNull();
    }
  });

  it("trims the name comments are signed with", () => {
    expect(settingsPatchFor("userName", "  alex  ")).toEqual({ userName: "alex" });
  });
});

describe("agent access on a platform that cannot host it", () => {
  const rows = (desktop: boolean) =>
    settingDefinitions(() => DEFAULT_SETTINGS, "1.2.3", { copy: noop, regenerate: noop }, desktop);

  const named = (desktop: boolean, name: string) =>
    rows(desktop).find((d) => "name" in d && d.name === name);

  const visibleOf = (item: ReturnType<typeof named>): boolean => {
    if (!item || !("visible" in item)) return true;
    const { visible } = item;
    return typeof visible === "function" ? visible() : (visible ?? true);
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

  it("leaves every other row alone on mobile", () => {
    expect(visibleOf(named(false, SETTING_COPY.historyScope.name))).toBe(true);
  });

  // A token that cannot be replaced is a password only until it leaks. The row is there, and it is
  // dead until there is a token to replace.
  it("offers replacing the token, disabled until agent access is on", () => {
    const row = named(true, MCP_TOKEN_REGENERATE.name);
    expect(row).toBeDefined();
    const disabled = row && "disabled" in row ? row.disabled : undefined;
    expect(typeof disabled === "function" ? disabled() : false).toBe(true);
    const on = settingDefinitions(
      () => ({ ...DEFAULT_SETTINGS, mcpEnabled: true }),
      "1.2.3",
      { copy: noop, regenerate: noop },
      true,
    ).find((d) => "name" in d && d.name === MCP_TOKEN_REGENERATE.name);
    const onDisabled = on && "disabled" in on ? on.disabled : undefined;
    expect(typeof onDisabled === "function" ? onDisabled() : false).toBe(false);
  });

  it("runs the action it was given", () => {
    let called = 0;
    const row = settingDefinitions(
      () => DEFAULT_SETTINGS,
      "1.2.3",
      { copy: noop, regenerate: () => (called += 1) },
      true,
    ).find((d) => "name" in d && d.name === MCP_TOKEN_REGENERATE.name);
    const action = row && "action" in row ? row.action : undefined;
    // Obsidian hands the row element and its index; neither is read here.
    action?.(document.createElement("div"), 0);
    expect(called).toBe(1);
  });
});
