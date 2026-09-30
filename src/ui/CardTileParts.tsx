import type { Card, CardStats, ContextConfig } from "../model/types";
import type { UnreadState } from "../model/unread";
import type { CardChip } from "./cardView";
import { useBoardActions, useSubitemsCollapse } from "./context";
import { commentsTitle, progressWords } from "./cardWords";
import { Icon } from "./icons";
import { HostIconButton, HostProgressBar } from "./hostControls";

// The labels in these parts of the tile's face are never announced (see `tileName`): Obsidian shows
// an element's aria-label as its tooltip, and that is all they are for.

export function CardChips({
  card,
  ctx,
  chips,
}: {
  card: Card;
  ctx: ContextConfig | undefined;
  chips: readonly CardChip[];
}) {
  const ctxLabel = ctx?.label;
  if (!ctxLabel && chips.length === 0) return null;
  return (
    <div className="folia-chips">
      {ctxLabel && (
        <span
          className="folia-chip folia-chip-context"
          aria-label={`Context: ${ctx?.name ?? card.context}`}
        >
          {ctxLabel}
        </span>
      )}
      {chips.map((c) => (
        <span key={c.key} className={`folia-chip folia-chip-${c.tone}`} aria-label={c.tooltip}>
          {c.icon && <Icon name={c.icon} />}
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function CardProgress({ stats }: { stats: CardStats | undefined }) {
  if (!stats || stats.checklist === 0) return null;
  const allDone = stats.checklistDone === stats.checklist;
  return (
    <div
      className={"folia-progress" + (allDone ? " folia-is-complete" : "")}
      aria-label={progressWords(stats)}
    >
      <HostProgressBar
        slotClassName="folia-progress-slot"
        className="folia-progress-track"
        percent={(stats.checklistDone / stats.checklist) * 100}
      />
      <span className="folia-progress-label">
        {allDone ? <Icon name="check" /> : null}
        {stats.checklistDone}/{stats.checklist}
      </span>
    </div>
  );
}

export function CardNextTodos({ stats, limit }: { stats: CardStats | undefined; limit: number }) {
  if (!stats) return null;
  return (
    <ul className="folia-card-next-todos">
      {stats.nextTodos.slice(0, limit).map((t) => (
        <li key={t.index} className="folia-card-next-todo" data-todo-index={t.index}>
          <span className="folia-card-next-todo-mark" aria-hidden="true" />
          <span className="folia-card-next-todo-text">{t.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function CardMeta({ stats, unread }: { stats: CardStats | undefined; unread: UnreadState }) {
  if (!stats || (stats.subcards === 0 && stats.comments === 0)) return null;
  return (
    <div className="folia-card-meta">
      {stats.subcards > 0 && (
        <span aria-label={`${stats.subcards} subcard${stats.subcards === 1 ? "" : "s"}`}>
          <Icon name="git-branch" /> {stats.subcards}
        </span>
      )}
      {stats.comments > 0 && (
        <span
          className={unread.kind === "none" ? undefined : `folia-comments-${unread.kind}`}
          aria-label={commentsTitle(stats.comments, unread)}
        >
          <Icon name="message-square" /> {stats.comments}
          {/* Shape, not just colour: a plain dot for unread, an arrow for a reply — so the
              two states stay apart for anyone who cannot tell blue from purple. */}
          {unread.kind === "unread" && <span className="folia-unread-dot" aria-hidden="true" />}
          {unread.kind === "reply" && (
            <span className="folia-unread-reply-mark" aria-hidden="true">
              ↩
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * One control for both nested forms of subitem (§ collapse): toggling it hides/shows the tile's own
 * inline-todos preview AND the `SubcardGroup` its caller renders as the tile's next sibling — same
 * collapsed value, same `card.path` key.
 */
export function SubitemsToggle({ card, collapsed }: { card: Card; collapsed: boolean }) {
  const subitems = useSubitemsCollapse();
  const checklist = card.stats?.checklist ?? 0;
  const done = card.stats?.checklistDone ?? 0;
  return (
    <button
      className="folia-card-subitems-toggle"
      aria-expanded={!collapsed}
      // Names the card, not just the state: several of these buttons can sit in one screen
      // reader's buttons list at once, and "Hide subitems" alone can't tell them apart.
      aria-label={
        collapsed
          ? `Show ${checklist} subitems, ${done} done, for "${card.title}"`
          : `Hide subitems for "${card.title}"`
      }
      onClick={(e) => {
        e.stopPropagation();
        subitems.toggle(card.path);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Icon name="chevron-down" className={collapsed ? "folia-is-collapsed" : undefined} />
      {collapsed ? `${checklist} subitem${checklist === 1 ? "" : "s"}, ${done} done` : "Subitems"}
    </button>
  );
}

/** The `↳ parent` reference a subitem standing in a column of its own carries. */
export function ParentRef({
  parentPath,
  parentTitle,
}: {
  parentPath: string;
  parentTitle: string | undefined;
}) {
  const actions = useBoardActions();
  return (
    <button
      className="folia-card-parent-ref"
      aria-label={`Part of ${parentTitle ?? parentPath}`}
      onClick={(e) => {
        e.stopPropagation();
        actions.open(parentPath);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span aria-hidden="true">↳</span> {parentTitle ?? parentPath}
    </button>
  );
}

/** The hover-action cluster: done, open the note, delete. */
export function CardActions({
  card,
  notePath,
  canComplete,
}: {
  card: Card;
  notePath: string;
  canComplete: boolean;
}) {
  const actions = useBoardActions();
  const todoRef = card.todoRef;
  return (
    <div className="folia-card-actions">
      {canComplete && (
        <HostIconButton
          className="folia-card-action folia-action-done"
          icon="circle-check"
          label={`Mark "${card.title}" done`}
          stopPropagation={["click"]}
          onClick={() => actions.complete(card)}
        />
      )}
      <HostIconButton
        className="folia-card-action"
        icon="external-link"
        label={todoRef ? `Open note holding "${card.title}"` : `Open note for "${card.title}"`}
        stopPropagation={["click"]}
        // "Open in a new tab" by middle click, the one Obsidian gesture that needs no modifier.
        middleClick
        onClick={(evt) => actions.openNote(notePath, evt)}
      />
      <HostIconButton
        className="folia-card-action folia-action-delete"
        icon="trash-2"
        label={todoRef ? `Remove todo "${card.title}"` : `Delete "${card.title}"`}
        stopPropagation={["click"]}
        onClick={() => {
          // The line as this tile reads it now: the removal stays about what was clicked, even
          // when the note moves on while the confirm is open.
          if (todoRef) void actions.removeTodo(notePath, todoRef.line);
          else void actions.remove(card.path);
        }}
      />
    </div>
  );
}
