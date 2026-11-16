import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Board as BoardModel } from "../model/types";
import type { CardRepository } from "../model/repo";
import { parseTodoPath } from "../model/board";
import { remapPath } from "../model/pathOps";
import type { BoardActions } from "./context";
import { CardDetail } from "./CardDetail";
import { LeaveGuard } from "./detailDialog";

/**
 * Which card the detail panel shows, or which column's create form, and everything the panel is
 * opened with: its identity, and the one-shot focus requests it acts on.
 */
export function useDetailPanel(
  repo: CardRepository,
  board: BoardModel | null,
  load: () => Promise<boolean>,
) {
  const [selected, setSelected] = useState<string | null>(null);
  // Add-card flows: which column is in CREATE mode, plus a flag to focus the description of a
  // freshly-created card. Both cleared when the panel closes.
  const [createColumn, setCreateColumn] = useState<string | null>(null);
  const [focusNew, setFocusNew] = useState(false);
  // One-shot: focus the open card's "Add a subcard" input (the context-menu "Add subcard" action).
  const [focusAddSubcard, setFocusAddSubcard] = useState(false);
  // The detail panel's identity, and the ONLY thing that remounts it. It is bumped when the panel
  // is pointed at something else (another card, the create form), and deliberately NOT when the
  // open card's own file is renamed or moved: the panel is then still about the same card, and a
  // remount would throw away everything half-typed in it. Every per-card draft in `CardDetail`
  // rides on this — the panel's state is scoped to one mount, so nothing typed on one card can
  // still be sitting in a field when the panel moves to the next.
  const [openId, setOpenId] = useState(0);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  // Advances on every open, including a re-open of the card already showing. The panel's one-shot
  // focus actions ride on this instead of on a remount; see `openCard`.
  const [focusSeq, setFocusSeq] = useState(0);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  // What a title field holds the panel with while its text is unsaved (see `LeaveGuard`). Every
  // way of taking the panel's fields away asks it first: closing the dialog, pointing the panel
  // elsewhere (`guard.leave` below), and the card's own note going away.
  const guard = useMemo(() => new LeaveGuard(), []);
  const renamedTo = useSelectionFollowsFile(repo, board, { selectedRef, setSelected, guard });

  const openCard = useOpenCard(guard, selectedRef, {
    setSelected,
    setCreateColumn,
    setOpenId,
    setFocusNew,
    setFocusAddSubcard,
    setFocusSeq,
  });

  const panelActions = usePanelActions(guard, openCard, {
    setSelected,
    setCreateColumn,
    setOpenId,
    setFocusAddSubcard,
  });

  /** Open a card the inline composer just added, with its description focused for editing. */
  const showCreated = useCallback(
    (path: string) =>
      guard.leave(() => {
        setFocusNew(true);
        setOpenId((n) => n + 1);
        setSelected(path);
      }),
    [guard],
  );

  const closeDetail = () => {
    setSelected(null);
    setCreateColumn(null);
    setFocusNew(false);
    setFocusAddSubcard(false);
  };

  // The create form stays up until a board that knows the new card arrives (see the handover in
  // `panelFor`); with no panel in between, the dialog would close and reopen. Once a read of ours
  // has landed, the board is as current as it gets: a card it still does not draw is not coming,
  // and the form goes rather than wait for it — unless the panel has been pointed at something
  // else meanwhile, another create form included, which is not ours.
  const onCreated = (newPath: string) => {
    const panel = openIdRef.current;
    setFocusNew(true);
    setSelected(newPath);
    void (async () => {
      while (!(await load()));
      if (openIdRef.current === panel) setCreateColumn(null);
    })();
  };

  /**
   * The panel for this board, if one is shown. Called during render once a board is in hand; not a
   * hook, so it may run after the render's early returns.
   */
  const render = (b: BoardModel) =>
    panelFor(
      b,
      {
        selected,
        renamedTo,
        // Asked as the board is drawn, which is when a card it no longer has would close the panel.
        unsaved: guard.unsaved(),
        createColumn,
        openId,
        focusNew,
        focusAddSubcard,
        focusSeq,
      },
      {
        close: closeDetail,
        navigate: (path) => openCard(path),
        changed: () => void load(),
        created: onCreated,
        handOver: () => setCreateColumn(null),
      },
    );

  return { selected, setSelected, panelActions, showCreated, closeDetail, render, guard };
}

/**
 * Point the panel at a card. Opening a real card resets every add-card flow field so a stale
 * create form can't resurface when the panel later flips to create mode (e.g. the opened card is
 * deleted out from under it). Invariant: createColumn is null whenever a real card's details are
 * on screen. `andThen` runs once the panel has been pointed there.
 */
function useOpenCard(
  guard: LeaveGuard,
  selectedRef: { readonly current: string | null },
  set: {
    setSelected: Dispatch<SetStateAction<string | null>>;
    setCreateColumn: Dispatch<SetStateAction<string | null>>;
    setOpenId: Dispatch<SetStateAction<number>>;
    setFocusNew: Dispatch<SetStateAction<boolean>>;
    setFocusAddSubcard: Dispatch<SetStateAction<boolean>>;
    setFocusSeq: Dispatch<SetStateAction<number>>;
  },
) {
  // `set` holds only state setters, which React keeps stable.
  return useCallback(
    (path: string, andThen?: () => void) => {
      // An inline todo placed in its own column has no note of its own, so opening its tile opens
      // the note that owns the checklist line — where the todo is edited, exactly as it always
      // was. One place, so no caller has to know which kind of tile it just handed us.
      const target = parseTodoPath(path)?.parentPath ?? path;
      const open = () => {
        set.setFocusNew(false);
        set.setFocusAddSubcard(false);
        set.setCreateColumn(null);
        // A new panel identity ONLY when the panel is pointed at something else. Re-opening the
        // card already showing — a second click on its tile, or a context-menu action on it —
        // leaves the mount alone, because remounting would throw away everything half-typed in
        // it. The one-shot focus actions still fire, on `focusSeq` rather than on the new mount.
        if (target !== selectedRef.current) set.setOpenId((n) => n + 1);
        set.setFocusSeq((n) => n + 1);
        set.setSelected(target);
        andThen?.();
      };
      if (target === selectedRef.current) {
        open();
        return;
      }
      // Pointing the panel at another card takes this one's fields away, so a title still being
      // saved is waited for first, and one that cannot be saved keeps the panel where it is.
      guard.leave(open);
    },
    [guard, selectedRef],
  );
}

/**
 * The board actions that point the panel somewhere. Built once per `openCard`, which never changes,
 * so the actions object they are part of keeps its identity.
 */
function usePanelActions(
  guard: LeaveGuard,
  openCard: (path: string, andThen?: () => void) => void,
  set: {
    setSelected: Dispatch<SetStateAction<string | null>>;
    setCreateColumn: Dispatch<SetStateAction<string | null>>;
    setOpenId: Dispatch<SetStateAction<number>>;
    setFocusAddSubcard: Dispatch<SetStateAction<boolean>>;
  },
): Pick<BoardActions, "open" | "startCreate" | "addSubcard"> {
  // `set` holds only state setters, which React keeps stable, so `openCard` alone decides identity.
  return useMemo(
    () => ({
      open: (path) => openCard(path),
      startCreate: (col) =>
        guard.leave(() => {
          set.setSelected(null);
          set.setCreateColumn(col);
          set.setOpenId((n) => n + 1);
        }),
      addSubcard: (path) => {
        // The subcard needs a title; route through the detail's existing add-subcard input
        // (which calls repo.addSubcard on Enter) rather than inventing a separate prompt.
        openCard(path, () => set.setFocusAddSubcard(true));
      },
    }),
    [guard, openCard],
  );
}

/** Whether the board can answer for the selected card: it has it, or is about to under a new path. */
function cardOnBoard(
  b: BoardModel,
  p: { selected: string | null; renamedTo: { from: string; to: string } | null },
): boolean {
  return p.selected != null && (b.cards[p.selected] != null || p.renamedTo?.to === p.selected);
}

/**
 * A card the board no longer has closes its panel, unless a title typed there is unsaved: the
 * panel then stays on what it last knew of the card, saying so, until the text is given up.
 */
function cardGone(
  b: BoardModel,
  p: {
    selected: string | null;
    renamedTo: { from: string; to: string } | null;
    unsaved: boolean;
    createColumn: string | null;
  },
): boolean {
  return p.selected != null && p.createColumn == null && p.unsaved && !cardOnBoard(b, p);
}

function panelFor(
  b: BoardModel,
  p: {
    selected: string | null;
    renamedTo: { from: string; to: string } | null;
    unsaved: boolean;
    createColumn: string | null;
    openId: number;
    focusNew: boolean;
    focusAddSubcard: boolean;
    focusSeq: number;
  },
  on: {
    close: () => void;
    navigate: (path: string) => void;
    changed: () => void;
    created: (path: string) => void;
    handOver: () => void;
  },
) {
  const { selected, createColumn } = p;
  const gone = cardGone(b, p);
  const detailOpen = gone || cardOnBoard(b, p);
  // The create form hands over to the card it made once the board draws that card, whichever load
  // brought it. Waiting on one particular load would not do: a newer one can supersede it.
  if (createColumn != null && detailOpen) on.handOver();
  const createMode = createColumn != null && !detailOpen;
  // Both branches share `openId` as their key on purpose: the create form and the card it creates
  // are one panel the user never sees close, so they must be one mounted component.
  const detail =
    detailOpen && selected != null ? (
      <CardDetail
        key={p.openId}
        path={selected}
        board={b}
        focusNew={p.focusNew}
        focusAddSubcard={p.focusAddSubcard}
        focusSeq={p.focusSeq}
        gone={gone}
        onClose={on.close}
        onNavigate={on.navigate}
        onChanged={on.changed}
      />
    ) : createMode ? (
      <CardDetail
        key={p.openId}
        path=""
        board={b}
        createColumn={createColumn}
        onClose={on.close}
        onChanged={on.changed}
        onCreated={on.created}
      />
    ) : null;
  return { shown: detailOpen || createMode, detail };
}

/**
 * The open card follows its file when that file is renamed, moved, or deleted from OUTSIDE the
 * board (the file explorer, another plugin, an edit on disk), and the panel closes when the file
 * is gone. In-app renames/deletes do this in `renameCard`/`remove`; this covers everything else.
 * Only the selection: it belongs to this view. The per-card maps in plugin data are followed by
 * the plugin itself (`followFileOp` in main.ts), which is also awake when no board is open.
 *
 * A file op is reported the moment the vault makes it, while the board reload it triggers is
 * debounced — so for a short window the board still knows this card only under its old path.
 * The answer names the path the selection was just moved to, and keeps the panel open across
 * that window; without it the panel would unmount and take every uncommitted draft with it.
 * Holding the PATH rather than a flag is what makes it self-checking: a board that arrives
 * knowing some other card cannot keep a panel open for this one.
 */
function useSelectionFollowsFile(
  repo: CardRepository,
  board: BoardModel | null,
  {
    selectedRef,
    setSelected,
    guard,
  }: {
    selectedRef: { readonly current: string | null };
    setSelected: Dispatch<SetStateAction<string | null>>;
    guard: LeaveGuard;
  },
) {
  const [renamedTo, setRenamedTo] = useState<{ from: string; to: string } | null>(null);
  useEffect(
    () =>
      repo.onFileOp((op) => {
        const cur = selectedRef.current;
        if (cur === null) return;
        const next = remapPath(cur, op);
        if (next === cur) return;
        // A delete leaves nothing to follow: the selection clears and the panel closes at once.
        // Unless a title typed in it is unsaved, which keeps the panel (see `panelFor`).
        if (next === null && guard.unsaved()) return;
        setRenamedTo(next === null ? null : { from: cur, to: next });
        setSelected(next);
      }),
    [repo, selectedRef, setSelected, guard],
  );
  // The window closes on the first board that can actually answer for the new path: one that has
  // the card there, or one that no longer has it under the old path either (moved out of the card
  // folder, say) and so really does close the panel. A board still showing the old path was read
  // before the rename and finished after it — it knows nothing about this, and letting it clear
  // the window would unmount the panel and take every draft with it.
  useEffect(() => {
    setRenamedTo((r) =>
      r === null || board === null || board.cards[r.to] != null || board.cards[r.from] == null
        ? null
        : r,
    );
  }, [board]);
  return renamedTo;
}
