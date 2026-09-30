import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ContextConfig, RelationCount } from "../model/types";
import type { CardRepository } from "../model/repo";
import type { MatchContext } from "../model/filter";
import type { BoardSettings, SettingsPatch } from "../settings";
import {
  BoardActionsContext,
  ContextsContext,
  RelationCountsContext,
  RepoContext,
  MatchContextContext,
  SettingsContext,
  BoardRootContext,
  type BoardActions,
  type SettingsContextValue,
} from "./context";
import { Board } from "./Board";
import { DetailDialogContext } from "./detailDialog";
import { Toolbar } from "./Toolbar";
import { useToday } from "./useToday";
import { useBoardLoad } from "./useBoardLoad";
import { useDetailPanel } from "./useDetailPanel";
import { useBoardView } from "./useBoardView";
import { useBoardWrites } from "./useBoardWrites";

/** The open dialog the card detail panel is drawn in. See {@link BoardHost.openDetailModal}. */
export interface DetailModalHandle {
  /** Where the panel goes. It already carries `folia-scope`, since it is outside the board root. */
  readonly contentEl: HTMLElement;
  /** Close the dialog, committing a half-typed field first. A second call does nothing. */
  close(): void;
  /**
   * Make Escape call `handler` instead of closing the dialog, until the returned function is
   * called. Calling that function more than once is harmless.
   */
  pushEscape(handler: () => void): () => void;
}

/**
 * What the board borrows from the leaf it is mounted in. `src/ui/**` cannot import `obsidian`, so
 * anything only the host view can answer arrives through this port.
 *
 * The board-level `/` shortcut is one such thing. `.folia-root` is not focusable, so a `/` typed
 * with focus on `<body>` never reaches a React handler, and the board used to listen on its whole
 * document instead — which meant every open board inspected every keypress, and with two boards
 * side by side the one that happened to bind last answered for all of them. The host registers
 * the same shortcut on the view's keymap scope, which Obsidian runs only for the leaf that has
 * focus. The card detail panel's dialog is another.
 */
export interface BoardHost {
  /**
   * Hand the host the board's `/` handler, for as long as there is a search box to focus. The host
   * decides which keypresses are a `/` — which physical combination types one depends on the
   * layout — and when they belong to this board; the board decides whether it wants each one, and
   * says so by returning true, which is the host's cue to suppress the key. Unbinding gives the
   * key back: while nothing is bound, the host claims no `/` at all.
   */
  bindSearchShortcut(onSlash: (event: KeyboardEvent) => boolean): () => void;

  /**
   * Open the dialog the card detail panel is drawn in. `onClosed` runs whenever it closes, whoever
   * closed it — the person (Escape, the backdrop, the host's close button) or the board.
   */
  openDetailModal(onClosed: () => void): DetailModalHandle;
}

/**
 * Keeps the detail panel's dialog open for as long as this is mounted, and draws the panel in it.
 * A portal carries every React context along, so the panel needs nothing re-provided. A layout
 * effect, so the panel mounts into the open dialog before anything is painted.
 */
function DetailDialog({
  host,
  onClosed,
  children,
}: {
  host: BoardHost;
  onClosed: () => void;
  children: ReactNode;
}) {
  const [modal, setModal] = useState<DetailModalHandle | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useLayoutEffect(() => {
    // The board closing the dialog itself has nothing to be told about.
    let ours = false;
    const opened = host.openDetailModal(() => {
      if (!ours) onClosedRef.current();
    });
    setModal(opened);
    return () => {
      ours = true;
      opened.close();
    };
  }, [host]);
  return (
    modal &&
    createPortal(
      <DetailDialogContext.Provider value={modal}>{children}</DetailDialogContext.Provider>,
      modal.contentEl,
    )
  );
}

interface Props {
  repo: CardRepository;
  /** Live settings, sourced from the plugin via the view. */
  settings: BoardSettings;
  /** Pushes a settings patch back to the plugin (persist + re-render open views). The function
   *  form reads the settings as they are at write time — for patches to the path-keyed maps. */
  onUpdateSettings: (patch: SettingsPatch) => void;
  /** Pins the date for deterministic tests; otherwise the real date, which follows the clock. */
  today?: string;
  /** The leaf hosting this board. See {@link BoardHost}. */
  host: BoardHost;
}

export function App({ repo, settings, onUpdateSettings, today, host }: Props) {
  const { board, error, load } = useBoardLoad(repo);
  const panel = useDetailPanel(repo, board, load);
  // #9: the search input is the SINGLE source of truth for board filtering. The board's active
  // filter is `parseFilter(query)` (§1); the preset chips just edit this one string.
  const [query, setQuery] = useState("");
  const searchRef = useRef<Pick<HTMLElement, "focus">>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const todayValue = useToday(today);
  const settingsValue = useMemo(
    () => ({ settings, update: onUpdateSettings }),
    [settings, onUpdateSettings],
  );

  const view = useBoardView({
    board,
    settings,
    query,
    today: todayValue,
    selected: panel.selected,
  });
  const writes = useBoardWrites({
    repo,
    board,
    load,
    panel,
    matchCtx: view.matchCtx,
    doneColumnId: view.doneColumnId,
    priorities: view.priorities,
    onUpdateSettings,
    inlineEdit: settings.addCardFlow === "inline-edit",
  });
  // Whether the board's own chrome is on screen at all — the two renders below stand in for it,
  // one while the first load is in flight and one when a load has failed, and neither has a root
  // or a search box. A boolean rather than the board object so a reload, which builds a new board
  // every time, does not churn everything keyed on this.
  useSearchShortcut(host, board !== null && error === null, searchRef);

  if (error) return <div className="folia-error">Couldn’t load the board: {error}</div>;
  if (!board) return <div className="folia-loading">Loading board…</div>;

  const { shown, detail } = panel.render(board);
  return (
    <BoardContexts
      settings={settingsValue}
      repo={repo}
      actions={writes.actions}
      contexts={view.contexts}
      relations={view.relations}
      matchCtx={view.matchCtx}
      root={rootRef}
    >
      <div className="folia-root folia-scope" ref={rootRef}>
        <Toolbar
          ref={searchRef}
          query={query}
          onChange={setQuery}
          matchCount={view.counts.match}
          totalCount={view.counts.total}
          canFilterMine={settings.userName.trim() !== ""}
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
            selectedPath={panel.selected}
            wipLimits={view.wipLimits}
            filter={view.filter}
            doneColumnId={view.doneColumnId}
            onMove={(card, overId) => void writes.onMove(card, overId)}
            onAddCard={writes.onAddCard}
          />
        </div>
        {shown && (
          <DetailDialog host={host} onClosed={panel.closeDetail}>
            {detail}
          </DetailDialog>
        )}
      </div>
    </BoardContexts>
  );
}

/** Everything the board's components read from context rather than props. */
function BoardContexts({
  settings,
  repo,
  actions,
  contexts,
  relations,
  matchCtx,
  root,
  children,
}: {
  settings: SettingsContextValue;
  repo: CardRepository;
  actions: BoardActions;
  contexts: Record<string, ContextConfig>;
  relations: Record<string, RelationCount[]>;
  matchCtx: MatchContext;
  root: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <SettingsContext.Provider value={settings}>
      <RepoContext.Provider value={repo}>
        <BoardActionsContext.Provider value={actions}>
          <ContextsContext.Provider value={contexts}>
            <RelationCountsContext.Provider value={relations}>
              <MatchContextContext.Provider value={matchCtx}>
                <BoardRootContext.Provider value={root}>{children}</BoardRootContext.Provider>
              </MatchContextContext.Provider>
            </RelationCountsContext.Provider>
          </ContextsContext.Provider>
        </BoardActionsContext.Provider>
      </RepoContext.Provider>
    </SettingsContext.Provider>
  );
}

/**
 * "/" focuses the search box, as the placeholder advertises. The host owns when the key is this
 * board's — only it knows which leaf has focus — and the board owns whether it wants that one.
 * Bound only while there is a box to focus, because that is the only way to leave the key alone:
 * once the host has the key registered, declining it does NOT pass it to another shortcut, it
 * only stops Obsidian cancelling it, which is enough for the field the user is typing in to
 * receive its own slash but not enough for a hotkey bound to "/" to fire. Unbinding is what
 * takes the registration away entirely.
 */
function useSearchShortcut(
  host: BoardHost,
  boardShown: boolean,
  searchRef: { readonly current: Pick<HTMLElement, "focus"> | null },
) {
  useEffect(() => {
    if (!boardShown) return;
    return host.bindSearchShortcut((event) => {
      const el = event.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable)
        return false;
      searchRef.current?.focus();
      return true;
    });
  }, [host, boardShown, searchRef]);
}
