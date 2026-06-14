import { useEffect, useState } from "react";
import type { Board, CardBody } from "../model/types";
import { useRepo } from "./context";

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

export function CardDetail({ path, board, onClose, onNavigate, onChanged }: Props) {
  const repo = useRepo();
  const card = board.cards[path];
  const [body, setBody] = useState<CardBody | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [newTodo, setNewTodo] = useState("");
  const [newSubcard, setNewSubcard] = useState("");
  const [newComment, setNewComment] = useState("");

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
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const mutate = async (fn: () => Promise<unknown>) => {
    await fn();
    await reload();
    onChanged();
  };

  if (!card) {
    return (
      <aside className="mdkb-detail">
        <header className="mdkb-detail-header">
          <span>Card not found</span>
          <button className="mdkb-icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </header>
      </aside>
    );
  }

  const fm = card.frontmatter;

  return (
    <aside className="mdkb-detail" data-testid="card-detail">
      <header className="mdkb-detail-header">
        <h2 className="mdkb-detail-title">{card.basename}</h2>
        <div className="mdkb-row-actions">
          <button className="mdkb-icon-btn" aria-label="Open note" title="Open note in Obsidian" onClick={() => void repo.openCard(path)}>↗</button>
          <button className="mdkb-icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
      </header>

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
            <select value={String(fm.priority ?? "")} onChange={(e) => void mutate(() => repo.setFrontmatter(path, { priority: e.target.value }))}>
              <option value="">—</option>
              {["A", "B", "C", "D"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            Due
            <input type="date" value={String(fm.due ?? "")} onChange={(e) => void mutate(() => repo.setFrontmatter(path, { due: e.target.value }))} />
          </label>
        </div>

        <section className="mdkb-section">
          <h3>Description</h3>
          <textarea className="mdkb-desc" value={descDraft} onChange={(e) => setDescDraft(e.target.value)} placeholder="Add a description…" />
          {body && descDraft !== body.description && (
            <div className="mdkb-row-actions">
              <button onClick={() => void mutate(() => repo.setDescription(path, descDraft))}>Save</button>
              <button onClick={() => setDescDraft(body.description)}>Revert</button>
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
                  <button
                    className="mdkb-link"
                    onClick={() => {
                      const child = resolveBasename(board, s.link!);
                      if (child) onNavigate(child);
                    }}
                  >
                    {s.link}
                  </button>
                ) : (
                  <span className={s.done ? "mdkb-done" : ""}>{s.text}</span>
                )}
                <button className="mdkb-icon-btn mdkb-mini" aria-label="Remove" onClick={() => void mutate(() => repo.removeSubtask(path, s.index))}>×</button>
              </li>
            ))}
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
