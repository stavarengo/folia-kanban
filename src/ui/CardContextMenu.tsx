import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Card, TodoLine } from "../model/types";
import { samePriority } from "../model/priorities";
import { sameAssignee, toggleAssignee } from "../model/assignees";
import { priorityOptions, priorityTone } from "./cardView";
import { useBoardActions, useBoardDocument, useBoardWindow, useSettings } from "./context";
import { Icon, type IconName } from "./icons";

/**
 * Where the menu was raised, and on what. For a checklist line, `todoLine` is that line as it was
 * read the moment the menu opened: a position alone names a different line as soon as anything
 * above it goes, and this menu stays open across the reload that would do exactly that — so every
 * action in it carries the line the person was pointing at, and the note refuses when that line
 * has since moved on.
 */
export type ContextTarget = { x: number; y: number } & (
  | { kind: "card" }
  | { kind: "todo"; todoLine: TodoLine }
);

interface Props {
  target: ContextTarget;
  /** The card the menu was raised on, as it was drawn. */
  card: Card;
  path: string;
  /** The card's current priority frontmatter value (for the "Change priority" group). */
  priority: string;
  /**
   * Everyone the card is assigned to right now, as its note spells them. Decides whether the menu
   * offers to take the card or to hand it back — and the whole list, not just the first name, so
   * taking a card two people are already on adds you rather than replacing them.
   */
  assignees: readonly string[];
  /** Whether the card already sits in the board's "done" column (hides "Mark done"). */
  isDone: boolean;
  /** For a todo target: the column its line currently claims, `""` when it claims none. */
  todoColumn?: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Enter inline title-rename on the card (#12). Single click can't trigger it — that opens the
   *  detail — so the rename gesture lives here in the context menu (card owns it). */
  onRename: () => void;
  onClose: () => void;
}

export function CardContextMenu({
  target,
  card,
  path,
  priority,
  assignees,
  isDone,
  todoColumn = "",
  canMoveUp,
  canMoveDown,
  onRename,
  onClose,
}: Props) {
  const a = useBoardActions();
  // The **Your name** setting is the plugin's whole notion of who "I" am, so with none set there is
  // nobody to assign the card to in one click and the item is not offered — the detail panel's own
  // field, which takes a typed name, is where an unnamed user assigns anything.
  const me = useSettings().userName.trim();
  // The board can live in a pop-out window, so the portal, the outside-click listener, the focus
  // bookkeeping and the viewport clamp all name the board's own document and window rather than the
  // globals, which follow whichever window has focus.
  const doc = useBoardDocument();
  const win = useBoardWindow();
  const ref = useRef<HTMLDivElement>(null);
  // True once an item was activated. On dismissal (Escape / outside-click) we restore focus to the
  // opener; when an action ran we must NOT, since the action may have moved focus elsewhere on
  // purpose (e.g. "Add subcard"/"Open details" focus the detail panel).
  const actioned = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Fixed-position + portalled to <body> so the menu is never clipped by a column's
  // `overflow: hidden`; clamp to the viewport so it never renders off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(8, target.x), win.innerWidth - w - 8);
    const top = Math.min(Math.max(8, target.y), win.innerHeight - h - 8);
    setPos({ top: Math.round(top), left: Math.round(left) });
  }, [target.x, target.y, win]);

  // Focus the first item on open and restore focus to the originating card on close, so a keyboard
  // user who opens then Escapes the menu keeps their place on the board (mirrors CardDetail's opener
  // capture/restore).
  useEffect(() => {
    const opener = doc.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>(".folia-menu-item:not(:disabled)")?.focus();
    return () => {
      if (!actioned.current) opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    doc.addEventListener("pointerdown", onDoc);
    return () => doc.removeEventListener("pointerdown", onDoc);
  }, [onClose, doc]);

  // Arrow-key navigation between enabled items, matching the keyboard reach of the rest of the UI.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(".folia-menu-item:not(:disabled)") ?? [],
    );
    if (items.length === 0) return;
    const cur = items.indexOf(doc.activeElement as HTMLButtonElement);
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const next = (cur + dir + items.length) % items.length;
    items[next]?.focus();
  };

  // The click reaches the action itself, not only the fact that it happened: "Open note" is a
  // navigation, and a navigation carries the modifier keys that say where it should land. Actions
  // with nowhere to send it simply ignore the argument.
  const item = (
    label: string,
    icon: IconName,
    onClick: (evt: MouseEvent) => void,
    opts?: { disabled?: boolean; danger?: boolean; navigates?: boolean },
  ) => {
    const run = (e: ReactMouseEvent) => {
      actioned.current = true;
      onClick(e.nativeEvent);
      onClose();
    };
    return (
      <button
        className={"folia-menu-item" + (opts?.danger ? " folia-menu-danger" : "")}
        role="menuitem"
        disabled={opts?.disabled}
        onClick={run}
        // A middle click reaches a button as auxclick, and on a navigation it means "new tab" —
        // but only on a navigation. An item that changes or deletes the card must not fire from a
        // gesture nobody aimed at it.
        onAuxClick={
          opts?.navigates
            ? (e) => {
                if (e.button === 1) run(e);
              }
            : undefined
        }
      >
        <Icon name={icon} /> {label}
      </button>
    );
  };

  return createPortal(
    <div
      className="folia-menu folia-card-context folia-scope"
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={target.kind === "todo" ? "Todo actions" : "Card actions"}
      onKeyDown={onKeyDown}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      {target.kind === "todo" ? (
        <>
          {item("Mark done", "check-circle", () => a.toggleTodo(path, target.todoLine, true))}
          {item("Remove todo", "trash", () => a.removeTodo(path, target.todoLine), {
            danger: true,
          })}
          <div className="folia-menu-divider" />
          <span className="folia-menu-label">Column</span>
          <div className="folia-menu-columns" role="group" aria-label="Move todo to a column">
            {a.columns.map((c) => (
              <button
                key={c.id}
                className={"folia-menu-column" + (c.id === todoColumn ? " is-active" : "")}
                role="menuitemradio"
                aria-checked={c.id === todoColumn}
                onClick={() => {
                  actioned.current = true;
                  a.moveTodo(path, target.todoLine, c.id);
                  onClose();
                }}
              >
                {c.title}
              </button>
            ))}
            <button
              className={"folia-menu-column" + (todoColumn === "" ? " is-active" : "")}
              role="menuitemradio"
              aria-checked={todoColumn === ""}
              title="Show it inside its card again"
              onClick={() => {
                actioned.current = true;
                a.moveTodo(path, target.todoLine, null);
                onClose();
              }}
            >
              With its card
            </button>
          </div>

          <div className="folia-menu-divider" />
          {item("Open card", "external-link", () => a.open(path))}
        </>
      ) : (
        <>
          {item("Open details", "external-link", () => a.open(path))}
          {item("Rename", "pencil", onRename)}
          {item("Override card title", "type", () => a.editTitleOverride(path))}
          {!isDone && item("Mark done", "check-circle", () => a.complete(card))}
          {me !== "" &&
            item(
              assignees.some((name) => sameAssignee(name, me)) ? "Unassign me" : "Assign to me",
              "user",
              () => void a.setAssignee(path, toggleAssignee(assignees, me)),
            )}
          {item("Open note", "external-link", (evt) => a.openNote(path, evt), { navigates: true })}

          <div className="folia-menu-divider" />
          <span className="folia-menu-label">Priority</span>
          <div className="folia-menu-priorities" role="group" aria-label="Change priority">
            {priorityOptions(a.priorities, priority).map((p) => (
              <button
                key={p}
                className={
                  "folia-menu-prio folia-chip-" +
                  priorityTone(p, a.priorityScale) +
                  (samePriority(p, priority) ? " is-active" : "")
                }
                role="menuitemradio"
                aria-checked={samePriority(p, priority)}
                onClick={() => {
                  actioned.current = true;
                  void a.setPriority(path, p);
                  onClose();
                }}
              >
                {p}
              </button>
            ))}
            <button
              className={
                "folia-menu-prio folia-menu-prio-none" +
                (samePriority(priority, "") ? " is-active" : "")
              }
              role="menuitemradio"
              // Whitespace-only reads as absent here too, the way every other priority path treats it.
              aria-checked={samePriority(priority, "")}
              aria-label="No priority"
              title="No priority"
              onClick={() => {
                actioned.current = true;
                void a.setPriority(path, "");
                onClose();
              }}
            >
              <Icon name="close" />
            </button>
          </div>

          <div className="folia-menu-divider" />
          {item("Move up", "arrow-left", () => a.moveWithinColumn(path, -1), {
            disabled: !canMoveUp,
          })}
          {item("Move down", "arrow-right", () => a.moveWithinColumn(path, 1), {
            disabled: !canMoveDown,
          })}

          <div className="folia-menu-divider" />
          <span className="folia-menu-label">Copy</span>
          {item("Copy path", "copy", () => a.copyPath(path, "absolute"))}
          {item("Copy path relative to vault", "copy", () => a.copyPath(path, "vault"))}
          {item("Copy path relative to board folder", "copy", () => a.copyPath(path, "board"))}
          {item("Copy base name", "copy", () => a.copyPath(path, "name"))}

          <div className="folia-menu-divider" />
          {item("Add subcard", "git-branch", () => a.addSubcard(path))}
          {item("Delete card", "trash", () => a.remove(path), { danger: true })}
        </>
      )}
    </div>,
    doc.body,
  );
}
