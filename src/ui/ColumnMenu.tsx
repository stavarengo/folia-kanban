import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ColumnDef } from "../model/types";
import { useBoardActions } from "./context";
import { Icon } from "./icons";
import { COLUMN_COLORS } from "./columnColors";

const MENU_W = 224;

interface Props {
  column: ColumnDef;
  isFirst: boolean;
  isLast: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  /** Open the full "Edit column" modal (#8). The menu closes first so its outside-click teardown
   *  doesn't race the modal — the modal's open-state lives in the parent Column, not here. */
  onEdit: () => void;
}

export function ColumnMenu({ column, isFirst, isLast, triggerRef, onClose, onEdit }: Props) {
  const a = useBoardActions();
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(column.title);
  const [wip, setWip] = useState(column.limit != null ? String(column.limit) : "");
  const [confirmDel, setConfirmDel] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Fixed-position + portalled to <body> so the popover is never clipped by the column's
  // `overflow: hidden` (which would hide Move/Delete on a short column).
  useLayoutEffect(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
    setPos({ top: Math.round(r.bottom + 4), left: Math.round(left) });
  }, [triggerRef]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // Ignore clicks on the trigger button — it toggles the menu itself; closing here would
      // race its onClick and immediately reopen the menu.
      if (ref.current && !ref.current.contains(t) && !triggerRef.current?.contains(t)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose, triggerRef]);

  // Return focus to the trigger when the menu closes (keyboard users aren't dropped to <body>).
  useEffect(() => () => triggerRef.current?.focus?.(), [triggerRef]);

  const commitName = () => {
    const t = name.trim();
    if (t && t !== column.title) a.renameColumn(column.id, t);
  };
  const commitWip = () => {
    const next = wip.trim() === "" ? null : Number(wip);
    const cur = column.limit ?? null;
    if (next !== cur) a.setColumnLimit(column.id, next);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog surface: onKeyDown drives Escape on a role=dialog + focus-managed menu
    <div
      className="folia-menu"
      ref={ref}
      role="dialog"
      aria-label={`Column options: ${column.title}`}
      onKeyDown={onKeyDown}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      <div className="folia-menu-field">
        <span className="folia-menu-label">Title</span>
        <input
          autoFocus
          value={name}
          aria-label="Rename column"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitName();
              onClose();
            }
          }}
          onBlur={commitName}
        />
      </div>

      <div className="folia-menu-field">
        <span className="folia-menu-label">Color</span>
        <div className="folia-swatches">
          {COLUMN_COLORS.map((c) => (
            <button
              key={c}
              className={"folia-swatch" + (column.color?.toLowerCase() === c.toLowerCase() ? " is-active" : "")}
              style={{ background: c }}
              aria-label={`Set color ${c}`}
              onClick={() => a.setColumnColor(column.id, c)}
            />
          ))}
          <button className="folia-swatch folia-swatch-none" aria-label="Clear color" title="No color" onClick={() => a.setColumnColor(column.id, null)}>
            <Icon name="close" size={11} />
          </button>
        </div>
      </div>

      <label className="folia-menu-field">
        <span className="folia-menu-label">WIP limit</span>
        <input
          type="number"
          min="0"
          value={wip}
          placeholder="none"
          aria-label="WIP limit"
          onChange={(e) => setWip(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitWip();
              onClose();
            }
          }}
          onBlur={commitWip}
        />
      </label>

      <div className="folia-menu-divider" />
      <button className="folia-menu-item" onClick={() => { onClose(); onEdit(); }}>
        <Icon name="pencil" size={14} /> Edit column…
      </button>

      <div className="folia-menu-divider" />
      <button className="folia-menu-item" disabled={isFirst} onClick={() => { a.moveColumn(column.id, -1); onClose(); }}>
        <Icon name="arrow-left" size={14} /> Move left
      </button>
      <button className="folia-menu-item" disabled={isLast} onClick={() => { a.moveColumn(column.id, 1); onClose(); }}>
        <Icon name="arrow-right" size={14} /> Move right
      </button>

      <div className="folia-menu-divider" />
      {!confirmDel ? (
        <button className="folia-menu-item folia-menu-danger" onClick={() => setConfirmDel(true)}>
          <Icon name="trash" size={14} /> Delete column
        </button>
      ) : (
        <div className="folia-menu-confirm" role="alertdialog" aria-label="Confirm delete column">
          <span>Delete “{column.title}”? Its cards move to a neighbouring column.</span>
          <div className="folia-row-actions">
            <button className="folia-btn folia-btn-danger" onClick={() => { a.deleteColumn(column.id); onClose(); }}>Delete</button>
            <button className="folia-btn" autoFocus onClick={() => setConfirmDel(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
