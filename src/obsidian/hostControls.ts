// Obsidian's own buttons, dropdown and progress bar for the board: the face, the states and the
// theming are the app's, and only the words, the values and the wiring are ours.

import {
  ButtonComponent,
  DropdownComponent,
  ExtraButtonComponent,
  ProgressBarComponent,
} from "obsidian";
import type {
  ButtonControl,
  DropdownControl,
  HostControlOptions,
  IconButtonControl,
  IconButtonOptions,
  ProgressBarControl,
} from "../model/repo";

function applyOptions(el: HTMLElement, { stopPropagation = [], keepFocus }: HostControlOptions) {
  for (const type of stopPropagation) el.addEventListener(type, (e) => e.stopPropagation());
  if (keepFocus) el.addEventListener("mousedown", (e) => e.preventDefault());
}

// Every callback below is wrapped in a block that returns nothing: a button whose callback returns
// a promise shows the host's loading state until it settles, which a board action never asks for.

export function mountButton(
  container: HTMLElement,
  onClick: (evt: MouseEvent) => void,
  options: HostControlOptions = {},
): ButtonControl {
  const button = new ButtonComponent(container).onClick((evt) => {
    onClick(evt);
  });
  applyOptions(button.buttonEl, options);
  return {
    el: button.buttonEl,
    setText: (text) => {
      button.setButtonText(text);
    },
    setCta: (cta) => {
      if (cta) button.setCta();
      else button.removeCta();
    },
    setDisabled: (disabled) => {
      button.setDisabled(disabled);
    },
    remove: () => container.empty(),
  };
}

/**
 * The host's icon button is a focusable `div` with no role, pressed by Enter and Space as well as
 * by a click, so the role is added here, and so is `aria-disabled`, which a `div` has no other way
 * to state. Its callback gets no event; the click it answers is caught on the way down, in the
 * capture phase, and handed over, and a key press clears it first, so a key never passes on the
 * modifiers of an earlier click.
 */
export function mountIconButton(
  container: HTMLElement,
  onClick: (evt?: MouseEvent) => void,
  { middleClick, ariaHaspopup, ...options }: IconButtonOptions = {},
): IconButtonControl {
  let click: MouseEvent | undefined;
  const button = new ExtraButtonComponent(container).onClick(() => {
    const evt = click;
    click = undefined;
    onClick(evt);
  });
  const el = button.extraSettingsEl;
  el.setAttribute("role", "button");
  if (ariaHaspopup) el.setAttribute("aria-haspopup", ariaHaspopup);
  el.addEventListener(
    "click",
    (e) => {
      click = e;
    },
    { capture: true },
  );
  el.addEventListener(
    "keydown",
    (e) => {
      click = undefined;
      // A held key repeats its keydown, and the host presses the button on every one. A native
      // button presses once for a held Space, and a repeated Delete or Mark done is never meant.
      if (e.repeat && isPressKey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  // A middle click on an element is an auxclick, never a click, so the host never sees it.
  if (middleClick)
    el.addEventListener("auxclick", (e) => {
      if (e.button !== 1 || button.disabled) return;
      e.stopPropagation();
      onClick(e);
    });
  applyOptions(el, options);
  const keys = ensureKeyboard(el, button, () => onClick());
  let icon: string | undefined;
  return {
    el,
    setIcon: (next) => {
      if (next === icon) return;
      icon = next;
      button.setIcon(next);
    },
    setLabel: (label) => {
      if (el.getAttribute("aria-label") !== label) button.setTooltip(label);
    },
    setDisabled: (disabled) => {
      button.setDisabled(disabled);
      keys.setDisabled(disabled);
      el.setAttribute("aria-disabled", String(disabled));
    },
    remove: () => container.empty(),
  };
}

function isPressKey(e: KeyboardEvent): boolean {
  return e.key === "Enter" || e.key === " ";
}

/**
 * Before 1.13 the host's icon button is a bare `div` that answers a click only: no tab stop, no
 * Enter or Space. Where the host gave it none, the button gets both here, and loses its tab stop
 * while disabled, as the host's own does from 1.13.
 */
function ensureKeyboard(
  el: HTMLElement,
  button: ExtraButtonComponent,
  press: () => void,
): { setDisabled(disabled: boolean): void } {
  if (el.hasAttribute("tabindex")) return { setDisabled: () => {} };
  el.tabIndex = 0;
  el.addEventListener("keydown", (e) => {
    if (!isPressKey(e) || button.disabled) return;
    e.preventDefault();
    press();
  });
  return {
    setDisabled: (disabled) => {
      if (disabled) el.removeAttribute("tabindex");
      else el.tabIndex = 0;
    },
  };
}

/**
 * The host draws a second, hidden select beside the real one to measure its width, so the container
 * holds both and `remove` empties it rather than taking out `el` alone.
 */
export function mountDropdown(
  container: HTMLElement,
  onChange: (value: string) => void,
): DropdownControl {
  const dropdown = new DropdownComponent(container).onChange((value) => {
    onChange(value);
  });
  return {
    el: dropdown.selectEl,
    setOptions: (options) => {
      dropdown.selectEl.empty();
      for (const { value, label } of options) dropdown.addOption(value, label);
    },
    setValue: (value) => {
      dropdown.setValue(value);
    },
    setDisabled: (disabled) => {
      dropdown.setDisabled(disabled);
    },
    remove: () => container.empty(),
  };
}

export function mountProgressBar(container: HTMLElement): ProgressBarControl {
  const bar = new ProgressBarComponent(container);
  // The component keeps no public handle on what it draws: the bar is what it appended.
  const el = container.lastElementChild as HTMLElement;
  return {
    el,
    setValue: (percent) => {
      bar.setValue(percent);
    },
    remove: () => container.empty(),
  };
}
