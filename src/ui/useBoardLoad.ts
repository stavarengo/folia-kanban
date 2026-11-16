import { useCallback, useEffect, useRef, useState } from "react";
import type { Board as BoardModel } from "../model/types";
import type { CardRepository } from "../model/repo";

/**
 * The board as last read from the vault, re-read on every vault change.
 *
 * A board is kept with the repository it was read from, because the two are only ever right
 * together. When the board cannot be read again, or the view is handed another repository whose
 * board has not arrived yet, the one on screen stays there, so nothing being typed on it is taken
 * away. It is then drawn and written through its own repository (`source`), and it is not
 * `current`: nothing may be worked out from it until a read lands.
 */
export function useBoardLoad(repo: CardRepository) {
  const [read, setRead] = useState<{ board: BoardModel; from: CardRepository } | null>(null);
  const [failed, setFailed] = useState<{ why: string; of: CardRepository } | null>(null);
  // Reads can overlap — every vault change fires another `load`, and the read it starts can take
  // longer than one already in flight. Only the newest requested load may land, the same sequence
  // guard `useCardBody` uses for the detail panel's own per-card body reads: a result whose number
  // has been superseded by the time it resolves is dropped rather than handed to
  // `setRead`/`setFailed`.
  const loadSeq = useRef(0);
  /** Resolves true when this read is the one that landed, false when a newer one superseded it. */
  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++loadSeq.current;
    try {
      const board = await repo.loadBoard();
      if (seq !== loadSeq.current) return false;
      setRead({ board, from: repo });
      setFailed(null);
    } catch (e) {
      if (seq !== loadSeq.current) return false;
      setFailed({ why: e instanceof Error ? e.message : String(e), of: repo });
    }
    return true;
  }, [repo]);

  useEffect(() => {
    void load();
    const off = repo.onChange(() => void load());
    return off;
  }, [load, repo]);

  // Another repository's failure says nothing about this one's board.
  const error = failed !== null && failed.of === repo ? failed.why : null;
  return {
    board: read?.board ?? null,
    /** The repository the board on screen was read from; `repo` itself while there is none. */
    source: read?.from ?? repo,
    error,
    /** Whether the board on screen is `repo`'s own, as its last read found it. */
    current: read !== null && read.from === repo && error === null,
    load,
  };
}
