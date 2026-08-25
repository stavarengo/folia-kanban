import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, CardStats } from "../model/types";
import type { UnreadState } from "../model/unread";
import { cardChips, cardUrgency, priorityTone, relationChips } from "./cardView";
import { CardContextMenu, type ContextTarget } from "./CardContextMenu";
import {
  useBoardActions,
  useContexts,
  useRelationCounts,
  useSettings,
  useSubitemsCollapse,
  useUnreadComments,
} from "./context";
import { Icon } from "./icons";

interface Props {
  card: Card;
  /** The sortable id to register for this top-level card, computed by Column. Normally namespaced
   *  `${columnId}::${card.path}` (so a card mirrored into a cross-board lane (#1) and its status
   *  column don't collide on one id), but the ORIGINAL id while this card is the target of a live
   *  cross-column relocation (see Column). Column owns it so its SortableContext item set and this
   *  sortable can't diverge. Omitted for nested subcards (which are non-draggable). */
  dragId?: string;
  today: string;
  selected: boolean;
  /** A nested subcard rendered inside its parent's `.folia-subcard-group`: not drag-reorderable,
   *  rendered without a drag affordance, but keeps click/keyboard open and the context menu. */
  nested?: boolean;
  /** Set when this tile is a SUBITEM sitting in a column of its own: the note it belongs to. Drives
   *  the `↳ parent` reference line that replaces the nesting as the visible sign of whose work it is. */
  parentPath?: string | undefined;
  /** That parent's title, for the reference line. */
  parentTitle?: string | undefined;
  /** Whether this card has its own subcard children (a non-empty `board.childrenOf[card.path]`),
   *  computed by the caller (Column/SubcardGroup) since only they hold the board graph. Together
   *  with the card's own inline-todos preview this decides whether the collapse/expand toggle
   *  shows at all — a card with nothing nested gets no control. */
  hasSubcardChildren?: boolean;
}

function CardItemInner({
  card,
  dragId,
  today,
  selected,
  nested = false,
  parentPath,
  parentTitle,
  hasSubcardChildren = false,
}: Props) {
  const actions = useBoardActions();
  const contexts = useContexts();
  const { cardNextTodos } = useSettings();
  const subitems = useSubitemsCollapse();
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  // #12 inline title edit: when set, the title swaps for an <input> seeded with this draft.
  const [editing, setEditing] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // Hooks can't be conditional, so always call useSortable — but disable it for nested children so
  // they aren't draggable and aren't registered as drop targets in the parent's SortableContext.
  // Top-level cards use the `dragId` Column computed (`col::path`, or the original id while this card
  // is mid cross-column relocation) so the sortable identity matches the column's SortableContext
  // item set — and so the same card in a lane + its status column registers two distinct sortables.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: nested || dragId == null ? card.path : dragId,
    disabled: nested,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    // The lifted card is rendered by the DragOverlay; the original collapses to a quiet placeholder.
    // Keep it above settling neighbours so the dashed outline isn't clipped during the drop animation.
    zIndex: isDragging ? 1 : undefined,
  };
  // Blocking markers come from the board graph (a link on ANOTHER card decides what this one
  // shows), so they arrive through their own context rather than this card's memoized props.
  const relations = useRelationCounts()[card.path];
  // Unread comments (§ unread): read-state lives in plugin data, not the note, so it is read here
  // from settings rather than arriving on the memoized card. `reply` = an unread comment that
  // landed after one of your own.
  const unread = useUnreadComments(card.path, card.stats?.commentMarks);
  const chips = [...relationChips(relations), ...cardChips(card, today, actions.doneColumnId)];
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
  // Subitems (§ collapse): anything that would render nested under this tile — its own inline-todos
  // preview (gated by the same `cardNextTodos` cap the list below uses) and/or its subcard children
  // (rendered as a sibling `SubcardGroup` by the caller). No toggle when neither exists.
  const hasNextTodosPreview = cardNextTodos > 0 && (stats?.nextTodos.length ?? 0) > 0;
  const hasNestedSubitems = hasSubcardChildren || hasNextTodosPreview;
  const subitemsCollapsed = hasNestedSubitems && subitems.isCollapsed(card.path);
  // Hide the hover-action cluster while renaming: focus-within would otherwise reveal it over the
  // full-width title <input> (which has no right gutter), letting buttons cover the caret/text.
  const showActions = !confirming && editing == null;
  const canComplete = actions.doneColumnId != null && fm.status !== actions.doneColumnId;

  // An inline todo has no note of its own: its checklist line lives in its parent, so every action
  // that needs a file addresses the parent, and the tile's own actions are the todo actions.
  const todoRef = card.todoRef;
  const notePath = todoRef ? todoRef.parentPath : card.path;

  const open = () => {
    if (!isDragging) actions.open(notePath);
  };
  // Right-click opens a context-aware menu. preventDefault stops Obsidian's own context menu;
  // dnd-kit's PointerSensor only activates on the left button, so this never starts a drag.
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const todoEl = (e.target as HTMLElement).closest(".folia-card-next-todo");
    const todoIndex = todoEl ? Number(todoEl.getAttribute("data-todo-index")) : NaN;
    setMenu(
      todoRef
        ? { x: e.clientX, y: e.clientY, kind: "todo", todoIndex: todoRef.index }
        : todoEl && Number.isFinite(todoIndex)
          ? { x: e.clientX, y: e.clientY, kind: "todo", todoIndex }
          : { x: e.clientX, y: e.clientY, kind: "card" },
    );
  };
  // Merge dnd-kit keyboard handling (Space = pick up) with Enter = open.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      actions.open(notePath);
      return;
    }
    (listeners as { onKeyDown?: (e: KeyboardEvent) => void } | undefined)?.onKeyDown?.(e);
  };

  // #12 inline title edit. Entered via the right-click menu's "Rename" (a single title click can't
  // trigger it — that opens the detail), which calls setEditing(title) to swap in the <input>.
  const commitEdit = () => {
    if (editing == null) return;
    const next = editing.trim();
    // Rename only on a real change; empty/whitespace is rejected (revert). renameCard writes the
    // title back to its source (file name, heading or `title` key), link-aware for file renames.
    if (next && next !== card.title) actions.renameCard(card.path, next);
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
      style={ctxColor ? { ...style, ["--folia-ctx-color" as string]: ctxColor } : style}
      className={
        "folia-card" +
        (nested ? " folia-card--nested" : "") +
        (parentPath ? " folia-card--subitem" : "") +
        (todoRef ? " folia-card--todo" : "") +
        (selected ? " is-selected" : "") +
        (isDragging ? " is-dragging" : "") +
        (card.context ? " folia-card--has-context" : "")
      }
      data-testid="card"
      data-path={card.path}
      data-subitem={parentPath ? (todoRef ? "todo" : "card") : undefined}
      data-prio={prio ?? undefined}
      data-context={card.context ?? undefined}
      data-urgency={urgency ?? undefined}
      onContextMenu={onContextMenu}
    >
      {/* #14 context grouping: a left accent strip, shown only when the context defines a color
          (inset past the priority bar so the two left-edge cues don't overlap). */}
      {ctxColor && <span className="folia-card-context-strip" aria-hidden="true" />}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- role + tabIndex come from the spread dnd attributes (sortable: role="button", tabIndex=0) or the explicit nested branch */}
      <div
        className="folia-card-main"
        // Nested cards aren't draggable: skip the drag listeners/attributes (which also supply
        // tabIndex/role), and restore keyboard reachability + open semantics explicitly.
        {...(nested ? { tabIndex: 0, role: "button" } : attributes)}
        {...(nested ? {} : listeners)}
        onClick={open}
        onKeyDown={onKeyDown}
        aria-label={card.title}
        aria-current={selected ? "true" : undefined}
      >
        {editing != null ? (
          <input
            ref={titleInputRef}
            className="folia-card-title-input"
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
          <div className="folia-card-title">{card.title}</div>
        )}
        {(ctxLabel || chips.length > 0) && (
          <div className="folia-chips">
            {ctxLabel && (
              <span
                className="folia-chip folia-chip-context"
                title={`Context: ${ctx?.name ?? card.context}`}
              >
                {ctxLabel}
              </span>
            )}
            {chips.map((c) => (
              <span key={c.key} className={`folia-chip folia-chip-${c.tone}`} title={c.title}>
                {c.icon && <Icon name={c.icon} size={11} />}
                {c.label}
              </span>
            ))}
          </div>
        )}
        {stats && stats.checklist > 0 && (
          <div
            className={"folia-progress" + (allDone ? " is-complete" : "")}
            title={`${stats.checklistDone} of ${stats.checklist} subtasks done`}
            aria-label={`${stats.checklistDone} of ${stats.checklist} subtasks done`}
          >
            <div className="folia-progress-track">
              <div
                className="folia-progress-fill"
                style={{ width: `${(stats.checklistDone / stats.checklist) * 100}%` }}
              />
            </div>
            <span className="folia-progress-label">
              {allDone ? <Icon name="check" size={12} /> : null}
              {stats.checklistDone}/{stats.checklist}
            </span>
          </div>
        )}
        {!subitemsCollapsed && stats && cardNextTodos > 0 && stats.nextTodos.length > 0 && (
          <ul className="folia-card-next-todos">
            {stats.nextTodos.slice(0, cardNextTodos).map((t) => (
              <li key={t.index} className="folia-card-next-todo" data-todo-index={t.index}>
                <span className="folia-card-next-todo-mark" aria-hidden="true" />
                <span className="folia-card-next-todo-text">{t.text}</span>
              </li>
            ))}
          </ul>
        )}
        {stats && (stats.subcards > 0 || stats.comments > 0) && (
          <div className="folia-card-meta">
            {stats.subcards > 0 && (
              <span
                title="Subcards"
                aria-label={`${stats.subcards} subcard${stats.subcards === 1 ? "" : "s"}`}
              >
                <Icon name="git-branch" size={13} /> {stats.subcards}
              </span>
            )}
            {stats.comments > 0 && (
              <span
                className={unread.kind === "none" ? undefined : `folia-comments-${unread.kind}`}
                title={commentsTitle(stats.comments, unread)}
                aria-label={commentsTitle(stats.comments, unread)}
              >
                <Icon name="message" size={13} /> {stats.comments}
                {/* Shape, not just colour: a plain dot for unread, an arrow for a reply — so the
                    two states stay apart for anyone who cannot tell blue from purple. */}
                {unread.kind === "unread" && (
                  <span className="folia-unread-dot" aria-hidden="true" />
                )}
                {unread.kind === "reply" && (
                  <span className="folia-unread-reply-mark" aria-hidden="true">
                    ↩
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sibling of `.folia-card-main`, same reason as the buttons below: that div carries
          `role="button"` and a nested interactive element inside it would be unreachable to
          assistive tech. One control for both nested forms of subitem (§ collapse): toggling it
          hides/shows this tile's own inline-todos preview above AND the `SubcardGroup` its caller
          renders as this tile's next sibling — same collapsed value, same `card.path` key. */}
      {hasNestedSubitems && (
        <button
          className="folia-card-subitems-toggle"
          aria-expanded={!subitemsCollapsed}
          // Names the card, not just the state: several of these buttons can sit in one screen
          // reader's buttons list at once, and "Hide subitems" alone can't tell them apart.
          aria-label={
            subitemsCollapsed
              ? `Show ${stats?.checklist ?? 0} subitems, ${stats?.checklistDone ?? 0} done, for "${card.title}"`
              : `Hide subitems for "${card.title}"`
          }
          onClick={(e) => {
            e.stopPropagation();
            subitems.toggle(card.path);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Icon
            name="chevron-down"
            size={13}
            className={subitemsCollapsed ? "is-collapsed" : undefined}
          />
          {subitemsCollapsed
            ? `${stats?.checklist ?? 0} subitem${(stats?.checklist ?? 0) === 1 ? "" : "s"}, ${stats?.checklistDone ?? 0} done`
            : "Subitems"}
        </button>
      )}

      {/* Sibling of `.folia-card-main`, never inside it: that div carries `role="button"` (from the
          drag attributes, or the explicit nested branch), and a button within it is unreachable to
          assistive tech — the same reason the action cluster below lives out here. */}
      {parentPath && (
        <button
          className="folia-card-parent-ref"
          title={`Part of ${parentTitle ?? parentPath}`}
          aria-label={`Part of ${parentTitle ?? parentPath}`}
          onClick={(e) => {
            e.stopPropagation();
            actions.open(parentPath);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span aria-hidden="true">↳</span> {parentTitle ?? parentPath}
        </button>
      )}

      {showActions && (
        <div className="folia-card-actions">
          {canComplete && (
            <button
              className="folia-icon-btn folia-action-done"
              aria-label={`Mark "${card.title}" done`}
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
            className="folia-icon-btn"
            aria-label={
              todoRef ? `Open note holding "${card.title}"` : `Open note for "${card.title}"`
            }
            title="Open note"
            onClick={(e) => {
              e.stopPropagation();
              actions.openNote(notePath);
            }}
          >
            <Icon name="external-link" size={15} />
          </button>
          <button
            className="folia-icon-btn folia-action-delete"
            aria-label={todoRef ? `Remove todo "${card.title}"` : `Delete "${card.title}"`}
            title={todoRef ? "Remove todo" : "Delete card"}
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
        <div
          className="folia-card-confirm"
          role="alertdialog"
          aria-label={todoRef ? `Remove todo ${card.title}?` : `Delete ${card.title}?`}
        >
          <span>{todoRef ? "Remove todo?" : "Delete card?"}</span>
          <div className="folia-row-actions">
            <button
              className="folia-btn folia-btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                if (todoRef) actions.removeTodo(todoRef.parentPath, todoRef.index);
                else actions.remove(card.path);
              }}
            >
              {todoRef ? "Remove" : "Delete"}
            </button>
            <button
              className="folia-btn"
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
              path={notePath}
              // The line's OWN words, not where the tile renders: a checked line sits in the done
              // column whatever it claims, and the menu must not offer to "move" it to the column
              // it is already showing while quietly rewriting the line to something else. Read off
              // the tile for a placed todo, and off this card's checklist for a next-todo row
              // surfaced on it — the same line either way, so the two must not answer differently.
              todoColumn={
                todoRef
                  ? todoRef.claim
                  : (card.subItems?.find((i) => i.index === menu.todoIndex)?.status ?? "")
              }
              priority={typeof fm.priority === "string" ? fm.priority : ""}
              isDone={!canComplete}
              canMoveUp={edges.canMoveUp}
              canMoveDown={edges.canMoveDown}
              onRename={() => setEditing(card.title)}
              onClose={() => setMenu(null)}
            />
          );
        })()}
    </div>
  );
}

/**
 * The comment badge's tooltip and accessible name — additive, so the count a sighted user reads is
 * still spoken, with what is new appended rather than replacing it.
 */
function commentsTitle(total: number, unread: UnreadState): string {
  const base = `${total} comment${total === 1 ? "" : "s"}`;
  if (unread.kind === "none") return base;
  const news = `${unread.indices.length} unread`;
  return unread.kind === "reply" ? `${base}, ${news} \u2014 a reply to yours` : `${base}, ${news}`;
}

/** The claims a card's checklist lines make, as one comparable string (see the memo below). */
function claimsOf(card: Card): string {
  return (card.subItems ?? []).map((i) => `${i.index}:${i.status ?? ""}`).join("|");
}

function sameStats(a?: CardStats, b?: CardStats): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.checklist === b.checklist &&
    a.checklistDone === b.checklistDone &&
    a.subcards === b.subcards &&
    a.comments === b.comments &&
    a.commentMarks.map((c) => `${c.timestamp}:${c.author ?? ""}`).join("\n") ===
      b.commentMarks.map((c) => `${c.timestamp}:${c.author ?? ""}`).join("\n") &&
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
    a.dragId === b.dragId &&
    a.today === b.today &&
    a.card.path === b.card.path &&
    a.card.title === b.card.title &&
    a.parentPath === b.parentPath &&
    a.parentTitle === b.parentTitle &&
    a.hasSubcardChildren === b.hasSubcardChildren &&
    a.card.todoRef?.parentPath === b.card.todoRef?.parentPath &&
    a.card.todoRef?.index === b.card.todoRef?.index &&
    a.card.todoRef?.claim === b.card.todoRef?.claim &&
    // Setting a claim on a todo that stays inline changes neither the stats nor the frontmatter
    // reference, so without this the row's context menu would go on showing the old column.
    claimsOf(a.card) === claimsOf(b.card) &&
    a.card.frontmatter.status === b.card.frontmatter.status &&
    (a.card.todoRef != null || a.card.frontmatter === b.card.frontmatter) &&
    sameStats(a.card.stats, b.card.stats),
);
