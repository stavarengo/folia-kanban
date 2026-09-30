import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ButtonComponent,
  DropdownComponent,
  ExtraButtonComponent,
  ProgressBarComponent,
} from "obsidian";
import {
  mountButton,
  mountDropdown,
  mountIconButton,
  mountProgressBar,
} from "../src/obsidian/hostControls";
import type { CardRepository } from "../src/model/repo";
import { RepoContext } from "../src/ui/context";
import { HostButton, HostDropdown, HostIconButton, HostProgressBar } from "../src/ui/hostControls";
import * as fake from "./obsidianFake";

/** The names the adapter calls, through the REAL types, so an API that moves fails typecheck. */
const MIRRORED: {
  button: (keyof ButtonComponent)[];
  extraButton: (keyof ExtraButtonComponent)[];
  dropdown: (keyof DropdownComponent)[];
  progressBar: (keyof ProgressBarComponent)[];
} = {
  button: ["buttonEl", "onClick", "setButtonText", "setCta", "removeCta", "setDisabled"],
  extraButton: ["extraSettingsEl", "disabled", "onClick", "setIcon", "setTooltip", "setDisabled"],
  dropdown: ["selectEl", "addOption", "onChange", "setValue", "setDisabled"],
  progressBar: ["setValue"],
};

function container(): HTMLElement {
  const parent = document.body.appendChild(document.createElement("div"));
  return parent.appendChild(document.createElement("span"));
}

const click = (el: HTMLElement, init: MouseEventInit = {}) =>
  fireEvent(el, new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));

describe("the fakes the host controls draw on", () => {
  it("answer to every name the adapter calls on the real API", () => {
    const at = container();
    const drawn = {
      button: new fake.ButtonComponent(at),
      extraButton: new fake.ExtraButtonComponent(at),
      dropdown: new fake.DropdownComponent(at),
      progressBar: new fake.ProgressBarComponent(at),
    };
    for (const [kind, names] of Object.entries(MIRRORED))
      for (const name of names) expect(drawn[kind as keyof typeof drawn]).toHaveProperty(name);
  });
});

describe("the icon button", () => {
  it("is announced as a button by its label, and states when it is disabled", () => {
    const button = mountIconButton(container(), () => {});
    button.setIcon("trash-2");
    button.setLabel('Delete "Alpha"');
    button.setDisabled(false);
    expect(button.el).toHaveAttribute("role", "button");
    expect(button.el).toHaveAccessibleName('Delete "Alpha"');
    expect(button.el).toHaveAttribute("aria-disabled", "false");

    button.setDisabled(true);
    expect(button.el).toHaveAttribute("aria-disabled", "true");
    expect(button.el).not.toHaveAttribute("tabindex");
  });

  it("hands over the click with its modifiers, and nothing for a key press after it", () => {
    const got: (MouseEvent | undefined)[] = [];
    const button = mountIconButton(container(), (evt) => got.push(evt));

    click(button.el, { ctrlKey: true });
    fireEvent.keyDown(button.el, { key: "Enter" });
    fireEvent.keyDown(button.el, { key: " " });

    expect(got).toHaveLength(3);
    expect(got[0]).toMatchObject({ type: "click", ctrlKey: true });
    expect(got.slice(1)).toEqual([undefined, undefined]);
  });

  it("ignores presses while disabled", () => {
    const onClick = vi.fn();
    const button = mountIconButton(container(), onClick, { middleClick: true });
    button.setDisabled(true);

    click(button.el);
    fireEvent.keyDown(button.el, { key: "Enter" });
    fireEvent(button.el, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("answers a middle click only when asked to, and keeps it from the elements around it", () => {
    const at = container();
    const around = vi.fn();
    at.parentElement!.addEventListener("auxclick", around);
    const got: (MouseEvent | undefined)[] = [];
    const plain = mountIconButton(at, () => got.push(undefined));
    const opener = mountIconButton(at, (evt) => got.push(evt), { middleClick: true });

    fireEvent(plain.el, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    fireEvent(opener.el, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    fireEvent(opener.el, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "auxclick", button: 1 });
    expect(around).toHaveBeenCalledTimes(2);
  });

  it("keeps only the events it is told to from the elements around it", () => {
    const at = container();
    const around = vi.fn();
    for (const type of ["click", "pointerdown"]) at.parentElement!.addEventListener(type, around);
    const button = mountIconButton(at, () => {}, { stopPropagation: ["click"] });

    click(button.el);
    expect(around).not.toHaveBeenCalled();
    fireEvent.pointerDown(button.el);
    expect(around).toHaveBeenCalledTimes(1);
  });

  it("draws an icon once however often it is asked for the same one", () => {
    const button = mountIconButton(container(), () => {});
    button.setIcon("trash-2");
    const drawn = button.el.firstElementChild;
    button.setIcon("trash-2");
    expect(button.el.firstElementChild).toBe(drawn);
    button.setIcon("x");
    expect(button.el.firstElementChild).not.toBe(drawn);
  });
});

describe("the text button", () => {
  it("never shows the host's loading state for a callback that returns a promise", () => {
    const button = mountButton(container(), () => new Promise<void>(() => {}));
    click(button.el);
    expect(button.el).not.toHaveClass("mod-loading");
  });

  it("keeps focus where it was when asked to", () => {
    const button = mountButton(container(), () => {}, { keepFocus: true });
    const kept = !fireEvent.mouseDown(button.el);
    expect(kept).toBe(true);
    const plain = mountButton(container(), () => {});
    expect(fireEvent.mouseDown(plain.el)).toBe(true);
  });
});

describe("the dropdown", () => {
  it("replaces its options, shows a value silently, and reports a pick", () => {
    const at = container();
    const onChange = vi.fn();
    const dropdown = mountDropdown(at, onChange);
    dropdown.setOptions([{ value: "a", label: "A" }]);
    dropdown.setOptions([
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ]);
    dropdown.setValue("c");

    expect([...dropdown.el.options].map((o) => o.value)).toEqual(["b", "c"]);
    expect(dropdown.el.value).toBe("c");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(dropdown.el, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");

    dropdown.remove();
    expect(at.childElementCount).toBe(0);
  });
});

describe("the progress bar", () => {
  it("is the element the host drew, and goes with remove", () => {
    const at = container();
    const bar = mountProgressBar(at);
    bar.setValue(50);
    expect(bar.el.parentElement).toBe(at);
    expect(bar.el.querySelector("div")).toHaveStyle({ width: "50%" });
    bar.remove();
    expect(at.childElementCount).toBe(0);
  });
});

describe("the React wrappers", () => {
  const repo = {
    mountButton: vi.fn(mountButton),
    mountIconButton: vi.fn(mountIconButton),
    mountDropdown: vi.fn(mountDropdown),
    mountProgressBar: vi.fn(mountProgressBar),
  };
  const inRepo = (ui: React.ReactElement) => (
    <RepoContext.Provider value={repo as unknown as CardRepository}>{ui}</RepoContext.Provider>
  );

  it("mount once, follow their props, and call the latest callback", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const {
      rerender,
      getByRole,
      unmount,
      container: root,
    } = render(inRepo(<HostIconButton icon="x" label="One" className="folia-a" onClick={first} />));
    const el = getByRole("button", { name: "One" });
    expect(el).toHaveClass("folia-a");

    rerender(inRepo(<HostIconButton icon="x" label="Two" className="folia-b" onClick={latest} />));
    expect(getByRole("button", { name: "Two" })).toBe(el);
    expect(el).toHaveClass("folia-b");
    expect(el).not.toHaveClass("folia-a");
    click(el);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();

    unmount();
    expect(root).toBeEmptyDOMElement();
  });

  it("put the layout class on the slot and the face class on the control", () => {
    const { getByRole } = render(
      inRepo(
        <HostIconButton
          icon="x"
          label="Close"
          className="folia-face"
          slotClassName="folia-place"
          onClick={() => {}}
        />,
      ),
    );
    const el = getByRole("button", { name: "Close" });
    expect(el).toHaveClass("folia-face");
    expect(el).not.toHaveClass("folia-place");
    expect(el.parentElement).toHaveClass("folia-host-slot", "folia-place");
  });

  it("draw a text button's text, face and state", () => {
    const { getByRole, rerender } = render(
      inRepo(<HostButton text="Save" cta onClick={() => {}} />),
    );
    const button = getByRole("button", { name: "Save" });
    expect(button).toHaveClass("mod-cta");
    expect(button).toBeEnabled();
    rerender(inRepo(<HostButton text="Save" disabled onClick={() => {}} />));
    expect(button).not.toHaveClass("mod-cta");
    expect(button).toBeDisabled();
  });

  it("name a text button apart from its text, and drop the name when it goes", () => {
    const { getByRole, rerender } = render(
      inRepo(
        <HostButton text="Add" aria-label="Add property" title="Add property" onClick={() => {}} />,
      ),
    );
    const button = getByRole("button", { name: "Add property" });
    expect(button).toHaveAttribute("title", "Add property");
    rerender(inRepo(<HostButton text="Add" onClick={() => {}} />));
    expect(getByRole("button", { name: "Add" })).toBe(button);
    expect(button).not.toHaveAttribute("title");
  });

  it("point a text button's ref at the button while it is mounted", () => {
    const ref: { current: HTMLElement | null } = { current: null };
    const { getByRole, unmount } = render(
      inRepo(<HostButton text="Go" elRef={ref} onClick={() => {}} />),
    );
    expect(ref.current).toBe(getByRole("button", { name: "Go" }));
    unmount();
    expect(ref.current).toBeNull();
  });

  it("rebuild a dropdown's options only when the list changes, and keep its value", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const ui = (list: typeof options, value: string) =>
      inRepo(
        <HostDropdown
          options={list}
          value={value}
          onChange={() => {}}
          aria-label="Column"
          title="Where it goes"
        />,
      );
    const { getByRole, rerender } = render(ui(options, "b"));
    const select = getByRole("combobox", { name: "Column" }) as HTMLSelectElement;
    expect(select).toHaveValue("b");
    expect(select).toHaveAttribute("title", "Where it goes");
    const optionA = select.options[0];

    rerender(ui([...options], "a"));
    expect(select.options[0]).toBe(optionA);
    expect(select).toHaveValue("a");

    rerender(ui([...options, { value: "c", label: "C" }], "c"));
    expect(select.options[0]).not.toBe(optionA);
    expect(select).toHaveValue("c");
  });

  it("fill the progress bar to the percent", () => {
    const { container: root, rerender } = render(inRepo(<HostProgressBar percent={25} />));
    const fill = () => root.querySelector(".folia-host-slot > div > div");
    expect(fill()).toHaveStyle({ width: "25%" });
    rerender(inRepo(<HostProgressBar percent={75} />));
    expect(fill()).toHaveStyle({ width: "75%" });
  });
});
