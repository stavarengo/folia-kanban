import { describe, expect, it } from "vitest";
import {
  CARD_NEXT_TODOS_MAX,
  SETTING_COPY,
  SETTING_OPTIONS,
  settingDefinitions,
  settingsPatchFor,
} from "../src/settingsDefinitions";
import {
  DEFAULT_SETTINGS,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
  type KanbanSettings,
} from "../src/settings";

const definitions = settingDefinitions(() => DEFAULT_SETTINGS, "1.2.3");

/** The keys of every `control` row of the declarative tab, in the order it renders them. */
const controlKeys = definitions.flatMap((d) =>
  "control" in d && d.control ? [d.control.key] : [],
);

describe("settingDefinitions", () => {
  it("exposes every editable setting, and nothing the plugin only keeps for itself", () => {
    expect(new Set(controlKeys)).toEqual(new Set(Object.keys(SETTING_COPY)));
    for (const key of controlKeys) expect(DEFAULT_SETTINGS).toHaveProperty(key);
  });

  it("uses the shared copy, so the two renderings of the tab cannot word a setting differently", () => {
    for (const [key, copy] of Object.entries(SETTING_COPY)) {
      const def = definitions.find((d) => "control" in d && d.control?.key === key);
      expect(def).toMatchObject({ name: copy.name, desc: copy.desc });
    }
  });

  it("reports the version it is given", () => {
    expect(definitions.at(-1)).toMatchObject({ name: "Version", desc: "1.2.3" });
  });

  it("disables the rows that depend on another setting only while that setting says so", () => {
    const disabledOf = (key: string, settings: KanbanSettings): boolean => {
      const def = settingDefinitions(() => settings, "1.2.3").find(
        (d) => "control" in d && d.control?.key === key,
      );
      const disabled = def && "control" in def ? def.control?.disabled : undefined;
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
    expect(settingsPatchFor("cardNextTodos", -3)).toEqual({ cardNextTodos: 0 });
    expect(settingsPatchFor("cardNextTodos", 99)).toEqual({ cardNextTodos: CARD_NEXT_TODOS_MAX });
  });

  it("trims the name comments are signed with", () => {
    expect(settingsPatchFor("userName", "  alex  ")).toEqual({ userName: "alex" });
  });
});
