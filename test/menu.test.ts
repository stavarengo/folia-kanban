import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuRow } from "../src/model/repo";

// Obsidian's Menu reduced to what the adapter calls, recording each call so a test can read the
// menu back the way it was built.
const shown = vi.hoisted(() => [] as FakeMenu[]);
type Call = [string, ...unknown[]];
interface FakeMenu {
  rows: Call[][];
  at: Call | null;
  hide(): void;
}
vi.mock("obsidian", () => {
  class MenuItem {
    calls: Call[] = [];
    click: ((evt: MouseEvent) => void) | null = null;
    constructor() {
      for (const name of [
        "setTitle",
        "setIcon",
        "setChecked",
        "setDisabled",
        "setWarning",
        "setIsLabel",
      ])
        (this as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
          this.calls.push([name, ...args]);
          return this;
        };
    }
    onClick(cb: (evt: MouseEvent) => void) {
      this.click = cb;
      return this;
    }
  }
  class Menu implements FakeMenu {
    rows: Call[][] = [];
    items: MenuItem[] = [];
    at: Call | null = null;
    private hidden: (() => void) | null = null;
    addItem(cb: (item: MenuItem) => void) {
      const item = new MenuItem();
      cb(item);
      this.items.push(item);
      this.rows.push(item.calls);
      return this;
    }
    addSeparator() {
      this.rows.push([["separator"]]);
      return this;
    }
    onHide(cb: () => void) {
      this.hidden = cb;
    }
    showAtMouseEvent(evt: MouseEvent) {
      this.at = ["mouse", evt];
      shown.push(this);
      return this;
    }
    showAtPosition(pos: unknown, doc?: Document) {
      this.at = ["position", pos, doc];
      shown.push(this);
      return this;
    }
    hidden_ = false;
    hide() {
      if (!this.hidden_) this.hidden?.();
      this.hidden_ = true;
      return this;
    }
  }
  return { Menu };
});

const { showMenu } = await import("../src/obsidian/menu");

afterEach(() => {
  for (const menu of shown) menu.hide();
  shown.length = 0;
  document.body.innerHTML = "";
});

const nextTask = () => new Promise((r) => setTimeout(r));

describe("the host menu", () => {
  it("builds each row from documented members only", () => {
    const rows: MenuRow[] = [
      { title: "Open", icon: "file-text", onClick: () => {} },
      "separator",
      { label: "Priority" },
      { title: "high", checked: true, onClick: () => {} },
      { title: "Move up", disabled: true, onClick: () => {} },
      { title: "Delete", warning: true, onClick: () => {} },
    ];
    showMenu(rows, { event: new MouseEvent("contextmenu") });
    expect(shown[0]?.rows).toEqual([
      [
        ["setTitle", "Open"],
        ["setIcon", "file-text"],
      ],
      [["separator"]],
      [
        ["setTitle", "Priority"],
        ["setIsLabel", true],
      ],
      [
        ["setTitle", "high"],
        ["setChecked", true],
      ],
      [
        ["setTitle", "Move up"],
        ["setDisabled", true],
      ],
      [
        ["setTitle", "Delete"],
        ["setWarning", true],
      ],
    ]);
  });

  it("opens at the pointer event it was raised by", () => {
    const evt = new MouseEvent("contextmenu", { clientX: 30, clientY: 40 });
    showMenu([], { event: evt });
    expect(shown[0]?.at).toEqual(["mouse", evt]);
  });

  it("opens under an element, in that element's own document", () => {
    const el = document.body.appendChild(document.createElement("button"));
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 40, y: 100, width: 20, height: 30 }),
    );
    showMenu([], { below: el });
    expect(shown[0]?.at).toEqual(["position", { x: 40, y: 130 }, document]);
  });

  it("gives focus back to the element it opened under when nothing else took it", async () => {
    const el = document.body.appendChild(document.createElement("button"));
    showMenu([], { below: el });
    el.blur();
    shown[0]?.hide();
    await nextTask();
    expect(document.activeElement).toBe(el);
  });

  it("leaves focus where a picked row sent it", async () => {
    const el = document.body.appendChild(document.createElement("button"));
    const field = document.body.appendChild(document.createElement("input"));
    showMenu([], { below: el });
    shown[0]?.hide();
    field.focus();
    await nextTask();
    expect(document.activeElement).toBe(field);
  });

  it("closes the menu still showing before it opens another", () => {
    const el = document.body.appendChild(document.createElement("button"));
    showMenu([], { below: el });
    const first = shown[0]!;
    const hide = vi.spyOn(first, "hide");
    showMenu([], { below: el });
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone after a menu raised by the pointer", async () => {
    const el = document.body.appendChild(document.createElement("button"));
    el.focus();
    const evt = new MouseEvent("contextmenu");
    el.dispatchEvent(evt);
    showMenu([], { event: evt });
    el.blur();
    shown[0]?.hide();
    await nextTask();
    expect(document.activeElement).toBe(document.body);
  });

  // The menu reads its own keys off the window and never takes focus, so any key that still
  // reaches the focused element is one it did not take — Space, Tab, a letter.
  it.each([
    ["under an element", (el: HTMLElement) => ({ below: el })],
    [
      "at the pointer",
      (el: HTMLElement) => {
        const evt = new MouseEvent("contextmenu");
        el.dispatchEvent(evt);
        return { event: evt };
      },
    ],
  ])("closes, opened %s, on a key it does not take or on focus moving elsewhere", (_, anchor) => {
    const el = document.body.appendChild(document.createElement("button"));
    el.focus();
    showMenu([], anchor(el));
    const hide = vi.spyOn(shown[0]!, "hide");
    for (const key of ["Shift", "ArrowDown", "ArrowUp", "Enter", "Escape"])
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(hide).not.toHaveBeenCalled();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(hide).toHaveBeenCalledTimes(1);

    showMenu([], anchor(el));
    const hideAgain = vi.spyOn(shown[1]!, "hide");
    el.blur(); // the window losing focus, which an OS-drawn menu can cause
    expect(hideAgain).not.toHaveBeenCalled();
    el.focus();
    document.body.appendChild(document.createElement("button")).focus();
    expect(hideAgain).toHaveBeenCalledTimes(1);
  });
});
