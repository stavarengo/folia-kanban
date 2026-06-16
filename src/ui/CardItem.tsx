import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, CardStats } from "../model/types";
import { cardChips, cardUrgency, priorityTone } from "./cardView";
import { CardContextMenu, type ContextTarget } from "./CardContextMenu";
import { useBoardActions, useContexts, useSettings } from "./context";
import { Icon } from "./icons";

interface Props {
  card: Card;
  today: string;
  selected: boolean;
  /** A nested subcard rendered inside its parent's `.mdkb-subcard-group`: not drag-reorderable,
   *  rendered without a drag affordance, but keeps click/keyboard open and the context menu. */
  nested?: boolean;
}

function CardItemInner({ card, today, selected, nested = false }: Props) {
  const actions = useBoardActions();
  const contexts = useContexts();
  const { cardNextTodos } = useSettings();
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  // #12 inline title edit: when set, the title swaps for an <input> seeded with this draft.
  const [editing, setEditing] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // Hooks can't be conditional, so always call useSortable — but disable it for nested children so
  // they aren't draggable and aren't registered as drop targets in the parent's SortableContext.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.path,
    disabled: nested,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const chips = cardChips(card, today, actions.doneColumnId);
  const stats = card.stats;
  const fm = card.frontmatter;
  const prio = typeof fm.priority === "string" && fm.priority ? priorityTone(fm.priority) : null;
  // Context grouping (#14): the card's folder-derived context + its (optional) config. The marker
  // is a left accent strip (inset clear of the priority bar) + a label badge, so cards sharing a
  // context read as a group within a column. Subfolders without a `_context.md` just have a name.
  const ctx = typeof card.context === "string" ? contexts[card.context] : undefined;
  const ctxColor = ctx?.color;
  const ctxLabel = ctx?.label;
  // #3 card-level urgency cue (distinct from the due chip): tints the whole card as the due date
  // nears, strongest when overdue. null = no cue (future / done / no date), keeping defaults neutral.
  const urgency = cardUrgency(card, today, actions.doneColumnId);

  const allDone = !!stats && stats.checklist > 0 && stats.checklistDone === stats.checklist;
  // Hide the hover-action cluster while renaming: focus-within would otherwise reveal it over the
  // full-width title <input> (which has no right gutter), letting buttons cover the caret/text.
  const showActions = !confirming && editing == null;
  const canComplete = actions.doneColumnId != null && fm.status !== actions.doneColumnId;

  const open = () => {
    if (!isDragging) actions.open(card.path);
  };
  // Right-click opens a context-aware menu. preventDefault stops Obsidian's own context menu;
  // dnd-kit's PointerSensor only activates on the left button, so this never starts a drag.
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const todoEl = (e.target as HTMLElement).closest(".mdkb-card-next-todo");
    const todoIndex = todoEl ? Number(todoEl.getAttribute("data-todo-index")) : NaN;
    setMenu(
      todoEl && Number.isFinite(todoIndex)
        ? { x: e.clientX, y: e.clientY, kind: "todo", todoIndex }
        : { x: e.clientX, y: e.clientY, kind: "card" },
    );
  };
  // Merge dnd-kit keyboard handling (Space = pick up) with Enter = open.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      actions.open(card.path);
      return;
    }
    (listeners as { onKeyDown?: (e: KeyboardEvent) => void } | undefined)?.onKeyDown?.(e);
  };

  // #12 inline title edit. Entered via the right-click menu's "Rename" (a single title click can't
  // trigger it — that opens the detail), which calls setEditing(basename) to swap in the <input>.
  const commitEdit = () => {
    if (editing == null) return;
    const next = editing.trim();
    // Rename only on a real change; empty/whitespace is rejected (revert). renameCard renames the
    // .md file via the link-aware path so the board title (= basename) updates and wikilinks follow.
    if (next && next !== card.basename) actions.renameCard(card.path, next);
    setEditing(null);
  };
  const onEditKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // keep typing (incl. Space) out of the dnd keyboard sensor
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null); // cancel — no write
    }
  };
  // Focus + select-all once the input mounts.
  useEffect(() => {
    if (editing != null) {
      const el = titleInputRef.current;
      el?.focus();
      el?.select();
    }
  }, [editing != null]);

  return (
    <div
      ref={setNodeRef}
      style={ctxColor ? { ...style, ["--mdkb-ctx-color" as string]: ctxColor } : style}
      className={
        "mdkb-card" +
        (nested ? " mdkb-card--nested" : "") +
        (selected ? " is-selected" : "") +
        (isDragging ? " is-dragging" : "") +
        (card.context ? " mdkb-card--has-context" : "")
      }
      data-testid="card"
      data-path={card.path}
      data-prio={prio ?? undefined}
      data-context={card.context ?? undefined}
      data-urgency={urgency ?? undefined}
      onContextMenu={onContextMenu}
    >
      {/* #14 context grouping: a left accent strip, shown only when the context defines a color
          (inset past the priority bar so the two left-edge cues don't overlap). */}
      {ctxColor && <span className="mdkb-card-context" aria-hidden="true" />}
      <div
        className="mdkb-card-main"
        // Nested cards aren't draggable: skip the drag listeners/attributes (which also supply
        // tabIndex/role), and restore keyboard reachability + open semantics explicitly.
        {...(nested ? { tabIndex: 0, role: "button" } : attributes)}
        {...(nested ? {} : listeners)}
        onClick={open}
        onKeyDown={onKeyDown}
        aria-label={card.basename}
        aria-current={selected ? "true" : undefined}
      >
        {editing != null ? (
          <input
            ref={titleInputRef}
            className="mdkb-card-title-input"
            value={editing}
            aria-label="Card title"
            // Stop the parent's click/pointer/keyboard handlers (open, drag) from firing while editing.
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={onEditKeyDown}
            onBlur={commitEdit}
          />
        ) : (
          <div className="mdkb-card-title">{card.basename}</div>
        )}
        {(ctxLabel || chips.length > 0) && (
          <div className="mdkb-chips">
            {ctxLabel && (
              <span
                className="mdkb-chip mdkb-chip-context"
                title={`Context: ${ctx?.name ?? card.context}`}
              >
                {ctxLabel}
              </span>
            )}
            {chips.map((c) => (
              <span key={c.key} className={`mdkb-chip mdkb-chip-${c.tone}`} title={c.title}>
                {c.icon && <Icon name={c.icon} size={11} />}
                {c.label}
              </span>
            ))}
          </div>
        )}
        {stats && stats.checklist > 0 && (
          <div
            className={"mdkb-progress" + (allDone ? " is-complete" : "")}
            title={`${stats.checklistDone} of ${stats.checklist} subtasks done`}
            aria-label={`${stats.checklistDone} of ${stats.checklist} subtasks done`}
          >
            <div className="mdkb-progress-track">
              <div
                className="mdkb-progress-fill"
                style={{ width: `${(stats.checklistDone / stats.checklist) * 100}%` }}
              />
            </div>
            <span className="mdkb-progress-label">
              {allDone ? <Icon name="check" size={12} /> : null}
              {stats.checklistDone}/{stats.checklist}
            </span>
          </div>
        )}
        {stats && cardNextTodos > 0 && stats.nextTodos.length > 0 && (
          <ul className="mdkb-card-next-todos">
            {stats.nextTodos.slice(0, cardNextTodos).map((t) => (
              <li key={t.index} className="mdkb-card-next-todo" data-todo-index={t.index}>
                <span className="mdkb-card-next-todo-mark" aria-hidden="true" />
                <span className="mdkb-card-next-todo-text">{t.text}</span>
              </li>
            ))}
          </ul>
        )}
        {stats && (stats.subcards > 0 || stats.comments > 0) && (
          <div className="mdkb-card-meta">
            {stats.subcards > 0 && (
              <span title="Subcards" aria-label={`${stats.subcards} subcard${stats.subcards === 1 ? "" : "s"}`}>
                <Icon name="git-branch" size={13} /> {stats.subcards}
              </span>
            )}
            {stats.comments > 0 && (
              <span title="Comments" aria-label={`${stats.comments} comment${stats.comments === 1 ? "" : "s"}`}>
                <Icon name="message" size={13} /> {stats.comments}
              </span>
            )}
          </div>
        )}
      </div>

      {showActions && (
        <div className="mdkb-card-actions">
          {canComplete && (
            <button
              className="mdkb-icon-btn mdkb-action-done"
              aria-label={`Mark "${card.basename}" done`}
              title="Mark done"
              onClick={(e) => {
                e.stopPropagation();
                actions.complete(card.path);
              }}
            >
              <Icon name="check-circle" size={15} />
            </button>
          )}
          <button
            className="mdkb-icon-btn"
            aria-label={`Open note for "${card.basename}"`}
            title="Open note"
            onClick={(e) => {
              e.stopPropagation();
              actions.openNote(card.path);
            }}
          >
            <Icon name="external-link" size={15} />
          </button>
          <button
            className="mdkb-icon-btn mdkb-action-delete"
            aria-label={`Delete "${card.basename}"`}
            title="Delete card"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}

      {confirming && (
        <div className="mdkb-card-confirm" role="alertdialog" aria-label={`Delete ${card.basename}?`}>
          <span>Delete card?</span>
          <div className="mdkb-row-actions">
            <button
              className="mdkb-btn mdkb-btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                actions.remove(card.path);
              }}
            >
              Delete
            </button>
            <button
              className="mdkb-btn"
              autoFocus
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {menu &&
        (() => {
          const edges = actions.columnEdges(card.path);
          return (
            <CardContextMenu
              target={menu}
              path={card.path}
              priority={typeof fm.priority === "string" ? fm.priority : ""}
              isDone={!canComplete}
              canMoveUp={edges.canMoveUp}
              canMoveDown={edges.canMoveDown}
              onRename={() => setEditing(card.basename)}
              onClose={() => setMenu(null)}
            />
          );
        })()}
    </div>
  );
}

function sameStats(a?: CardStats, b?: CardStats): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.checklist === b.checklist &&
    a.checklistDone === b.checklistDone &&
    a.subcards === b.subcards &&
    a.comments === b.comments &&
    a.nextTodos.map((t) => `${t.index}:${t.text}`).join("\n") ===
      b.nextTodos.map((t) => `${t.index}:${t.text}`).join("\n")
  );
}

// A board reload rebuilds Card objects, but an unchanged card keeps the same frontmatter
// reference (Obsidian's metadataCache) — so only genuinely-changed cards re-render.
export const CardItem = memo(
  CardItemInner,
  (a, b) =>
    a.selected === b.selected &&
    a.nested === b.nested &&
    a.today === b.today &&
    a.card.path === b.card.path &&
    a.card.basename === b.card.basename &&
    a.card.frontmatter === b.card.frontmatter &&
    sameStats(a.card.stats, b.card.stats),
);
