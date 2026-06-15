import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Board, CardBody } from "../model/types";
import { useBoardActions, useRepo } from "./context";
import { Icon } from "./icons";

interface Props {
  path: string;
  board: Board;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onChanged: () => void;
}

function resolveBasename(board: Board, link: string): string | null {
  for (const p in board.cards) if (board.cards[p].basename === link) return p;
  return null;
}

const WORD_SCALE = ["urgent", "high", "medium", "low"];
const LETTER_SCALE = ["A", "B", "C", "D"];
const EDITED_KEYS = new Set(["status", "priority", "due", "order", "type", "created"]);

/** Priority options that always include the card's current value (keeps arbitrary scales working). */
function priorityOptions(current: string): string[] {
  const base = LETTER_SCALE.includes(current) ? LETTER_SCALE : WORD_SCALE;
  return current && !base.includes(current) ? [current, ...base] : base;
}

export function CardDetail({ path, board, onClose, onNavigate, onChanged }: Props) {
  const repo = useRepo();
  const actions = useBoardActions();
  const card = board.cards[path];
  const panelRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [body, setBody] = useState<CardBody | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [newTodo, setNewTodo] = useState("");
  const [newSubcard, setNewSubcard] = useState("");
  const [newComment, setNewComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    setBody(null);
    setConfirmDelete(false);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Dialog focus management: focus in on open, return focus to the opener on close.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => openerRef.current?.focus?.();
  }, []);

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

  if (!card) {
    return (
      <aside className="mdkb-detail" role="dialog" aria-label="Card not found" ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="mdkb-detail-header">
          <span>Card not found</span>
          <button className="mdkb-icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
      </aside>
    );
  }

  const fm = card.frontmatter;
  const curPriority = String(fm.priority ?? "");
  const extraProps = Object.entries(fm).filter(
    ([k, v]) => !EDITED_KEYS.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean") && v !== "",
  );

  return (
    <aside
      className="mdkb-detail"
      data-testid="card-detail"
      role="dialog"
      aria-modal="false"
      aria-label={card.basename}
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="mdkb-detail-header">
        <h2 className="mdkb-detail-title">{card.basename}</h2>
        <div className="mdkb-row-actions">
          {actions.doneColumnId && fm.status !== actions.doneColumnId && (
            <button className="mdkb-icon-btn mdkb-action-done" aria-label="Mark done" title="Mark done" onClick={() => actions.complete(path)}>
              <Icon name="check-circle" />
            </button>
          )}
          <button className="mdkb-icon-btn" aria-label="Open note" title="Open note in Obsidian" onClick={() => void repo.openCard(path)}>
            <Icon name="external-link" />
          </button>
          <button className="mdkb-icon-btn mdkb-action-delete" aria-label="Delete card" title="Delete card" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" />
          </button>
          <button className="mdkb-icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      {confirmDelete && (
        <div className="mdkb-detail-confirm" role="alertdialog" aria-label="Confirm delete">
          <span>Delete this card? The note moves to trash.</span>
          <div className="mdkb-row-actions">
            <button className="mdkb-btn mdkb-btn-danger" onClick={() => actions.remove(path)}>Delete</button>
            <button className="mdkb-btn" autoFocus onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="mdkb-detail-body">
        <div className="mdkb-fields">
          <label>
            Status
            <select value={String(fm.status ?? "")} onChange={(e) => void mutate(() => repo.setFrontmatter(path, { status: e.target.value }))}>
              {board.config.columns.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={curPriority} onChange={(e) => void mutate(() => repo.setFrontmatter(path, { priority: e.target.value }))}>
              <option value="">—</option>
              {priorityOptions(curPriority).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            Due
            <input type="date" value={String(fm.due ?? "")} onChange={(e) => void mutate(() => repo.setFrontmatter(path, { due: e.target.value }))} />
          </label>
        </div>

        {extraProps.length > 0 && (
          <div className="mdkb-props">
            {extraProps.map(([k, v]) => (
              <span className="mdkb-prop" key={k}>
                <span className="mdkb-prop-key">{k}</span>
                <span className="mdkb-prop-val">{String(v)}</span>
              </span>
            ))}
          </div>
        )}

        <section className="mdkb-section">
          <h3>Description</h3>
          <textarea className="mdkb-desc" value={descDraft} onChange={(e) => setDescDraft(e.target.value)} placeholder="Add a description…" />
          {body && descDraft !== body.description && (
            <div className="mdkb-row-actions">
              <button className="mdkb-btn mdkb-btn-primary" onClick={() => void mutate(() => repo.setDescription(path, descDraft))}>Save</button>
              <button className="mdkb-btn" onClick={() => setDescDraft(body.description)}>Revert</button>
            </div>
          )}
        </section>

        <section className="mdkb-section">
          <h3>Subtasks &amp; subcards</h3>
          <ul className="mdkb-subtasks">
            {body?.subtasks.map((s) => (
              <li key={s.index} className="mdkb-subtask">
                <input type="checkbox" checked={s.done} aria-label={`Toggle ${s.text}`} onChange={() => void mutate(() => repo.toggleSubtask(path, s.index, !s.done))} />
                {s.kind === "card" && s.link ? (
                  (() => {
                    const child = resolveBasename(board, s.link);
                    return child ? (
                      <button className="mdkb-link" onClick={() => onNavigate(child)}>
                        {s.link}
                      </button>
                    ) : (
                      <span className="mdkb-link-missing" title="No card with this name on the board">
                        {s.link}
                      </span>
                    );
                  })()
                ) : (
                  <span className={s.done ? "mdkb-done" : ""}>{s.text}</span>
                )}
                <button className="mdkb-icon-btn mdkb-mini" aria-label="Remove" title="Remove" onClick={() => void mutate(() => repo.removeSubtask(path, s.index))}><Icon name="close" size={13} /></button>
              </li>
            ))}
            {body && body.subtasks.length === 0 && <li className="mdkb-muted">No subtasks yet.</li>}
          </ul>
          <div className="mdkb-add-inline">
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
          <div className="mdkb-add-inline">
            <input
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

        <section className="mdkb-section">
          <h3>Comments</h3>
          <ul className="mdkb-comments">
            {body?.comments.map((c, i) => (
              <li key={i}>
                <span className="mdkb-ts">{c.timestamp}</span>
                <span>{c.text}</span>
              </li>
            ))}
            {body && body.comments.length === 0 && <li className="mdkb-muted">No comments yet.</li>}
          </ul>
          <div className="mdkb-add-inline">
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

        <section className="mdkb-section">
          <h3>History</h3>
          <ul className="mdkb-history">
            {body?.history.map((h, i) => (
              <li key={i}>
                <span className="mdkb-ts">{h.timestamp}</span>
                <span>{h.text}</span>
              </li>
            ))}
            {body && body.history.length === 0 && <li className="mdkb-muted">No history yet.</li>}
          </ul>
        </section>
      </div>
    </aside>
  );
}
