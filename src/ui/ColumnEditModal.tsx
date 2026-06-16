import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ColumnDef, ColumnGroup, ColumnSort } from "../model/types";
import { useBoardActions } from "./context";
import { Icon } from "./icons";

const COLORS = ["#4c9aff", "#8fd14f", "#ffab00", "#9c8cff", "#ff5c5c", "#57d9a3", "#f78fb3", "#9aa0a6"];

interface Props {
  column: ColumnDef;
  onClose: () => void;
}

/** Local draft of the editable column fields. Strings for the inputs; converted on save. */
interface Draft {
  title: string;
  color: string | undefined;
  limit: string; // raw input; "" = none
  filter: string;
  group: ColumnGroup;
  sort: ColumnSort;
  opacity: number; // 0–1
  hoverOpacity: string; // raw 0–100 percent input; "" = unset (reveal to full)
  parked: boolean;
}

function toDraft(c: ColumnDef): Draft {
  return {
    title: c.title,
    color: c.color,
    limit: c.limit != null ? String(c.limit) : "",
    filter: c.filter ?? "",
    group: c.group ?? "none",
    sort: c.sort ?? "manual",
    opacity: typeof c.opacity === "number" ? c.opacity : 1,
    hoverOpacity: typeof c.hoverOpacity === "number" ? String(Math.round(c.hoverOpacity * 100)) : "",
    parked: c.parked === true,
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The full "Edit column" editor (#8). A modal exposing EVERY editable ColumnDef property:
 * title, color, WIP limit, filter rule (#1), group + sort (#6), opacity / hover-opacity / parked
 * (#10). Saving builds one patch and calls `updateColumn`, which routes through the byte-stable
 * `setColumns` write path. Default-valued / blank fields are pruned by §2 serialize on persist.
 */
export function ColumnEditModal({ column, onClose }: Props) {
  const a = useBoardActions();
  const [draft, setDraft] = useState<Draft>(() => toDraft(column));
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    const title = draft.title.trim();
    if (!title) {
      // An empty title is rejected; keep the modal open so the user can fix it.
      titleRef.current?.focus();
      return;
    }
    const limit = draft.limit.trim() === "" ? undefined : Math.max(0, Math.floor(Number(draft.limit) || 0)) || undefined;
    const filter = draft.filter.trim();
    const hoverPct = draft.hoverOpacity.trim();
    const hoverOpacity = hoverPct === "" ? undefined : Math.min(1, Math.max(0, Number(hoverPct) / 100));
    const patch: Partial<ColumnDef> = {
      title,
      color: draft.color ?? undefined,
      limit,
      filter: filter || undefined,
      group: draft.group,
      sort: draft.sort,
      opacity: Math.min(1, Math.max(0, draft.opacity)),
      hoverOpacity: Number.isFinite(hoverOpacity as number) ? hoverOpacity : undefined,
      parked: draft.parked,
    };
    a.updateColumn(column.id, patch);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const faded = draft.opacity < 1;

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div className="mdkb-modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="mdkb-modal mdkb-col-edit"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit column: ${column.title}`}
        onKeyDown={onKeyDown}
      >
        <header className="mdkb-modal-header">
          <h2 className="mdkb-modal-title">Edit column</h2>
          <button className="mdkb-icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="mdkb-modal-body">
          <label className="mdkb-field">
            <span className="mdkb-field-label">Title</span>
            <input
              ref={titleRef}
              value={draft.title}
              aria-label="Column title"
              onChange={(e) => set("title", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
          </label>

          <div className="mdkb-field">
            <span className="mdkb-field-label">Color</span>
            <div className="mdkb-swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={"mdkb-swatch" + (draft.color?.toLowerCase() === c.toLowerCase() ? " is-active" : "")}
                  style={{ background: c }}
                  aria-label={`Set color ${c}`}
                  aria-pressed={draft.color?.toLowerCase() === c.toLowerCase()}
                  onClick={() => set("color", c)}
                />
              ))}
              <button
                type="button"
                className="mdkb-swatch mdkb-swatch-none"
                aria-label="Clear color"
                title="No color"
                onClick={() => set("color", undefined)}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>

          <label className="mdkb-field">
            <span className="mdkb-field-label">WIP limit</span>
            <input
              type="number"
              min="0"
              value={draft.limit}
              placeholder="none"
              aria-label="WIP limit"
              onChange={(e) => set("limit", e.target.value)}
            />
          </label>

          <label className="mdkb-field">
            <span className="mdkb-field-label">Filter rule</span>
            <input
              value={draft.filter}
              placeholder="e.g. area:research status:todo"
              aria-label="Filter rule"
              onChange={(e) => set("filter", e.target.value)}
            />
            <span className="mdkb-field-hint">Shows only cards matching this query. Leave blank to show all.</span>
          </label>

          <div className="mdkb-field-row">
            <label className="mdkb-field">
              <span className="mdkb-field-label">Group by</span>
              <select aria-label="Group by" value={draft.group} onChange={(e) => set("group", e.target.value as ColumnGroup)}>
                <option value="none">None</option>
                <option value="due">Due date</option>
              </select>
            </label>
            <label className="mdkb-field">
              <span className="mdkb-field-label">Sort by</span>
              <select aria-label="Sort by" value={draft.sort} onChange={(e) => set("sort", e.target.value as ColumnSort)}>
                <option value="manual">Manual</option>
                <option value="priority">Priority</option>
                <option value="due">Due date</option>
              </select>
            </label>
          </div>

          <label className="mdkb-field">
            <span className="mdkb-field-label">Opacity — {pct(draft.opacity)}</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={draft.opacity}
              aria-label="Opacity"
              onChange={(e) => set("opacity", Number(e.target.value))}
            />
          </label>

          {faded && (
            <label className="mdkb-field">
              <span className="mdkb-field-label">Reveal on hover — {draft.hoverOpacity.trim() === "" ? "full" : `${draft.hoverOpacity}%`}</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={draft.hoverOpacity === "" ? "100" : draft.hoverOpacity}
                aria-label="Hover reveal opacity"
                onChange={(e) => set("hoverOpacity", e.target.value)}
              />
            </label>
          )}

          <label className="mdkb-field mdkb-field-toggle">
            <input
              type="checkbox"
              checked={draft.parked}
              aria-label="Park aside"
              onChange={(e) => set("parked", e.target.checked)}
            />
            <span>
              <span className="mdkb-field-label">Park aside</span>
              <span className="mdkb-field-hint">Move this column off to the far right (de-emphasise a rabbit-hole column).</span>
            </span>
          </label>
        </div>

        <footer className="mdkb-modal-footer">
          <button className="mdkb-btn" onClick={onClose}>Cancel</button>
          <button className="mdkb-btn mdkb-btn-primary" onClick={save}>Save</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
