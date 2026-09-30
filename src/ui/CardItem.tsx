import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, CardStats } from "../model/types";
import type { MenuAnchor } from "../model/repo";
import { sameLine } from "../model/board";
import type { UnreadState } from "../model/unread";
import { cardChips, cardUrgency, isCompletable, priorityTone, relationChips } from "./cardView";
import { cardMenu, todoMenu } from "./menus";
import {
  useBoardActions,
  useContexts,
  useRelationCounts,
  useRepo,
  useSettings,
  useSubitemsCollapse,
  useUnreadComments,
} from "./context";
import { Icon } from "./icons";
import { HostIconButton, HostProgressBar } from "./hostControls";
import { useReducedMotion } from "./useReducedMotion";

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
  /** A subcard rendered inside its parent's `.folia-subcard-group`: drawn smaller and quieter than
   *  a tile standing in a column, and not drag-reorderable. A card standing at a column's top level
   *  is never `nested`, even when it cannot be dragged (see `dragId`). */
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
  const repo = useRepo();
  const { cardNextTodos, userName } = useSettings();
  const subitems = useSubitemsCollapse();
  // #12 inline title edit: when set, the title swaps for an <input> seeded with this draft.
  const [editing, setEditing] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // The card as last drawn, for a menu row picked after a reload the open menu outlived.
  const latest = useRef(card);
  /** The menu key held since it opened the card menu (see `onContextMenu`). */
  const menuKey = useRef<string | null>(null);
  latest.current = card;
  // Two ways a tile is not drag-reorderable: it is nested inside its parent's group, or Column
  // withheld a `dragId` because this tile is not a member of any column bucket right now (a subcard
  // the active filter lifted past a non-matching parent — a drop onto it could not be resolved).
  // Either way it must not register as a drop target in the surrounding SortableContext, nor
  // advertise itself as draggable; both keep click/keyboard open and the context menu.
  //
  // Hooks can't be conditional, so always call useSortable and disable it instead. A draggable tile
  // uses the `dragId` Column computed (`col::path`, or the original id while this card is mid
  // cross-column relocation) so the sortable identity matches the column's SortableContext item
  // set — and so the same card in a lane + its status column registers two distinct sortables.
  const draggable = !nested && dragId != null;
  const reducedMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: draggable ? dragId : card.path,
    disabled: !draggable,
    // null switches off both the make-room slide and the settle.
    ...(reducedMotion ? { transition: null } : {}),
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
  const chips = [
    ...relationChips(relations),
    ...cardChips(card, today, actions.doneColumnId, actions.priorityScale),
  ];
  const stats = card.stats;
  const fm = card.frontmatter;
  const prio =
    typeof fm.priority === "string" && fm.priority
      ? priorityTone(fm.priority, actions.priorityScale)
      : null;
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
  const showActions = editing == null;
  const canComplete = isCompletable(card, actions.doneColumnId);

  // An inline todo has no note of its own: its checklist line lives in its parent, so every action
  // that needs a file addresses the parent, and the tile's own actions are the todo actions.
  const todoRef = card.todoRef;
  const notePath = todoRef ? todoRef.parentPath : card.path;

  const open = () => {
    if (!isDragging) actions.open(notePath);
  };
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
            onRename: () => setEditing(latest.current.title),
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
    if (
      e.key === "ContextMenu" ||
      (e.key === "F10" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey)
    ) {
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
        (draggable ? "" : " folia-card--static") +
        (canComplete ? "" : " folia-card--no-complete") +
        (nested ? " folia-card--nested" : "") +
        (parentPath ? " folia-card--subitem" : "") +
        (todoRef ? " folia-card--todo" : "") +
        (selected ? " folia-is-selected" : "") +
        (isDragging ? " folia-is-dragging" : "") +
        (card.context ? " folia-card--has-context" : "")
      }
      data-testid="card"
      data-path={card.path}
      data-subitem={parentPath ? (todoRef ? "todo" : "card") : undefined}
      data-prio={prio ?? undefined}
      data-context={card.context ?? undefined}
      data-urgency={urgency ?? undefined}
      onContextMenu={onContextMenu}
      // A right-click starts with a press; the contextmenu a key brings does not. The keyup may
      // never reach the card either (the OS-drawn menu takes it), so the press also forgets the key.
      onPointerDownCapture={() => (menuKey.current = null)}
    >
      {/* #14 context grouping: a left accent strip, shown only when the context defines a color
          (inset past the priority bar so the two left-edge cues don't overlap). */}
      {ctxColor && <span className="folia-card-context-strip" aria-hidden="true" />}
      {/* a11y exception (no-static-element-interactions): role + tabIndex come from the spread dnd attributes (sortable: role="button", tabIndex=0) or the explicit non-draggable branch */}
      <div
        className="folia-card-main"
        // A tile that can't be dragged skips the drag listeners/attributes (which also supply
        // tabIndex/role), and restores keyboard reachability + open semantics explicitly.
        {...(draggable ? attributes : { tabIndex: 0, role: "button" })}
        {...(draggable ? listeners : {})}
        onClick={open}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        // Unread comments are folded into the tile's OWN accessible name: everything inside this
        // element is a descendant of a `role="button"`, so a label on the badge itself is never
        // announced. The name is the only place a screen reader can hear that a card has something
        // waiting on it.
        aria-label={unread.kind === "none" ? card.title : `${card.title}, ${unreadWords(unread)}`}
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
                {c.icon && <Icon name={c.icon} />}
                {c.label}
              </span>
            ))}
          </div>
        )}
        {stats && stats.checklist > 0 && (
          <div
            className={"folia-progress" + (allDone ? " folia-is-complete" : "")}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={stats.checklist}
            aria-valuenow={stats.checklistDone}
            title={`${stats.checklistDone} of ${stats.checklist} subtasks done`}
            aria-label={`${stats.checklistDone} of ${stats.checklist} subtasks done`}
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
                <Icon name="git-branch" /> {stats.subcards}
              </span>
            )}
            {stats.comments > 0 && (
              <span
                className={unread.kind === "none" ? undefined : `folia-comments-${unread.kind}`}
                title={commentsTitle(stats.comments, unread)}
                aria-label={commentsTitle(stats.comments, unread)}
              >
                <Icon name="message" /> {stats.comments}
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
            className={subitemsCollapsed ? "folia-is-collapsed" : undefined}
          />
          {subitemsCollapsed
            ? `${stats?.checklist ?? 0} subitem${(stats?.checklist ?? 0) === 1 ? "" : "s"}, ${stats?.checklistDone ?? 0} done`
            : "Subitems"}
        </button>
      )}

      {/* Sibling of `.folia-card-main`, never inside it: that div carries `role="button"` (from the
          drag attributes, or the explicit non-draggable branch), and a button within it is unreachable to
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
      )}
    </div>
  );
}

/** The card's focusable face, which a menu opened without a pointer sits under and returns to. */
function cardMain(el: Element): HTMLElement {
  return (el.querySelector(".folia-card-main") ?? el) as HTMLElement;
}

/**
 * The comment badge's tooltip and accessible name — additive, so the count a sighted user reads is
 * still spoken, with what is new appended rather than replacing it.
 */
function commentsTitle(total: number, unread: UnreadState): string {
  const base = `${total} comment${total === 1 ? "" : "s"}`;
  return unread.kind === "none" ? base : `${base}, ${unreadWords(unread)}`;
}

/** "2 unread comments" / "2 unread comments, one a reply to yours" / "1 unread comment, a reply to yours". */
function unreadWords(unread: UnreadState): string {
  const n = unread.indices.length;
  const news = `${n} unread comment${n === 1 ? "" : "s"}`;
  if (unread.kind !== "reply") return news;
  return n === 1 ? `${news}, a reply to yours` : `${news}, one a reply to yours`;
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
    // The tile's reading is what its actions carry, so a line that changed in any part of it has to
    // reach the tile — a kept render would hand the next click the older reading.
    (a.card.todoRef && b.card.todoRef
      ? sameLine(a.card.todoRef.line, b.card.todoRef.line)
      : a.card.todoRef === b.card.todoRef) &&
    a.card.frontmatter.status === b.card.frontmatter.status &&
    (a.card.todoRef != null || a.card.frontmatter === b.card.frontmatter) &&
    // Body tags come from the metadata cache as a fresh array each load, so this compares their
    // contents; by reference every card would look changed on every reload.
    (a.card.bodyTags ?? []).join("\n") === (b.card.bodyTags ?? []).join("\n") &&
    sameStats(a.card.stats, b.card.stats),
);
