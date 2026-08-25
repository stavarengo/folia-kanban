import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Board as BoardModel, ColumnDef } from "../model/types";
import {
  columnOf,
  findDoneColumn,
  moveCard,
  moveColumn,
  moveSubtask,
  parseTodoPath,
  reassignColumn,
  relationCounts,
  syncSubtaskClaim,
  resolveDrop,
} from "../model/board";
import { dateOnly } from "../model/dates";
import { DEFAULT_PRIORITIES } from "../model/priorities";
import type { CardRepository } from "../model/repo";
import type { KanbanSettings } from "../settings";
import {
  BoardActionsContext,
  ContextsContext,
  RelationCountsContext,
  RepoContext,
  SettingsContext,
  type BoardActions,
  type ColumnPatch,
} from "./context";
import { Board } from "./Board";
import { CardDetail, type DetailMode } from "./CardDetail";
import { Toolbar } from "./Toolbar";
import { Icon } from "./icons";
import { boardPriorities, matchCard, parseFilter } from "./cardView";

/** Stable empty contexts map (#14) so the provider value identity doesn't churn pre-load. */
const EMPTY_CONTEXTS = {} as const;

/** Stable empty relation-count map, same reason. */
const EMPTY_RELATION_COUNTS = {} as const;

/** Stable empty column list, so the actions object keeps its identity before the board loads. */
const EMPTY_COLUMNS: readonly ColumnDef[] = [];

/** Translate `addCardOpenMode` into a presentation override; 'default' means "use the global". */
function mapOpenMode(openMode: KanbanSettings["addCardOpenMode"]): DetailMode | null {
  switch (openMode) {
    case "modal":
      return "modal";
    case "side-float":
      return "float";
    case "side-split":
      return "split";
    // Any other value (incl. the "default" setting or a stale/corrupt persisted value)
    // means "use the global default" — no presentation override.
    default:
      return null;
  }
}

/**
 * Merge a column edit patch onto the current def. A key set to `undefined` in the patch CLEARS
 * that field, so it is dropped from the result (serializeColumns prunes defaults/blanks after).
 */
function applyColumnPatch(c: ColumnDef, patch: ColumnPatch): ColumnDef {
  const merged = { ...c, ...patch };
  const next: ColumnDef = { id: c.id, title: merged.title ?? c.title };
  if (merged.color !== undefined) next.color = merged.color;
  if (merged.limit !== undefined) next.limit = merged.limit;
  if (merged.filter !== undefined) next.filter = merged.filter;
  if (merged.group !== undefined) next.group = merged.group;
  if (merged.sort !== undefined) next.sort = merged.sort;
  if (merged.opacity !== undefined) next.opacity = merged.opacity;
  if (merged.hoverOpacity !== undefined) next.hoverOpacity = merged.hoverOpacity;
  if (merged.parked !== undefined) next.parked = merged.parked;
  return next;
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
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );
  // Latest board for stable callbacks — lets the actions object stay referentially stable
  // across single-card edits so memoized cards don't all re-render.
  const boardRef = useRef<BoardModel | null>(null);
  boardRef.current = board;
  // Same reason, for settings: `actions` only lists `settings.addCardOpenMode` as a memo
  // dependency, so any other settings field read directly off `settings` inside it would close
  // over a stale snapshot (e.g. renameCard's collapsedCards migration below missing a toggle
  // that landed between actions recomputes).
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
    const h = activeDocument.querySelector(".status-bar")?.getBoundingClientRect().height ?? 0;
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
      try {
        const path = await repo.createCard(title, columnId);
        await load();
        // 'inline' (default): add-only — stay in the column, don't open the detail.
        // 'inline-edit': open the new card's detail and focus its description for editing.
        if (settings.addCardFlow === "inline-edit") {
          setOpenOverride(mapOpenMode(settings.addCardOpenMode));
          setFocusNew(true);
          setSelected(path);
        }
      } catch (e) {
        reportError(e);
      }
    },
    [repo, load, settings.addCardFlow, settings.addCardOpenMode, reportError],
  );

  const doneColumnId = useMemo(
    () => (board ? findDoneColumn(board.config.columns) : null),
    [board],
  );

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

  // What the board actually knows: its remembered vocabulary plus the values its cards carry.
  // Empty for a board that has never seen a priority — the pickers substitute the todo.txt
  // starting set below, but nothing empty is ever written back to the note.
  const vocabulary = useMemo(
    () => (board ? boardPriorities(board.config.priorities, Object.values(board.cards)) : []),
    [board],
  );
  const priorities = useMemo(
    () => (vocabulary.length ? vocabulary : [...DEFAULT_PRIORITIES]),
    [vocabulary],
  );

  /**
   * Set a card's priority and let the board note learn from it.
   *
   * The note only ever learns when the user sets a priority — never while loading — and what it
   * learns is everything the board knows at that moment, so a value hand-written straight into a
   * card gets remembered too and outlives that card. Clearing a priority learns nothing: it is a
   * removal, and the point of remembering is that the vocabulary survives its last card.
   */
  const setPriorityAndReload = useCallback(
    async (path: string, raw: string) => {
      // Whitespace-only is no priority at all, the way every other priority path reads it.
      const value = raw.trim();
      // Read what the board knows BEFORE the write. Afterwards the card no longer carries the
      // value it is replacing, so learning from the post-write board would drop the outgoing
      // value — the very thing remembering is supposed to prevent. Only real values are learned:
      // the `A`/`B`/`C` starting set is a suggestion, never something the board is told it uses.
      const b = boardRef.current;
      const learn =
        b && value !== ""
          ? [...boardPriorities(b.config.priorities, Object.values(b.cards)), value]
          : [];
      try {
        // Empty value clears the key cleanly (removes the `priority:` line) per the contract,
        // instead of writing a stray empty `priority:` and a misleading `Priority → ` history line.
        if (value === "") await repo.unsetFrontmatterKey(path, "priority");
        else await repo.setFrontmatter(path, { priority: value });
        if (learn.length) await repo.rememberPriorities(learn);
      } catch (e) {
        reportError(e);
      } finally {
        await load();
      }
    },
    [repo, load, reportError],
  );

  // Opening a real card resets every add-card flow field so a stale create form can't resurface
  // when the panel later flips to create mode (e.g. the opened card is deleted out from under it).
  // Invariant: createColumn is null whenever a real card is selected.
  const openCard = useCallback((path: string) => {
    setOpenOverride(null);
    setFocusNew(false);
    setFocusAddSubcard(false);
    setCreateColumn(null);
    // An inline todo placed in its own column has no note of its own, so opening its tile opens the
    // note that owns the checklist line — where the todo is edited, exactly as it always was. One
    // place, so no caller has to know which kind of tile it just handed us.
    setSelected(parseTodoPath(path)?.parentPath ?? path);
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
        const title = boardRef.current?.cards[path]?.title ?? "Card";
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
            // Prune the per-path plugin data this card owned — its collapse-state override
            // (§ collapse) and its comments-seen marker (§ unread). Left behind, either would
            // silently hand its state to an unrelated card someone later creates at this same
            // path. One patch, because two calls would each build on the same stale snapshot.
            const prune: Partial<KanbanSettings> = {};
            if (settingsRef.current.collapsedCards[path] !== undefined) {
              const nextCollapsed = { ...settingsRef.current.collapsedCards };
              delete nextCollapsed[path];
              prune.collapsedCards = nextCollapsed;
            }
            if (settingsRef.current.commentsSeen[path] !== undefined) {
              const nextSeen = { ...settingsRef.current.commentsSeen };
              delete nextSeen[path];
              prune.commentsSeen = nextSeen;
            }
            if (Object.keys(prune).length) onUpdateSettings(prune);
            await load();
          }
        })();
      },
      openNote: (path) => void repo.openCard(path),
      markCommentsSeen: (path, marker) => {
        const current = settingsRef.current.commentsSeen;
        if ((current[path] ?? "") === marker) return;
        const next = { ...current };
        if (marker) next[path] = marker;
        else delete next[path];
        onUpdateSettings({ commentsSeen: next });
      },
      setPriority: (path, value) => setPriorityAndReload(path, value),
      renameCard: (path, title) => {
        const t = title.trim();
        if (!t) return; // empty/whitespace title rejected — caller reverts to the old title
        void (async () => {
          try {
            const newPath = await repo.renameCard(path, t);
            // When the title comes from the file name, a rename changes the path. If the renamed
            // card was selected, follow it to its new path so the detail/selection holds.
            if (newPath !== path) {
              setSelected((cur) => (cur === path ? newPath : cur));
              // Per-path plugin data is keyed by path in settings, same as selection — follow it
              // to the new path, or a toggled card silently resets to the board default and its
              // already-read comments all light up again; the vacated path could also later hand
              // that state to an unrelated card reusing it. Both maps move in ONE patch, because
              // two calls would each build on the same stale settings snapshot.
              const migrated: Partial<KanbanSettings> = {};
              const collapsedCards = settingsRef.current.collapsedCards;
              const collapsed = collapsedCards[path];
              if (collapsed !== undefined) {
                const nextCollapsed = { ...collapsedCards };
                delete nextCollapsed[path];
                nextCollapsed[newPath] = collapsed;
                migrated.collapsedCards = nextCollapsed;
              }
              const commentsSeen = settingsRef.current.commentsSeen;
              const seen = commentsSeen[path];
              if (seen !== undefined) {
                const nextSeen = { ...commentsSeen };
                delete nextSeen[path];
                nextSeen[newPath] = seen;
                migrated.commentsSeen = nextSeen;
              }
              if (Object.keys(migrated).length) onUpdateSettings(migrated);
            }
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
        const list = col ? (b.columns[col] ?? []) : [];
        const i = list.indexOf(path);
        return { canMoveUp: i > 0, canMoveDown: i >= 0 && i < list.length - 1 };
      },
      toggleTodo: (path, index, done) => {
        void (async () => {
          try {
            await repo.toggleSubtask(path, index, done);
            // Ticking a box is also a statement about where the work belongs, for a line that
            // claims a column: keep the claim and the checkbox from telling two stories. A second
            // write rather than one, so the toggle keeps writing its own history line unchanged.
            const b = boardRef.current;
            const sync = b ? syncSubtaskClaim(b, path, index, done) : null;
            if (sync) await repo.applyMove(sync);
          } catch (e) {
            reportError(e);
          } finally {
            await load();
          }
        })();
      },
      moveTodo: (path, index, columnId) => {
        const b = boardRef.current;
        if (!b) return;
        const mut = moveSubtask(b, path, index, columnId);
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
      columns: board?.config.columns ?? EMPTY_COLUMNS,
      priorities,
      renameColumn: (id, title) => {
        const b = boardRef.current;
        const t = title.trim();
        if (!b || !t) return;
        void setColumnsAndReload(
          b.config.columns.map((c) => (c.id === id ? { ...c, title: t } : c)),
        );
      },
      setColumnColor: (id, color) => {
        const b = boardRef.current;
        if (!b) return;
        void setColumnsAndReload(
          b.config.columns.map((c) => {
            if (c.id !== id) return c;
            const rest = { ...c };
            delete rest.color;
            return color != null ? { ...rest, color } : rest;
          }),
        );
      },
      setColumnLimit: (id, limit) => {
        const b = boardRef.current;
        if (!b) return;
        const lim = limit == null || limit <= 0 ? undefined : Math.floor(limit);
        void setColumnsAndReload(
          b.config.columns.map((c) => {
            if (c.id !== id) return c;
            const rest = { ...c };
            delete rest.limit;
            return lim !== undefined ? { ...rest, limit: lim } : rest;
          }),
        );
      },
      updateColumn: (id, patch) => {
        const b = boardRef.current;
        if (!b) return;
        // Merge the patch onto the current def; serializeColumns then drops anything equal to its
        // default (group:"none", sort:"manual", opacity:1, parked:false) or blank, so the write
        // stays byte-stable. We pass the merged def straight through and let §2 do the pruning.
        void setColumnsAndReload(
          b.config.columns.map((c) => (c.id === id ? applyColumnPatch(c, patch) : c)),
        );
      },
      moveColumn: (id, dir) => {
        const b = boardRef.current;
        if (!b) return;
        const cols = [...b.config.columns];
        const i = cols.findIndex((c) => c.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= cols.length) return;
        const ci = cols[i];
        const cj = cols[j];
        if (!ci || !cj) return;
        [cols[i], cols[j]] = [cj, ci];
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
        if (!neighbor) return;
        const orphans = b.columns[id] ?? [];
        void (async () => {
          // Reassign this column's items to a neighbour so none are orphaned — cards through their
          // frontmatter, placed inline todos through their own checklist line.
          for (const p of orphans) {
            const mut = reassignColumn(b, p, neighbor.id);
            if (!mut) continue;
            try {
              await repo.applyMove(mut);
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
        const base =
          t
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "column";
        let id = base;
        let n = 1;
        while (existing.has(id)) id = `${base}-${n++}`;
        void setColumnsAndReload([...b.config.columns, { id, title: t }]);
      },
    }),
    [
      openCard,
      moveTo,
      doneColumnId,
      priorities,
      repo,
      load,
      setColumnsAndReload,
      setPriorityAndReload,
      showToast,
      reportError,
      settings.addCardOpenMode,
      board?.config.columns,
    ],
  );

  const wipLimits = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (board)
      for (const c of board.config.columns) if (typeof c.limit === "number") map[c.id] = c.limit;
    return map;
  }, [board]);

  // Context configs (#14) for the marker provider. Every load() builds a fresh `board.contexts`
  // object; key the memo on its serialized content so its identity only flips when a context's
  // name/color/label actually changes — otherwise every CardItem (a consumer) would re-render on
  // each reload, defeating App's deliberate frontmatter-reference memo optimization.
  const contextsValue = board?.contexts ?? EMPTY_CONTEXTS;
  const contextsKey = JSON.stringify(contextsValue);
  const stableContexts = useMemo(() => contextsValue, [contextsKey]);

  // Blocking markers: the counts every card tile reads. Recomputed per board load — an edit to
  // one card changes what its neighbours show, so this can't live on the memoized card props.
  const relationCountsValue = useMemo(
    () => (board ? relationCounts(board, doneColumnId) : EMPTY_RELATION_COUNTS),
    [board, doneColumnId],
  );

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
    const onKeyDown = (e: KeyboardEvent) => {
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
    settings.detailPresentation === "modal"
      ? "modal"
      : settings.sidePanelMode === "float"
        ? "float"
        : "split";
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
      path={selected}
      board={board}
      mode={detailMode}
      focusNew={focusNew}
      focusAddSubcard={focusAddSubcard}
      onClose={closeDetail}
      onNavigate={openCard}
      onChanged={() => void load()}
    />
  ) : createMode ? (
    <CardDetail
      path=""
      board={board}
      mode={detailMode}
      createColumn={createColumn}
      onClose={closeDetail}
      onChanged={() => void load()}
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
            <RelationCountsContext.Provider value={relationCountsValue}>
              <div className="folia-root" ref={rootRef}>
                <Toolbar
                  ref={searchRef}
                  query={query}
                  onChange={setQuery}
                  matchCount={counts.match}
                  totalCount={counts.total}
                />
                {board.cardFolderWarning && (
                  <div className="folia-card-folder-notice" role="status">
                    {board.cardFolderWarning}
                  </div>
                )}
                <div className="folia-main" role="region" aria-label="Board">
                  <Board
                    board={board}
                    today={todayValue}
                    selectedPath={selected}
                    wipLimits={wipLimits}
                    filter={filter}
                    doneColumnId={doneColumnId}
                    onMove={(activeId, overId) => void onMove(activeId, overId)}
                    onAddCard={(columnId, title) => void onAddCard(columnId, title)}
                  />
                  {/* Side modes (split/float) render the panel as a sibling; split shrinks the board,
                    float overlays it. Modal renders via a portal into the root, over a backdrop. */}
                  {detailMode !== "modal" && detail}
                </div>
                {detailMode === "modal" &&
                  panelShown &&
                  rootRef.current &&
                  createPortal(
                    <div
                      className="folia-detail-modal-backdrop"
                      onPointerDown={(e) => {
                        if (e.target === e.currentTarget) closeDetail();
                      }}
                    >
                      {detail}
                    </div>,
                    rootRef.current,
                  )}
                {toast && (
                  <div
                    className={"folia-toast folia-toast-" + toast.tone}
                    role="status"
                    aria-live="polite"
                  >
                    <Icon name={toast.tone === "error" ? "alert" : "check-circle"} size={16} />
                    {toast.text}
                  </div>
                )}
              </div>
            </RelationCountsContext.Provider>
          </ContextsContext.Provider>
        </BoardActionsContext.Provider>
      </RepoContext.Provider>
    </SettingsContext.Provider>
  );
}
