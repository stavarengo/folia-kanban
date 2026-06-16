import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { priorityOptions, priorityTone } from "./cardView";
import { useBoardActions } from "./context";
import { Icon, type IconName } from "./icons";

export interface ContextTarget {
  x: number;
  y: number;
  kind: "card" | "todo";
  /** Set when kind === "todo": the SubItem.index of the clicked checklist row. */
  todoIndex?: number;
}

interface Props {
  target: ContextTarget;
  path: string;
  /** The card's current priority frontmatter value (for the "Change priority" group). */
  priority: string;
  /** Whether the card already sits in the board's "done" column (hides "Mark done"). */
  isDone: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Enter inline title-rename on the card (#12). Single click can't trigger it — that opens the
   *  detail — so the rename gesture lives here in the context menu (card owns it). */
  onRename: () => void;
  onClose: () => void;
}

export function CardContextMenu({ target, path, priority, isDone, canMoveUp, canMoveDown, onRename, onClose }: Props) {
  const a = useBoardActions();
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
    const left = Math.min(Math.max(8, target.x), window.innerWidth - w - 8);
    const top = Math.min(Math.max(8, target.y), window.innerHeight - h - 8);
    setPos({ top: Math.round(top), left: Math.round(left) });
  }, [target.x, target.y]);

  // Focus the first item on open and restore focus to the originating card on close, so a keyboard
  // user who opens then Escapes the menu keeps their place on the board (mirrors CardDetail's opener
  // capture/restore).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>(".mdkb-menu-item:not(:disabled)")?.focus();
    return () => { if (!actioned.current) opener?.focus?.(); };
  }, []);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [onClose]);

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
      ref.current?.querySelectorAll<HTMLButtonElement>(".mdkb-menu-item:not(:disabled)") ?? [],
    );
    if (items.length === 0) return;
    const cur = items.indexOf(document.activeElement as HTMLButtonElement);
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const next = (cur + dir + items.length) % items.length;
    items[next].focus();
  };

  const item = (label: string, icon: IconName, onClick: () => void, opts?: { disabled?: boolean; danger?: boolean }) => (
    <button
      className={"mdkb-menu-item" + (opts?.danger ? " mdkb-menu-danger" : "")}
      role="menuitem"
      disabled={opts?.disabled}
      onClick={() => {
        actioned.current = true;
        onClick();
        onClose();
      }}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  );

  return createPortal(
    <div
      className="mdkb-menu mdkb-card-context"
      ref={ref}
      role="menu"
      aria-label={target.kind === "todo" ? "Todo actions" : "Card actions"}
      onKeyDown={onKeyDown}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      {target.kind === "todo" ? (
        <>
          {item("Mark done", "check-circle", () => a.toggleTodo(path, target.todoIndex!, true))}
          {item("Remove todo", "trash", () => a.removeTodo(path, target.todoIndex!), { danger: true })}
          <div className="mdkb-menu-divider" />
          {item("Open card", "external-link", () => a.open(path))}
        </>
      ) : (
        <>
          {item("Open details", "external-link", () => a.open(path))}
          {item("Rename", "pencil", onRename)}
          {!isDone && item("Mark done", "check-circle", () => a.complete(path))}
          {item("Open note", "external-link", () => a.openNote(path))}

          <div className="mdkb-menu-divider" />
          <span className="mdkb-menu-label">Priority</span>
          <div className="mdkb-menu-priorities" role="group" aria-label="Change priority">
            {priorityOptions(priority).map((p) => (
              <button
                key={p}
                className={"mdkb-menu-prio mdkb-chip-" + priorityTone(p) + (p === priority ? " is-active" : "")}
                role="menuitemradio"
                aria-checked={p === priority}
                onClick={() => {
                  actioned.current = true;
                  a.setPriority(path, p);
                  onClose();
                }}
              >
                {p}
              </button>
            ))}
            <button
              className={"mdkb-menu-prio mdkb-menu-prio-none" + (priority === "" ? " is-active" : "")}
              role="menuitemradio"
              aria-checked={priority === ""}
              aria-label="No priority"
              title="No priority"
              onClick={() => {
                actioned.current = true;
                a.setPriority(path, "");
                onClose();
              }}
            >
              <Icon name="close" size={11} />
            </button>
          </div>

          <div className="mdkb-menu-divider" />
          {item("Move up", "arrow-left", () => a.moveWithinColumn(path, -1), { disabled: !canMoveUp })}
          {item("Move down", "arrow-right", () => a.moveWithinColumn(path, 1), { disabled: !canMoveDown })}

          <div className="mdkb-menu-divider" />
          {item("Add subcard", "git-branch", () => a.addSubcard(path))}
          {item("Delete card", "trash", () => a.remove(path), { danger: true })}
        </>
      )}
    </div>,
    document.body,
  );
}
