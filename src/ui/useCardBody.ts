import { useEffect, useRef, useState } from "react";
import type { Board, CardBody } from "../model/types";
import { useBoardActions, useRepo } from "./context";

/**
 * The open card's note as the panel last read it, and the one way the panel writes.
 *
 * The body is re-read whenever the board reloads — its own writes and edits landing from
 * elsewhere (another pane, an agent, sync) come through the same signal — so what the panel
 * shows is what the note says, not what it said when the panel opened. Each field with a draft
 * decides for itself what a reload may touch: see `onRead`, and the comment list's keys.
 */
export function useCardBody({
  path,
  isCreate,
  board,
  onChanged,
  onRead,
}: {
  path: string;
  isCreate: boolean;
  board: Board;
  onChanged: () => void;
  /** Hands each read that lands to the description draft, which decides whether to take it. */
  onRead: (body: CardBody) => void;
}) {
  const repo = useRepo();
  const actions = useBoardActions();
  const [body, setBody] = useState<CardBody | null>(null);
  /** Which card `body` was read from — the unread state must not trust a stale one. */
  const [bodyPath, setBodyPath] = useState<string | null>(null);

  // Reads can overlap (a write's own reload and the board's); only the latest may land. Every
  // read this panel starts is for its one card — the panel is remounted for another — so the
  // newest read is always the one to keep, whichever path it was started under.
  const readSeq = useRef(0);
  const reload = async () => {
    const seq = ++readSeq.current;
    try {
      const b = await repo.readBody(path);
      if (seq !== readSeq.current || !stillHere()) return;
      setBody(b);
      setBodyPath(path);
      onRead(b);
    } catch {
      // A read that failed (the note mid-rewrite, or already gone) keeps what the panel has:
      // closing here would take the drafts with it, and a card that is really gone leaves the
      // board on its next reload, which unmounts the panel anyway.
    }
  };

  // Whether this panel is still on screen. Async work started here (a read, a write's follow-up)
  // keeps resolving after the panel is gone, and it must not hand text back to a field nobody is
  // looking at. Re-armed on mount, since a remount reuses the same ref.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const stillHere = () => alive.current;

  // `path` changing is NOT a change of card here: App remounts the panel for that. It means the
  // card's own file was renamed or moved, so the note is re-read under its new name and every
  // draft stays exactly where it was.
  useEffect(() => {
    if (isCreate) return; // no card to read while the create form is up
    void reload();
  }, [path, isCreate, board]);

  // Every write the panel makes goes through here, and a failure is reported the way every other
  // board mutation's is (a notice), instead of leaving the panel looking as if nothing happened.
  // The body is re-read and the board reloaded either way, since a write can fail halfway.
  const mutate = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (e) {
      actions.reportError(e);
      return false;
    } finally {
      await reload();
      onChanged();
    }
  };

  return { body, bodyPath, reload, mutate, stillHere };
}
