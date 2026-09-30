import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../src/model/types";
import type { ColumnPatch } from "../src/model/columns";

// Obsidian's Modal and Setting reduced to the DOM the dialog draws into. The components a row adds
// (text, dropdown, slider, toggle, button) are chainable stubs with the one element the dialog
// reads off each, and a button that says what it is and runs its click; the colour row, which the
// dialog draws itself, is real DOM.
vi.mock("obsidian", () => {
  const component = (el: HTMLElement): unknown => {
    const own = {
      inputEl: el,
      selectEl: el,
      sliderEl: el,
      toggleEl: el,
      setButtonText: (text: string) => {
        el.textContent = text;
        return component(el);
      },
      onClick: (cb: () => void) => {
        el.addEventListener("click", cb);
        return component(el);
      },
    };
    return new Proxy(own, {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : () => component(el),
    });
  };
  class Setting {
    settingEl: HTMLElement;
    nameEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(parent: HTMLElement) {
      this.settingEl = parent.createDiv();
      this.nameEl = this.settingEl.createDiv();
      this.controlEl = this.settingEl.createDiv();
    }
    setName(name: string) {
      this.nameEl.textContent = name;
      return this;
    }
    setDesc() {
      return this;
    }
    private add(cb: (c: never) => void, tag: string) {
      cb(component(this.controlEl.createEl(tag as "input")) as never);
      return this;
    }
    addText(cb: (c: never) => void) {
      return this.add(cb, "input");
    }
    addDropdown(cb: (c: never) => void) {
      return this.add(cb, "select");
    }
    addSlider(cb: (c: never) => void) {
      return this.add(cb, "input");
    }
    addToggle(cb: (c: never) => void) {
      return this.add(cb, "div");
    }
    addButton(cb: (c: never) => void) {
      return this.add(cb, "button");
    }
  }
  class Modal {
    contentEl = document.body.createDiv({ cls: "modal-content" });
    setTitle() {
      return this;
    }
    open() {
      this.onOpen();
    }
    close() {}
    onOpen() {}
  }
  return { Modal, Setting };
});

const { openColumnEditor } = await import("../src/obsidian/columnEditModal");

afterEach(() => {
  document.body.innerHTML = "";
});

/** Open the dialog on a column with `color`, pick with `pick`, save, and return the patch. */
const edit = (color: string | undefined, pick?: (swatches: HTMLElement) => void) => {
  const column: ColumnDef = { id: "todo", title: "Todo", ...(color ? { color } : {}) };
  let patch: ColumnPatch | null = null;
  openColumnEditor({} as never, column, (p) => (patch = p));
  const swatches = document.querySelector<HTMLElement>(".folia-swatches")!;
  pick?.(swatches);
  const save = (): ColumnPatch | null => {
    button(document.body, "Save").click();
    return patch;
  };
  return { swatches, save };
};

const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  )!;

describe("the Edit column dialog's colour row", () => {
  it("presses No color while the note stores no colour, and none of the eight", () => {
    const { swatches } = edit(undefined);
    expect(button(swatches, "No color").getAttribute("aria-pressed")).toBe("true");
    expect(swatches.querySelectorAll(".folia-swatch.folia-is-active")).toHaveLength(1);
  });

  it("shows a legacy hex as a disabled ninth swatch, the only one pressed", () => {
    const { swatches } = edit("#9aa0a6");
    const custom = button(swatches, "Custom color #9aa0a6");
    expect(custom.disabled).toBe(true);
    expect(custom.style.getPropertyValue("--folia-swatch-color")).toBe("#9aa0a6");
    expect(swatches.querySelectorAll(".folia-swatch.folia-is-active")).toHaveLength(1);
    expect(button(swatches, "No color").getAttribute("aria-pressed")).toBe("false");
  });

  it("replaces a legacy hex with the palette NAME that was picked", () => {
    const { swatches, save } = edit("#9aa0a6", (s) => button(s, "Set color cyan").click());
    expect(button(swatches, "Set color cyan").getAttribute("aria-pressed")).toBe("true");
    expect(swatches.querySelector('[aria-label^="Custom color"]')).toBeNull();
    expect(save()?.color).toBe("cyan");
  });

  it("clears the colour when No color is picked", () => {
    const { swatches, save } = edit("green", (s) => button(s, "No color").click());
    expect(button(swatches, "No color").getAttribute("aria-pressed")).toBe("true");
    const patch = save();
    expect(patch).not.toBeNull();
    expect(patch?.color ?? null).toBeNull();
  });
});
