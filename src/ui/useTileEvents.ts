import { useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { Card } from "../model/types";
import type { MenuAnchor } from "../model/repo";
import { cardMenu, todoMenu } from "./menus";
import { useBoardActions, useRepo, useSettings } from "./context";

/**
 * What the tile does with a click, a key or a right-click: a click or Enter opens the card, a
 * right-click or the platform's context-menu keys open its menu, and every other key goes on to
 * dnd-kit (Space = pick up).
 */
export function useTileEvents({
  card,
  latest,
  isDragging,
  canComplete,
  listeners,
  onRename,
}: {
  card: Card;
  /** The card as last drawn, for a menu row picked after a reload the open menu outlived. */
  latest: { readonly current: Card };
  isDragging: boolean;
  canComplete: boolean;
  listeners: object | undefined;
  onRename: () => void;
}) {
  const actions = useBoardActions();
  const repo = useRepo();
  const { userName } = useSettings();
  /** The menu key held since it opened the card menu (see `onContextMenu`). */
  const menuKey = useRef<string | null>(null);
  const todoRef = card.todoRef;
  // An inline todo has no note of its own: its checklist line lives in its parent, so every action
  // that needs a file addresses the parent, and the tile's own actions are the todo actions.
  const notePath = todoRef ? todoRef.parentPath : card.path;

  const openMenu = (at: MenuAnchor, todoEl: Element | null) => {
    // Not while the card is lifted, whichever way the menu was asked for: it would act on a card
    // still in flight.
    if (isDragging) return;
    const rowIndex = todoEl ? Number(todoEl.getAttribute("data-todo-index")) : NaN;
    // Which checklist line the menu is for, read the moment it opens: this tile's own, for a todo
    // placed in a column, or the surfaced next-todo row a right-click landed on. The menu outlives
    // board reloads, and a line removed above this one moves every index below it — so its rows
    // carry the line rather than the place it sat.
    const line = todoRef
      ? todoRef.line
      : todoEl && Number.isFinite(rowIndex)
        ? actions.readTodo(notePath, rowIndex)
        : null;
    // A row the board no longer holds a todo at gets no menu: the card's own would offer to finish
    // the whole card from a click aimed at one line.
    if (todoEl && !line) return;
    repo.showMenu(
      line
        ? todoMenu(actions, notePath, line)
        : cardMenu(actions, {
            card: () => latest.current,
            isDone: !canComplete,
            me: userName.trim(),
            onRename,
          }),
      at,
    );
  };
  // Right-click opens a context-aware menu. preventDefault stops Obsidian's own context menu;
  // dnd-kit's PointerSensor only activates on the left button, so this never starts a drag.
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // The key that already opened the menu, followed by the platform's own contextmenu at the
    // focused card: Windows fires it on keyup, and with a point on the card rather than (0, 0).
    if (menuKey.current) return;
    // A contextmenu fired from the keyboard can report (0, 0) rather than a point on the card.
    const byKeyboard = e.clientX === 0 && e.clientY === 0;
    openMenu(
      byKeyboard ? { below: cardMain(e.currentTarget) } : { event: e.nativeEvent },
      (e.target as HTMLElement).closest(".folia-card-next-todo"),
    );
  };
  // Merge dnd-kit keyboard handling (Space = pick up) with Enter = open and the platform's
  // context-menu keys = the card menu, anchored to the card since there is no pointer to follow.
  const onKeyDown = (e: KeyboardEvent) => {
    if (isMenuKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      menuKey.current = e.key;
      openMenu({ below: e.currentTarget as HTMLElement }, null);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      actions.open(notePath);
      return;
    }
    (listeners as { onKeyDown?: (e: KeyboardEvent) => void } | undefined)?.onKeyDown?.(e);
  };
  // The contextmenu a keyup brings is dispatched right after it, so the key stays remembered
  // until the next task and no longer.
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== menuKey.current) return;
    e.currentTarget.ownerDocument.defaultView?.setTimeout(() => (menuKey.current = null));
  };
  const open = () => {
    if (!isDragging) actions.open(notePath);
  };
  // A right-click starts with a press; the contextmenu a key brings does not. The keyup may
  // never reach the card either (the OS-drawn menu takes it), so the press also forgets the key.
  const forgetMenuKey = () => (menuKey.current = null);

  return { notePath, open, onContextMenu, onKeyDown, onKeyUp, forgetMenuKey };
}

/** The platform's context-menu keys: the Menu key, or Shift+F10 alone. */
function isMenuKey(e: KeyboardEvent): boolean {
  return (
    e.key === "ContextMenu" ||
    (e.key === "F10" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey)
  );
}

/** The card's focusable face, which a menu opened without a pointer sits under and returns to. */
function cardMain(el: Element): HTMLElement {
  return (el.querySelector(".folia-card-main") ?? el) as HTMLElement;
}
