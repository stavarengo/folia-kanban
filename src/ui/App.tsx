import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Board as BoardModel, ColumnDef } from "../model/types";
import { moveCard, resolveDrop } from "../model/board";
import { dateOnly } from "../model/dates";
import type { CardRepository } from "../obsidian/repo";
import { BoardActionsContext, RepoContext, type BoardActions } from "./context";
import { Board } from "./Board";
import { CardDetail } from "./CardDetail";
import { Toolbar } from "./Toolbar";
import { Icon } from "./icons";
import { cardMatches, EMPTY_FILTERS, type BoardFilters } from "./cardView";

const DONE_RE = /\b(done|complete|completed|finished|shipped|closed)\b/i;

/** Pick the column that means "finished": exact id "done", else a title/id that reads as done. */
function findDoneColumn(board: BoardModel): string | null {
  const cols = board.config.columns;
  const exact = cols.find((c) => c.id.toLowerCase() === "done");
  if (exact) return exact.id;
  const fuzzy = cols.find((c) => DONE_RE.test(c.id) || DONE_RE.test(c.title));
  return fuzzy?.id ?? null;
}

interface Props {
  repo: CardRepository;
  /** Overridable for deterministic tests; defaults to the real date. */
  today?: string;
}

export function App({ repo, today }: Props) {
  const [board, setBoard] = useState<BoardModel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const todayValue = useMemo(() => today ?? dateOnly(), [today]);

  const showToast = useCallback((text: string, tone: "success" | "error" = "success") => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "error" ? 4000 : 2200);
  }, []);
  const reportError = useCallback(
    (e: unknown) => showToast(e instanceof Error ? e.message : String(e), "error"),
    [showToast],
  );
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);
  // Latest board for stable callbacks — lets the actions object stay referentially stable
  // across single-card edits so memoized cards don't all re-render.
  const boardRef = useRef<BoardModel | null>(null);
  boardRef.current = board;

  const load = useCallback(async () => {
    try {
      setBoard(await repo.loadBoard());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repo]);

  useEffect(() => {
    void load();
    const off = repo.onChange(() => void load());
    return off;
  }, [load, repo]);

  const onMove = useCallback(
    async (activeId: string, overId: string) => {
      const b = boardRef.current;
      if (!b) return;
      const drop = resolveDrop(b, activeId, overId);
      if (!drop) return;
      const mut = moveCard(b, activeId, drop.columnId, drop.index);
      if (!mut) return;
      try {
        await repo.applyMove(mut);
      } finally {
        await load();
      }
    },
    [repo, load],
  );

  const onAddCard = useCallback(
    async (columnId: string, title: string) => {
      const path = await repo.createCard(title, columnId);
      await load();
      setSelected(path);
    },
    [repo, load],
  );

  const doneColumnId = useMemo(() => (board ? findDoneColumn(board) : null), [board]);

  const moveTo = useCallback(
    async (path: string, columnId: string) => {
      const b = boardRef.current;
      if (!b) return;
      const target = (b.columns[columnId] ?? []).filter((p) => p !== path).length;
      const mut = moveCard(b, path, columnId, target);
      if (!mut) return;
      try {
        await repo.applyMove(mut);
      } finally {
        await load();
      }
    },
    [repo, load],
  );

  const setColumnsAndReload = useCallback(
    async (cols: ColumnDef[]) => {
      try {
        await repo.setColumns(cols);
      } finally {
        await load();
      }
    },
    [repo, load],
  );

  const actions = useMemo<BoardActions>(
    () => ({
      open: (path) => setSelected(path),
      complete: (path) => {
        if (!doneColumnId) return;
        const title = boardRef.current?.cards[path]?.basename ?? "Card";
        void moveTo(path, doneColumnId)
          .then(() => showToast(`${title} — done!`))
          .catch(reportError);
      },
      remove: (path) => {
        void (async () => {
          try {
            await repo.deleteCard(path);
          } catch (e) {
            reportError(e);
          } finally {
            setSelected((cur) => (cur === path ? null : cur));
            await load();
          }
        })();
      },
      openNote: (path) => void repo.openCard(path),
      doneColumnId,
      renameColumn: (id, title) => {
        const b = boardRef.current;
        const t = title.trim();
        if (!b || !t) return;
        void setColumnsAndReload(b.config.columns.map((c) => (c.id === id ? { ...c, title: t } : c)));
      },
      setColumnColor: (id, color) => {
        const b = boardRef.current;
        if (!b) return;
        void setColumnsAndReload(b.config.columns.map((c) => (c.id === id ? { ...c, color: color ?? undefined } : c)));
      },
      setColumnLimit: (id, limit) => {
        const b = boardRef.current;
        if (!b) return;
        const lim = limit == null || limit <= 0 ? undefined : Math.floor(limit);
        void setColumnsAndReload(b.config.columns.map((c) => (c.id === id ? { ...c, limit: lim } : c)));
      },
      moveColumn: (id, dir) => {
        const b = boardRef.current;
        if (!b) return;
        const cols = [...b.config.columns];
        const i = cols.findIndex((c) => c.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= cols.length) return;
        [cols[i], cols[j]] = [cols[j], cols[i]];
        void setColumnsAndReload(cols);
      },
      deleteColumn: (id) => {
        const b = boardRef.current;
        if (!b) return;
        const cols = b.config.columns;
        if (cols.length <= 1) return; // keep at least one column
        const idx = cols.findIndex((c) => c.id === id);
        if (idx < 0) return;
        const neighbor = cols[idx - 1] ?? cols[idx + 1];
        const orphans = b.columns[id] ?? [];
        void (async () => {
          // Reassign this column's cards to a neighbour so none are orphaned.
          for (const p of orphans) {
            try {
              await repo.setFrontmatter(p, { status: neighbor.id });
            } catch {
              /* best-effort */
            }
          }
          try {
            await repo.setColumns(cols.filter((c) => c.id !== id));
          } finally {
            await load();
          }
        })();
      },
      addColumn: (title) => {
        const b = boardRef.current;
        const t = title.trim();
        if (!b || !t) return;
        const existing = new Set(b.config.columns.map((c) => c.id));
        const base = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "column";
        let id = base;
        let n = 1;
        while (existing.has(id)) id = `${base}-${n++}`;
        void setColumnsAndReload([...b.config.columns, { id, title: t }]);
      },
    }),
    [moveTo, doneColumnId, repo, load, setColumnsAndReload, showToast, reportError],
  );

  const wipLimits = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (board) for (const c of board.config.columns) if (typeof c.limit === "number") map[c.id] = c.limit;
    return map;
  }, [board]);

  const counts = useMemo(() => {
    let total = 0;
    let match = 0;
    if (board) {
      for (const col of board.config.columns) {
        for (const p of board.columns[col.id] ?? []) {
          const c = board.cards[p];
          if (!c) continue;
          total++;
          if (cardMatches(c, todayValue, filters, doneColumnId)) match++;
        }
      }
    }
    return { total, match };
  }, [board, filters, todayValue, doneColumnId]);

  // "/" focuses search (when not already typing in a field).
  const onRootKeyDown = (e: KeyboardEvent) => {
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target as HTMLElement;
      const tag = t.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !t.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
  };

  if (error) return <div className="mdkb-error">Couldn’t load the board: {error}</div>;
  if (!board) return <div className="mdkb-loading">Loading board…</div>;

  return (
    <RepoContext.Provider value={repo}>
      <BoardActionsContext.Provider value={actions}>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div className="mdkb-root" onKeyDown={onRootKeyDown}>
          <Toolbar ref={searchRef} filters={filters} onChange={setFilters} matchCount={counts.match} totalCount={counts.total} />
          <div className="mdkb-main">
            <Board
              board={board}
              today={todayValue}
              selectedPath={selected}
              wipLimits={wipLimits}
              filters={filters}
              doneColumnId={doneColumnId}
              onMove={onMove}
              onAddCard={onAddCard}
            />
            {selected && board.cards[selected] && (
              <CardDetail
                path={selected}
                board={board}
                onClose={() => setSelected(null)}
                onNavigate={setSelected}
                onChanged={load}
              />
            )}
          </div>
          {toast && (
            <div className={"mdkb-toast mdkb-toast-" + toast.tone} role="status" aria-live="polite">
              <Icon name={toast.tone === "error" ? "alert" : "check-circle"} size={16} />
              {toast.text}
            </div>
          )}
        </div>
      </BoardActionsContext.Provider>
    </RepoContext.Provider>
  );
}
