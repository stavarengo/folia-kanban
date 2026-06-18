import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Board as BoardModel, ColumnDef } from "../model/types";
import { columnOf, moveCard, moveColumn, resolveDrop } from "../model/board";
import { dateOnly } from "../model/dates";
import type { CardRepository } from "../obsidian/repo";
import type { KanbanSettings } from "../settings";
import { BoardActionsContext, ContextsContext, RepoContext, SettingsContext, type BoardActions } from "./context";
import { Board } from "./Board";
import { CardDetail, type DetailMode } from "./CardDetail";
import { Toolbar } from "./Toolbar";
import { Icon } from "./icons";
import { matchCard, parseFilter } from "./cardView";

const DONE_RE = /\b(done|complete|completed|finished|shipped|closed)\b/i;

/** Stable empty contexts map (#14) so the provider value identity doesn't churn pre-load. */
const EMPTY_CONTEXTS = {} as const;

/** Translate `addCardOpenMode` into a presentation override; 'default' means "use the global". */
function mapOpenMode(openMode: KanbanSettings["addCardOpenMode"]): DetailMode | null {
  switch (openMode) {
    case "modal":
      return "modal";
    case "side-float":
      return "float";
    case "side-split":
      return "split";
    default:
      return null;
  }
}

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
  /** Live settings, sourced from the plugin via the view. */
  settings: KanbanSettings;
  /** Pushes a settings patch back to the plugin (persist + re-render open views). */
  onUpdateSettings: (patch: Partial<KanbanSettings>) => void;
  /** Overridable for deterministic tests; defaults to the real date. */
  today?: string;
}

export function App({ repo, settings, onUpdateSettings, today }: Props) {
  const [board, setBoard] = useState<BoardModel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Add-card flows: which column is in CREATE mode, plus a one-shot presentation override and a
  // flag to focus the description of a freshly-created card. All cleared when the panel closes.
  const [createColumn, setCreateColumn] = useState<string | null>(null);
  const [openOverride, setOpenOverride] = useState<DetailMode | null>(null);
  const [focusNew, setFocusNew] = useState(false);
  // One-shot: focus the open card's "Add a subcard" input (the context-menu "Add subcard" action).
  const [focusAddSubcard, setFocusAddSubcard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #9: the search input is the SINGLE source of truth for board filtering. The board's active
  // filter is `parseFilter(query)` (§1); the preset chips just edit this one string.
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);
  const todayValue = useMemo(() => today ?? dateOnly(), [today]);
  const settingsValue = useMemo(
    () => ({ settings, update: onUpdateSettings }),
    [settings, onUpdateSettings],
  );

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

  // Obsidian's status bar is fixed to the window bottom; reserve clearance so the columns and the
  // side detail panel don't clip their last content behind it. Measure the real height once the
  // root is mounted (the first render shows a loading div, so the ref isn't ready until board loads).
  useEffect(() => {
    if (!board || !rootRef.current) return;
    const h = document.querySelector(".status-bar")?.getBoundingClientRect().height ?? 0;
    rootRef.current.style.setProperty("--folia-statusbar-clearance", `${h > 0 ? h + 6 : 32}px`);
  }, [board]);

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
      // 'inline' (default): add-only — stay in the column, don't open the detail.
      // 'inline-edit': open the new card's detail and focus its description for editing.
      if (settings.addCardFlow === "inline-edit") {
        setOpenOverride(mapOpenMode(settings.addCardOpenMode));
        setFocusNew(true);
        setSelected(path);
      }
    },
    [repo, load, settings.addCardFlow, settings.addCardOpenMode],
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

  // Opening a real card resets every add-card flow field so a stale create form can't resurface
  // when the panel later flips to create mode (e.g. the opened card is deleted out from under it).
  // Invariant: createColumn is null whenever a real card is selected.
  const openCard = useCallback((path: string) => {
    setOpenOverride(null);
    setFocusNew(false);
    setFocusAddSubcard(false);
    setCreateColumn(null);
    setSelected(path);
  }, []);

  const actions = useMemo<BoardActions>(
    () => ({
      open: openCard,
      startCreate: (col) => {
        setSelected(null);
        setCreateColumn(col);
        setOpenOverride(mapOpenMode(settings.addCardOpenMode));
      },
      addSubcard: (path) => {
        // The subcard needs a title; route through the detail's existing add-subcard input
        // (which calls repo.addSubcard on Enter) rather than inventing a separate prompt.
        openCard(path);
        setFocusAddSubcard(true);
      },
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
      setPriority: (path, value) => {
        void (async () => {
          try {
            // Empty value clears the key cleanly (removes the `priority:` line) per the contract,
            // instead of writing a stray empty `priority:` and a misleading `Priority → ` history line.
            if (value === "") await repo.unsetFrontmatterKey(path, "priority");
            else await repo.setFrontmatter(path, { priority: value });
          } catch (e) {
            reportError(e);
          } finally {
            await load();
          }
        })();
      },
      renameCard: (path, title) => {
        const t = title.trim();
        if (!t) return; // empty/whitespace title rejected — caller reverts to the old title
        void (async () => {
          try {
            const newPath = await repo.renameCard(path, t);
            // The board's card title IS the basename, so a rename can change the path. If the
            // renamed card was selected, follow it to its new path so the detail/selection holds.
            if (newPath !== path) setSelected((cur) => (cur === path ? newPath : cur));
          } catch (e) {
            reportError(e);
          } finally {
            await load();
          }
        })();
      },
      moveWithinColumn: (path, dir) => {
        const b = boardRef.current;
        if (!b) return;
        const col = columnOf(b, path);
        if (!col) return;
        const list = b.columns[col] ?? [];
        const i = list.indexOf(path);
        if (i < 0) return;
        if (dir < 0 ? i <= 0 : i >= list.length - 1) return; // already at the edge
        // dropIndex is computed against the list with `path` removed: up (-1) lands before the
        // former predecessor, down (+1) lands after the former successor.
        const dropIndex = i + dir;
        const mut = moveCard(b, path, col, dropIndex);
        if (!mut) return;
        void (async () => {
          try {
            await repo.applyMove(mut);
          } catch (e) {
            reportError(e);
          } finally {
            await load();
          }
        })();
      },
      columnEdges: (path) => {
        const b = boardRef.current;
        if (!b) return { canMoveUp: false, canMoveDown: false };
        const col = columnOf(b, path);
        const list = col ? b.columns[col] ?? [] : [];
        const i = list.indexOf(path);
        return { canMoveUp: i > 0, canMoveDown: i >= 0 && i < list.length - 1 };
      },
      toggleTodo: (path, index, done) => {
        void (async () => {
          try {
            await repo.toggleSubtask(path, index, done);
          } catch (e) {
            reportError(e);
          } finally {
            await load();
          }
        })();
      },
      removeTodo: (path, index) => {
        void (async () => {
          try {
            await repo.removeSubtask(path, index);
          } catch (e) {
            reportError(e);
          } finally {
            await load();
          }
        })();
      },
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
      updateColumn: (id, patch) => {
        const b = boardRef.current;
        if (!b) return;
        // Merge the patch onto the current def; serializeColumns then drops anything equal to its
        // default (group:"none", sort:"manual", opacity:1, parked:false) or blank, so the write
        // stays byte-stable. We pass the merged def straight through and let §2 do the pruning.
        void setColumnsAndReload(b.config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
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
      reorderColumns: (activeId, overId) => {
        const b = boardRef.current;
        if (!b) return;
        const next = moveColumn(b.config.columns, activeId, overId);
        if (next === b.config.columns) return; // no-op (same slot / unknown id)
        void setColumnsAndReload(next);
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
    [openCard, moveTo, doneColumnId, repo, load, setColumnsAndReload, showToast, reportError, settings.addCardOpenMode],
  );

  const wipLimits = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (board) for (const c of board.config.columns) if (typeof c.limit === "number") map[c.id] = c.limit;
    return map;
  }, [board]);

  // Context configs (#14) for the marker provider. Every load() builds a fresh `board.contexts`
  // object; key the memo on its serialized content so its identity only flips when a context's
  // name/color/label actually changes — otherwise every CardItem (a consumer) would re-render on
  // each reload, defeating App's deliberate frontmatter-reference memo optimization.
  const contextsValue = board?.contexts ?? EMPTY_CONTEXTS;
  const contextsKey = JSON.stringify(contextsValue);
  const stableContexts = useMemo(() => contextsValue, [contextsKey]);

  // Parse the query once per change; Board/Column filter with this same parsed §1 Filter.
  const filter = useMemo(() => parseFilter(query), [query]);

  const counts = useMemo(() => {
    let total = 0;
    let match = 0;
    if (board) {
      const ctx = { today: todayValue, doneColumnId };
      for (const col of board.config.columns) {
        for (const p of board.columns[col.id] ?? []) {
          const c = board.cards[p];
          if (!c) continue;
          total++;
          if (matchCard(c, filter, ctx)) match++;
        }
      }
    }
    return { total, match };
  }, [board, filter, todayValue, doneColumnId]);

  // "/" focuses the search box (the placeholder advertises it), but only when this board view is
  // the active, visible one and the user isn't already typing in a field. A document-level listener
  // is required because `.folia-root` isn't focusable, so a `/` pressed with focus on <body> never
  // bubbles to a React handler on it. Scoped to the root's owning document so pop-out windows work.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const doc = root.ownerDocument;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      // Skip when this Folia Kanban tab is hidden/backgrounded (display:none → no client rects), so a
      // foregrounded note doesn't have its "/" stolen by an off-screen board.
      if (root.getClientRects().length === 0) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [board]);

  if (error) return <div className="folia-error">Couldn’t load the board: {error}</div>;
  if (!board) return <div className="folia-loading">Loading board…</div>;

  // The add-card flows can override the presentation for one open; otherwise use the global setting.
  const globalDetailMode: DetailMode =
    settings.detailPresentation === "modal" ? "modal" : settings.sidePanelMode === "float" ? "float" : "split";
  const detailMode: DetailMode = openOverride ?? globalDetailMode;
  const detailOpen = selected != null && board.cards[selected] != null;
  const createMode = createColumn != null && !detailOpen;
  const panelShown = detailOpen || createMode;

  const closeDetail = () => {
    setSelected(null);
    setCreateColumn(null);
    setOpenOverride(null);
    setFocusNew(false);
    setFocusAddSubcard(false);
  };

  const detail = detailOpen ? (
    <CardDetail
      path={selected!}
      board={board}
      mode={detailMode}
      focusNew={focusNew}
      focusAddSubcard={focusAddSubcard}
      onClose={closeDetail}
      onNavigate={openCard}
      onChanged={load}
    />
  ) : createMode ? (
    <CardDetail
      path=""
      board={board}
      mode={detailMode}
      createColumn={createColumn!}
      onClose={closeDetail}
      onChanged={load}
      onCreated={(newPath) => {
        void (async () => {
          setCreateColumn(null);
          setFocusNew(true);
          await load();
          setSelected(newPath);
        })();
      }}
    />
  ) : null;

  return (
    <SettingsContext.Provider value={settingsValue}>
        <RepoContext.Provider value={repo}>
          <BoardActionsContext.Provider value={actions}>
            <ContextsContext.Provider value={stableContexts}>
            <div className="folia-root" ref={rootRef}>
              <Toolbar ref={searchRef} query={query} onChange={setQuery} matchCount={counts.match} totalCount={counts.total} />
              <div className="folia-main" role="region" aria-label="Board">
                <Board
                  board={board}
                  today={todayValue}
                  selectedPath={selected}
                  wipLimits={wipLimits}
                  filter={filter}
                  doneColumnId={doneColumnId}
                  onMove={onMove}
                  onAddCard={onAddCard}
                />
                {/* Side modes (split/float) render the panel as a sibling; split shrinks the board,
                    float overlays it. Modal renders via a portal into the root, over a backdrop. */}
                {detailMode !== "modal" && detail}
              </div>
              {detailMode === "modal" && panelShown && rootRef.current &&
                createPortal(
                  <div
                    className="folia-detail-modal-backdrop"
                    onPointerDown={(e) => { if (e.target === e.currentTarget) closeDetail(); }}
                  >
                    {detail}
                  </div>,
                  rootRef.current,
                )}
              {toast && (
                <div className={"folia-toast folia-toast-" + toast.tone} role="status" aria-live="polite">
                  <Icon name={toast.tone === "error" ? "alert" : "check-circle"} size={16} />
                  {toast.text}
                </div>
              )}
            </div>
            </ContextsContext.Provider>
          </BoardActionsContext.Provider>
        </RepoContext.Provider>
    </SettingsContext.Provider>
  );
}
