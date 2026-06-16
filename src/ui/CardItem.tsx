import { memo, useState, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, CardStats } from "../model/types";
import { cardChips, priorityTone } from "./cardView";
import { useBoardActions } from "./context";
import { Icon } from "./icons";

interface Props {
  card: Card;
  today: string;
  selected: boolean;
}

function CardItemInner({ card, today, selected }: Props) {
  const actions = useBoardActions();
  const [confirming, setConfirming] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.path,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const chips = cardChips(card, today, actions.doneColumnId);
  const stats = card.stats;
  const fm = card.frontmatter;
  const prio = typeof fm.priority === "string" && fm.priority ? priorityTone(fm.priority) : null;

  const allDone = !!stats && stats.checklist > 0 && stats.checklistDone === stats.checklist;
  const showActions = !confirming;
  const canComplete = actions.doneColumnId != null && fm.status !== actions.doneColumnId;

  const open = () => {
    if (!isDragging) actions.open(card.path);
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={"mdkb-card" + (selected ? " is-selected" : "") + (isDragging ? " is-dragging" : "")}
      data-testid="card"
      data-path={card.path}
      data-prio={prio ?? undefined}
    >
      <div
        className="mdkb-card-main"
        {...attributes}
        {...listeners}
        onClick={open}
        onKeyDown={onKeyDown}
        aria-label={card.basename}
        aria-current={selected ? "true" : undefined}
      >
        <div className="mdkb-card-title">{card.basename}</div>
        {chips.length > 0 && (
          <div className="mdkb-chips">
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
    a.nextTodos.join("\n") === b.nextTodos.join("\n")
  );
}

// A board reload rebuilds Card objects, but an unchanged card keeps the same frontmatter
// reference (Obsidian's metadataCache) — so only genuinely-changed cards re-render.
export const CardItem = memo(
  CardItemInner,
  (a, b) =>
    a.selected === b.selected &&
    a.today === b.today &&
    a.card.path === b.card.path &&
    a.card.basename === b.card.basename &&
    a.card.frontmatter === b.card.frontmatter &&
    sameStats(a.card.stats, b.card.stats),
);
