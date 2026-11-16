import { useCallback, useMemo, useRef } from "react";
import type { Board as BoardModel, ColumnDef } from "../model/types";
import type { MatchContext } from "../model/filter";
import type { BoardActions } from "./context";
import type { CardRepository } from "../model/repo";
import type { SettingsPatch } from "../settings";
import { useBoardMoves } from "./useBoardMoves";
import type { useDetailPanel } from "./useDetailPanel";
import { cardActions, cardViewActions, type CardActionDeps } from "./cardActions";
import { todoActions } from "./todoActions";
import { columnActions } from "./columnActions";
import { useTitleEditsStore } from "./titleEdits";

/** Stable empty column list, so the actions object keeps its identity before the board loads. */
const EMPTY_COLUMNS: readonly ColumnDef[] = [];
const EMPTY_PRIORITIES: readonly string[] = [];

/**
 * Everything the board writes: a drop, an added card, the actions object, and the titles still
 * being typed into tiles. The first three read the latest
 * board and match context through refs, so they can stay stable across reloads.
 */
export function useBoardWrites({
  repo,
  board,
  current,
  load,
  panel,
  matchCtx,
  doneColumnId,
  priorities,
  onUpdateSettings,
  inlineEdit,
}: {
  repo: CardRepository;
  board: BoardModel | null;
  /** Whether `board` is the repository's own as last read (see `useBoardLoad`). */
  current: boolean;
  load: () => Promise<boolean>;
  panel: ReturnType<typeof useDetailPanel>;
  matchCtx: MatchContext;
  doneColumnId: string | null;
  priorities: string[];
  onUpdateSettings: (patch: SettingsPatch) => void;
  /** 'inline-edit': an added card opens in the detail panel, its description focused. */
  inlineEdit: boolean;
}) {
  const notify = useCallback(
    (text: string, tone: "success" | "error" = "success") => repo.showNotice(text, tone),
    [repo],
  );
  const reportError = useCallback(
    (e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"),
    [notify],
  );
  // Latest board for stable callbacks — lets the actions object stay referentially stable
  // across single-card edits so memoized cards don't all re-render.
  const boardRef = useRef<BoardModel | null>(null);
  boardRef.current = board;
  const refusedAsStale = useStaleRefusal(board !== null && !current, load, notify);
  // The write paths run long after this render, so they read the match context here rather than
  // closing over this render's value.
  const matchCtxRef = useRef<MatchContext | null>(null);
  matchCtxRef.current = matchCtx;
  const moves = useBoardMoves({
    repo,
    boardRef,
    matchCtxRef,
    load,
    notify,
    reportError,
    refusedAsStale,
    inlineEdit,
    showCreated: panel.showCreated,
  });
  const actions = useActionsValue({
    deps: {
      repo,
      boardRef,
      load,
      notify,
      reportError,
      refusedAsStale,
      refusedByLane: moves.refusedByLane,
      onUpdateSettings,
      setSelected: panel.setSelected,
    },
    panelActions: panel.panelActions,
    matchCtxRef,
    board,
    doneColumnId,
    priorities,
  });
  // What is typed into a tile's rename box is a write not made yet, and is kept with the writes.
  const titleEdits = useTitleEditsStore(repo);
  return { actions, onMove: moves.onMove, onAddCard: moves.onAddCard, titleEdits };
}

const STALE =
  "The board on screen may be out of date, so Folia is reading it again. Try again once it has loaded. Nothing was changed.";

/**
 * The refusal every write worked out from the board answers to. A board kept on screen because it
 * could not be read again, or because another board's is still on its way, shows what the vault
 * held then: a column list written from it would undo a column added since, and a move would be
 * placed among cards that are no longer there. So such a write is refused, the person is told
 * why, and the board is read again, which is what lifts the refusal. Answers with the refusal, or
 * `null` when the board is current.
 *
 * A write that names one note and says what to put in it (a title, a comment, a field) is not
 * worked out from the board, and is not asked.
 */
function useStaleRefusal(
  stale: boolean,
  load: () => Promise<boolean>,
  notify: (text: string, tone?: "success" | "error") => void,
) {
  const staleRef = useRef(stale);
  staleRef.current = stale;
  return useCallback((): string | null => {
    if (!staleRef.current) return null;
    notify(STALE, "error");
    void load();
    return STALE;
  }, [load, notify]);
}

/**
 * The one `BoardActions` object every tile and panel reads. It keeps its identity across reloads
 * that leave the columns and priorities alone — the actions read the latest board through
 * `boardRef` when they run — so memoized cards don't all re-render on a single-card edit.
 */
function useActionsValue({
  deps,
  panelActions,
  matchCtxRef,
  board,
  doneColumnId,
  priorities,
}: {
  deps: CardActionDeps;
  panelActions: Pick<BoardActions, "open" | "startCreate" | "addSubcard">;
  matchCtxRef: { readonly current: MatchContext | null };
  board: BoardModel | null;
  doneColumnId: string | null;
  priorities: string[];
}): BoardActions {
  const {
    repo,
    boardRef,
    load,
    notify,
    reportError,
    refusedAsStale,
    refusedByLane,
    onUpdateSettings,
    setSelected,
  } = deps;
  const columns = board?.config.columns;
  const priorityScale = board?.config.priorities;
  return useMemo<BoardActions>(() => {
    const d = {
      repo,
      boardRef,
      load,
      notify,
      reportError,
      refusedAsStale,
      refusedByLane,
      onUpdateSettings,
      setSelected,
    };
    return {
      ...panelActions,
      reportError,
      refusedByLane,
      ...cardActions(d, doneColumnId),
      ...cardViewActions(d),
      ...todoActions({ ...d, matchCtxRef }),
      doneColumnId,
      columns: columns ?? EMPTY_COLUMNS,
      priorities,
      priorityScale: priorityScale ?? EMPTY_PRIORITIES,
      ...columnActions(d),
    };
  }, [
    panelActions,
    doneColumnId,
    priorities,
    priorityScale,
    repo,
    load,
    notify,
    reportError,
    refusedAsStale,
    refusedByLane,
    columns,
    onUpdateSettings,
    boardRef,
    matchCtxRef,
    setSelected,
  ]);
}
