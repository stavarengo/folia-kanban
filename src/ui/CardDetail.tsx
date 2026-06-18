import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Board, CardBody } from "../model/types";
import { DETAIL_WIDTH_MAX, DETAIL_WIDTH_MIN } from "../settings";
import { priorityOptions } from "./cardView";
import { useBoardActions, useRepo, useSettings, useSettingsUpdater } from "./context";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";

/** How the detail panel is presented; App decides where to mount it. */
export type DetailMode = "split" | "float" | "modal";

interface Props {
  path: string;
  board: Board;
  mode: DetailMode;
  onClose: () => void;
  /** Switch the panel to another card (subcard links). The create form never navigates. */
  onNavigate?: (path: string) => void;
  onChanged: () => void;
  /** When set, render the minimal CREATE form (new card in this column) instead of the card body. */
  createColumn?: string;
  /** Called with the new card's path after a successful create. */
  onCreated?: (path: string) => void;
  /** When set, focus the description textarea on mount (fresh card from an add-card flow). */
  focusNew?: boolean;
  /** When set, focus the "Add a subcard" input (the context-menu "Add subcard" action). */
  focusAddSubcard?: boolean;
}

const clampWidth = (n: number) => Math.min(DETAIL_WIDTH_MAX, Math.max(DETAIL_WIDTH_MIN, n));

/** One editable custom-frontmatter row: local draft committed on blur/Enter, remove button. */
function PropRow({
  name,
  value,
  onCommit,
  onRemove,
}: {
  name: string;
  value: string;
  onCommit: (v: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // Resync when the persisted value changes (e.g. after reload) and no edit is mid-flight.
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="folia-prop-row">
      <span className="folia-prop-key">{name}</span>
      <input
        className="folia-prop-input"
        value={draft}
        aria-label={`Value of ${name}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <button
        className="folia-icon-btn folia-mini"
        aria-label={`Remove ${name}`}
        title="Remove property"
        onClick={onRemove}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

/** One comment with inline edit + delete. View mode renders the text as markdown; edit shows the
 *  raw textarea (commits on Enter/blur). Keeps the timestamp untouched. */
function CommentItem({
  timestamp,
  text,
  sourcePath,
  onSave,
  onDelete,
}: {
  timestamp: string;
  text: string;
  sourcePath: string;
  onSave: (v: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== text) onSave(draft.trim());
  };
  return (
    <li>
      <span className="folia-ts">{timestamp}</span>
      {editing ? (
        <textarea
          className="folia-comment-edit"
          value={draft}
          autoFocus
          aria-label="Edit comment"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        <div className="folia-comment-row">
          <Markdown markdown={text} sourcePath={sourcePath} className="folia-comment-text" />
          <button
            className="folia-icon-btn folia-mini"
            aria-label="Edit comment"
            title="Edit"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <Icon name="pencil" size={13} />
          </button>
          <button
            className="folia-icon-btn folia-mini"
            aria-label="Delete comment"
            title="Delete"
            onClick={onDelete}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      )}
    </li>
  );
}

function resolveBasename(board: Board, link: string): string | null {
  for (const p in board.cards) if (board.cards[p]?.basename === link) return p;
  return null;
}

const EDITED_KEYS = new Set(["status", "priority", "due", "order", "type", "created"]);

export function CardDetail({
  path,
  board,
  mode,
  onClose,
  onNavigate,
  onChanged,
  createColumn,
  onCreated,
  focusNew,
  focusAddSubcard,
}: Props) {
  const repo = useRepo();
  const actions = useBoardActions();
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const card = board.cards[path];
  const isCreate = createColumn != null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const descViewRef = useRef<HTMLDivElement | null>(null);
  const subcardRef = useRef<HTMLInputElement | null>(null);
  // Synchronous in-flight guard for the create form: blocks a second submit (rapid Enter, or
  // Enter-then-click) during the async createCard window before onCreated unmounts this branch.
  const creatingRef = useRef(false);
  const [body, setBody] = useState<CardBody | null>(null);
  const [descDraft, setDescDraft] = useState("");
  // Description defaults to a rendered view; clicking it (or the pencil) flips to the raw editor.
  const [editingDesc, setEditingDesc] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [newTodo, setNewTodo] = useState("");
  const [newSubcard, setNewSubcard] = useState("");
  const [newComment, setNewComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropVal, setNewPropVal] = useState("");
  // Width override only while a resize drag is in flight; otherwise the panel reads settings.detailWidth.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Height the rendered preview occupied right before flipping to the raw editor, so the textarea
  // adopts it (min-height) and the panel doesn't jump on preview↔edit toggle. Null = no carry-over.
  const [preservedDescHeight, setPreservedDescHeight] = useState<number | null>(null);
  // Viewport-derived ceiling for the rendered preview so a long description scrolls internally
  // instead of pushing the panel past the screen. Re-measured on mount and window resize.
  const [descMaxHeight, setDescMaxHeight] = useState<number | null>(null);

  const isSide = mode !== "modal";
  const width = dragWidth ?? settings.detailWidth;

  const reload = async () => {
    try {
      const b = await repo.readBody(path);
      setBody(b);
      setDescDraft(b.description);
    } catch {
      onClose(); // card was deleted out from under us
    }
  };

  useEffect(() => {
    if (isCreate) return; // no card to read while the create form is up
    setBody(null);
    setConfirmDelete(false);
    setEditingDesc(false); // navigating cards starts the new card in view mode
    void reload();
  }, [path, isCreate]);

  // Dialog focus management: focus in on open, return focus to the opener on close. The create form
  // autofocuses its title input (a synchronous commit-phase focus), so don't steal it back here.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    if (!isCreate) panelRef.current?.focus();
    return () => openerRef.current?.focus?.();
  }, []);

  // A freshly-created card (inline-edit / detail flows) lands the user in the description editor.
  // Description defaults to view mode, so a fresh card has no textarea to focus — flip to edit mode
  // here; the editing-flag effect below focuses the textarea once it mounts. Keyed on `path`, not
  // `body`, so each field edit's reload doesn't re-trigger. The detail create flow unmounts the
  // create branch and remounts a fresh card panel; inline-edit re-keys the same instance on the new path.
  useEffect(() => {
    if (focusNew && !isCreate) setEditingDesc(true);
  }, [focusNew, path]);

  // Focus the raw description textarea whenever the editor opens (fresh card, pencil, click-to-edit).
  useEffect(() => {
    if (editingDesc) descRef.current?.focus();
  }, [editingDesc]);

  // Cap the rendered preview to the space between its top and the viewport bottom (leaving a small
  // gutter), but never below a readable floor. Works across split/float/modal: it measures the
  // preview's own on-screen position, so the modal's max-height and the side panel's scroll both
  // resolve to a sensible ceiling. Re-runs on mount, when the preview (re)appears, and on resize.
  useLayoutEffect(() => {
    if (isCreate || editingDesc) return;
    const measure = () => {
      const el = descViewRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - 24; // 24px gutter to the viewport edge
      setDescMaxHeight(Math.max(160, Math.round(avail)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isCreate, editingDesc, path, body]);

  // Leaving the editor (save/cancel/navigation) drops any carried-over preview height so the
  // preview returns to the viewport-measured behavior.
  useEffect(() => {
    if (!editingDesc) setPreservedDescHeight(null);
  }, [editingDesc]);

  // Flip to the raw editor, first capturing the rendered preview's current height so the textarea
  // can adopt it (min-height) and the panel doesn't jump. Used by both the click-to-edit surface
  // and the pencil button; the empty-state / fresh-card paths have no preview, so they skip this.
  const beginEditDesc = () => {
    const h = descViewRef.current?.offsetHeight;
    if (h) setPreservedDescHeight(h);
    setEditingDesc(true);
  };

  // The "Add subcard" context-menu action opens this card and lands focus on its subcard input,
  // letting the user type the title there (the input's Enter handler calls repo.addSubcard).
  useEffect(() => {
    if (focusAddSubcard && !isCreate) subcardRef.current?.focus();
  }, [focusAddSubcard, path]);

  // Side modes: a pointerdown outside the panel closes it — but not when it lands on another
  // card (that card's own open handler switches the detail), nor on a menu/context surface.
  // Modal mode closes via its backdrop instead (handled by App).
  useEffect(() => {
    if (!isSide) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".folia-detail, .folia-card, .folia-menu, .folia-card-context")) return;
      // Commit any in-progress edit before closing: blurring fires the focused field's onBlur,
      // which initiates its repo write synchronously — so clicking away saves instead of discarding.
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        panelRef.current?.contains(ae) &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")
      )
        ae.blur();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isSide, onClose]);

  // Drag the panel's left border to resize (side modes). Width is derived from the panel's own
  // right edge so it works whether the panel is a flex sibling (split) or right-docked (float).
  const onResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    const right = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    (e.target as Element).setPointerCapture(e.pointerId);
    let latest = clampWidth(right - e.clientX);
    const onMove = (ev: globalThis.PointerEvent) => {
      latest = clampWidth(right - ev.clientX);
      setDragWidth(latest);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setDragWidth(null);
      updateSettings({ detailWidth: latest });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const mutate = async (fn: () => Promise<unknown>) => {
    await fn();
    await reload();
    onChanged();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const modeClass =
    mode === "float" ? " folia-detail--float" : mode === "modal" ? " folia-detail--modal" : "";
  const panelStyle = isSide ? { width, flex: `0 0 ${width}px` } : undefined;

  if (isCreate) {
    const columnTitle =
      board.config.columns.find((c) => c.id === createColumn)?.title ?? createColumn;
    const submitCreate = () => {
      const t = createTitle.trim();
      if (!t || creatingRef.current) return;
      creatingRef.current = true;
      void (async () => {
        try {
          const newPath = await repo.createCard(t, createColumn);
          onCreated?.(newPath);
          // On success this branch unmounts (createColumn→null), so no need to reset the guard.
        } catch {
          creatingRef.current = false; // let the user retry after a failed create
        }
      })();
    };
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog surface: onKeyDown drives Escape/keyboard on a role=dialog + aria-modal + focus-managed panel
      <div
        className={"folia-detail" + modeClass}
        data-testid="card-detail"
        role="dialog"
        aria-modal={mode === "modal"}
        aria-label={`New card in ${columnTitle}`}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={panelStyle}
      >
        {isSide && (
          <div
            className="folia-detail-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            onPointerDown={onResizeStart}
          />
        )}
        <div className="folia-detail-header">
          <h2 className="folia-detail-title">New card in {columnTitle}</h2>
          <div className="folia-row-actions">
            <button
              className="folia-icon-btn"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </div>
        </div>
        <div className="folia-detail-body">
          <section className="folia-section">
            <label>
              Title
              <input
                className="folia-create-title"
                autoFocus
                value={createTitle}
                aria-label="New card title"
                placeholder="What needs doing?"
                onChange={(e) => setCreateTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && createTitle.trim()) {
                    e.preventDefault();
                    submitCreate();
                  }
                }}
              />
            </label>
            <div className="folia-row-actions">
              <button
                className="folia-btn folia-btn-primary"
                disabled={!createTitle.trim()}
                onClick={submitCreate}
              >
                Create
              </button>
              <button className="folia-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog surface: onKeyDown drives Escape on a role=dialog + aria-modal + focus-managed panel
      <div
        className={"folia-detail" + modeClass}
        role="dialog"
        aria-modal={mode === "modal"}
        aria-label="Card not found"
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={panelStyle}
      >
        <div className="folia-detail-header">
          <span>Card not found</span>
          <button className="folia-icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>
    );
  }

  const fm = card.frontmatter;
  const curPriority = String(fm.priority ?? "");
  const extraProps = Object.entries(fm).filter(
    ([k, v]) =>
      !EDITED_KEYS.has(k) &&
      (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
      v !== "",
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog surface: onKeyDown drives Escape/keyboard on a role=dialog + aria-modal + focus-managed panel
    <div
      className={"folia-detail" + modeClass}
      data-testid="card-detail"
      role="dialog"
      aria-modal={mode === "modal"}
      aria-label={card.basename}
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={panelStyle}
    >
      {isSide && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          className="folia-detail-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          onPointerDown={onResizeStart}
        />
      )}
      <div className="folia-detail-header">
        <h2 className="folia-detail-title">{card.basename}</h2>
        <div className="folia-row-actions">
          {actions.doneColumnId && fm.status !== actions.doneColumnId && (
            <button
              className="folia-icon-btn folia-action-done"
              aria-label="Mark done"
              title="Mark done"
              onClick={() => actions.complete(path)}
            >
              <Icon name="check-circle" />
            </button>
          )}
          <button
            className="folia-icon-btn"
            aria-label="Open note"
            title="Open note in Obsidian"
            onClick={() => void repo.openCard(path)}
          >
            <Icon name="external-link" />
          </button>
          <button
            className="folia-icon-btn folia-action-delete"
            aria-label="Delete card"
            title="Delete card"
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" />
          </button>
          <button
            className="folia-icon-btn"
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="folia-detail-confirm" role="alertdialog" aria-label="Confirm delete">
          <span>Delete this card? The note moves to trash.</span>
          <div className="folia-row-actions">
            <button className="folia-btn folia-btn-danger" onClick={() => actions.remove(path)}>
              Delete
            </button>
            <button className="folia-btn" autoFocus onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="folia-detail-body">
        <div className="folia-fields">
          <label>
            Status
            <select
              value={String(fm.status ?? "")}
              onChange={(e) =>
                void mutate(() => repo.setFrontmatter(path, { status: e.target.value }))
              }
            >
              {board.config.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={curPriority}
              onChange={(e) =>
                void mutate(() =>
                  e.target.value === ""
                    ? repo.unsetFrontmatterKey(path, "priority")
                    : repo.setFrontmatter(path, { priority: e.target.value }),
                )
              }
            >
              <option value="">—</option>
              {priorityOptions(curPriority).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due
            <input
              type="date"
              value={String(fm.due ?? "")}
              onChange={(e) =>
                void mutate(() => repo.setFrontmatter(path, { due: e.target.value }))
              }
            />
          </label>
        </div>

        <div className="folia-props">
          {extraProps.map(([k, v]) => (
            <PropRow
              key={k}
              name={k}
              value={String(v)}
              onCommit={(val) => void mutate(() => repo.setFrontmatter(path, { [k]: val }))}
              onRemove={() => void mutate(() => repo.unsetFrontmatterKey(path, k))}
            />
          ))}
          <div className="folia-prop-add">
            <input
              className="folia-prop-input"
              value={newPropKey}
              placeholder="property"
              aria-label="New property name"
              onChange={(e) => setNewPropKey(e.target.value)}
            />
            <input
              className="folia-prop-input"
              value={newPropVal}
              placeholder="value"
              aria-label="New property value"
              onChange={(e) => setNewPropVal(e.target.value)}
            />
            <button
              className="folia-btn"
              aria-label="Add property"
              disabled={!newPropKey.trim() || EDITED_KEYS.has(newPropKey.trim())}
              onClick={() => {
                const key = newPropKey.trim();
                if (!key || EDITED_KEYS.has(key)) return;
                void mutate(() => repo.setFrontmatter(path, { [key]: newPropVal }));
                setNewPropKey("");
                setNewPropVal("");
              }}
            >
              Add
            </button>
          </div>
        </div>

        <section className="folia-section">
          <h3>Description</h3>
          {editingDesc ? (
            <>
              <textarea
                ref={descRef}
                className="folia-desc"
                value={descDraft}
                aria-label="Edit description"
                style={
                  preservedDescHeight != null
                    ? { minHeight: `${preservedDescHeight}px` }
                    : undefined
                }
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Add a description…"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    // Stay inside the editor: don't let Escape bubble to the panel and close it.
                    e.stopPropagation();
                    if (body) setDescDraft(body.description);
                    setEditingDesc(false);
                  }
                }}
              />
              <div className="folia-row-actions">
                <button
                  className="folia-btn folia-btn-primary"
                  onClick={() =>
                    void mutate(() => repo.setDescription(path, descDraft)).then(() =>
                      setEditingDesc(false),
                    )
                  }
                >
                  Save
                </button>
                <button
                  className="folia-btn"
                  onClick={() => {
                    if (body) setDescDraft(body.description);
                    setEditingDesc(false);
                  }}
                >
                  Revert
                </button>
              </div>
            </>
          ) : body && body.description.trim() ? (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
            <div
              ref={descViewRef}
              className="folia-desc-view"
              style={
                descMaxHeight != null
                  ? ({ "--folia-desc-max-h": `${descMaxHeight}px` } as CSSProperties)
                  : undefined
              }
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) return;
                beginEditDesc();
              }}
            >
              <Markdown
                markdown={body.description}
                sourcePath={path}
                className="folia-desc-rendered"
              />
              <button
                className="folia-icon-btn folia-mini folia-desc-edit"
                aria-label="Edit description"
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation();
                  beginEditDesc();
                }}
              >
                <Icon name="pencil" size={13} />
              </button>
            </div>
          ) : (
            <button
              className="folia-desc-empty folia-muted"
              aria-label="Edit description"
              onClick={() => setEditingDesc(true)}
            >
              Add a description…
            </button>
          )}
        </section>

        <section className="folia-section">
          <h3>Subtasks &amp; subcards</h3>
          <ul className="folia-subtasks">
            {body?.subtasks.map((s) => (
              <li key={s.index} className="folia-subtask">
                <input
                  type="checkbox"
                  checked={s.done}
                  aria-label={`Toggle ${s.text}`}
                  onChange={() => void mutate(() => repo.toggleSubtask(path, s.index, !s.done))}
                />
                {s.kind === "card" && s.link ? (
                  (() => {
                    const child = resolveBasename(board, s.link);
                    return child ? (
                      <button className="folia-link" onClick={() => onNavigate?.(child)}>
                        {s.link}
                      </button>
                    ) : (
                      <span
                        className="folia-link-missing"
                        title="No card with this name on the board"
                      >
                        {s.link}
                      </span>
                    );
                  })()
                ) : (
                  <span className={s.done ? "folia-done" : ""}>{s.text}</span>
                )}
                <button
                  className="folia-icon-btn folia-mini"
                  aria-label="Remove"
                  title="Remove"
                  onClick={() => void mutate(() => repo.removeSubtask(path, s.index))}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
            {body && body.subtasks.length === 0 && (
              <li className="folia-muted">No subtasks yet.</li>
            )}
          </ul>
          <div className="folia-add-inline">
            <input
              value={newTodo}
              placeholder="Add a todo…"
              aria-label="Add a todo"
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTodo.trim()) {
                  void mutate(() => repo.addTodo(path, newTodo.trim()));
                  setNewTodo("");
                }
              }}
            />
          </div>
          <div className="folia-add-inline">
            <input
              ref={subcardRef}
              value={newSubcard}
              placeholder="Add a subcard…"
              aria-label="Add a subcard"
              onChange={(e) => setNewSubcard(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubcard.trim()) {
                  void mutate(() => repo.addSubcard(path, newSubcard.trim()));
                  setNewSubcard("");
                }
              }}
            />
          </div>
        </section>

        <section className="folia-section">
          <h3>Comments</h3>
          <ul className="folia-comments">
            {body?.comments.map((c, i) => (
              <CommentItem
                key={i}
                timestamp={c.timestamp}
                text={c.text}
                sourcePath={path}
                onSave={(val) => void mutate(() => repo.updateComment(path, i, val))}
                onDelete={() => void mutate(() => repo.removeComment(path, i))}
              />
            ))}
            {body && body.comments.length === 0 && (
              <li className="folia-muted">No comments yet.</li>
            )}
          </ul>
          <div className="folia-add-inline">
            <textarea
              value={newComment}
              placeholder="Write a comment…"
              aria-label="Write a comment"
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && newComment.trim()) {
                  e.preventDefault();
                  void mutate(() => repo.addComment(path, newComment.trim()));
                  setNewComment("");
                }
              }}
            />
          </div>
        </section>

        <section className="folia-section">
          <h3>History</h3>
          <ul className="folia-history">
            {body?.history.map((h, i) => (
              <li key={i}>
                <span className="folia-ts">{h.timestamp}</span>
                <span>{h.text}</span>
              </li>
            ))}
            {body && body.history.length === 0 && <li className="folia-muted">No history yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
