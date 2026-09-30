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

/** Stable empty column list, so the actions object keeps its identity before the board loads. */
const EMPTY_COLUMNS: readonly ColumnDef[] = [];
const EMPTY_PRIORITIES: readonly string[] = [];

/**
 * Everything the board writes: a drop, an added card, and the actions object. They read the latest
 * board and match context through refs, so they can stay stable across reloads.
 */
export function useBoardWrites({
  repo,
  board,
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
  return { actions, onMove: moves.onMove, onAddCard: moves.onAddCard };
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
  panelActions: Pick<BoardActions, "open" | "startCreate" | "addSubcard" | "editTitleOverride">;
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
    refusedByLane,
    columns,
    onUpdateSettings,
    boardRef,
    matchCtxRef,
    setSelected,
  ]);
}
