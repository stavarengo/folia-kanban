import { Menu } from "obsidian";
import type { MenuAnchor, MenuRow } from "../model/repo";

/** The board's menu still showing, closed before another opens: the menu does not take the keys
 *  that open one, so a second Shift+F10 on the card would stack a second menu over the first. */
let showing: Menu | null = null;

/** Keys that never close the menu from here: modifiers, and the ones the menu reads itself (its
 *  scope stops those at the window, but the menu must not depend on that to stay open). */
const KEPT = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
]);

/**
 * Obsidian's `Menu`, built only from documented members. No row gets a section: the only ids
 * Obsidian names are the ones its own menus carry in the DOM, which it does not document.
 */
export function showMenu(rows: readonly MenuRow[], at: MenuAnchor): void {
  showing?.hide();
  const menu = new Menu();
  for (const row of rows) addRow(menu, row);
  const below = "below" in at ? at.below : null;
  const release = closeOnStray(menu, "event" in at ? focusedAt(at.event) : at.below);
  menu.onHide(() => {
    if (showing === menu) showing = null;
    release();
    if (below) refocus(below);
  });
  showing = menu;
  if ("event" in at) {
    menu.showAtMouseEvent(at.event);
  } else {
    const r = at.below.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom }, at.below.ownerDocument);
  }
}

function addRow(menu: Menu, row: MenuRow): void {
  if (row === "separator") {
    menu.addSeparator();
    return;
  }
  if ("label" in row) {
    menu.addItem((item) => item.setTitle(row.label).setIsLabel(true));
    return;
  }
  menu.addItem((item) => {
    item.setTitle(row.title).onClick((evt) => row.onClick(evt));
    if (row.icon) item.setIcon(row.icon);
    if (row.checked !== undefined) item.setChecked(row.checked);
    if (row.disabled) item.setDisabled(true);
    if (row.warning) item.setWarning(true);
  });
}

/** What held focus when the pointer asked for a menu, if anything did. */
function focusedAt(evt: MouseEvent): HTMLElement | null {
  const doc = (evt.target as Node | null)?.ownerDocument;
  const active = doc?.activeElement;
  return active && active !== doc.body ? (active as HTMLElement) : null;
}

/**
 * The menu never takes focus: it reads its arrows, Enter and Escape off the window while focus
 * stays where it was. Any other key still reaches that element, and so would a Tab to another card
 * followed by an Enter the menu swallows and spends on its highlighted row. So the menu closes as
 * soon as a key it does not take arrives there, or focus moves on to another element. Focus
 * leaving for nowhere is the window losing it, which an OS-drawn menu can cause while it is still
 * open, and a click elsewhere closes the menu by itself. Returns the undo.
 */
function closeOnStray(menu: Menu, holder: HTMLElement | null): () => void {
  if (!holder) return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (!KEPT.has(e.key)) menu.hide();
  };
  const onLeave = (e: FocusEvent) => {
    if (e.relatedTarget) menu.hide();
  };
  holder.addEventListener("keydown", onKey, true);
  holder.addEventListener("focusout", onLeave);
  return () => {
    holder.removeEventListener("keydown", onKey, true);
    holder.removeEventListener("focusout", onLeave);
  };
}

/**
 * A pick that re-renders its opener (Move left re-orders the column header) or removes what held
 * focus leaves focus on nothing. By the next task a row that moved focus on purpose (a dialog, the
 * title field) has done so; otherwise it goes back to where the menu came from.
 */
function refocus(el: HTMLElement): void {
  const doc = el.ownerDocument;
  doc.defaultView?.setTimeout(() => {
    if (el.isConnected && (doc.activeElement === null || doc.activeElement === doc.body)) {
      el.focus();
    }
  });
}
