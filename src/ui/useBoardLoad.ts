import { useCallback, useEffect, useRef, useState } from "react";
import type { Board as BoardModel } from "../model/types";
import type { CardRepository } from "../model/repo";

/** The board as last read from the vault, re-read on every vault change. */
export function useBoardLoad(repo: CardRepository) {
  const [board, setBoard] = useState<BoardModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reads can overlap — every vault change fires another `load`, and the read it starts can take
  // longer than one already in flight. Only the newest requested load may land, the same sequence
  // guard `useCardBody` uses for the detail panel's own per-card body reads: a result whose number
  // has been superseded by the time it resolves is dropped rather than handed to
  // `setBoard`/`setError`.
  const loadSeq = useRef(0);
  /** Resolves true when this read is the one that landed, false when a newer one superseded it. */
  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++loadSeq.current;
    try {
      const b = await repo.loadBoard();
      if (seq !== loadSeq.current) return false;
      setBoard(b);
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return false;
      setError(e instanceof Error ? e.message : String(e));
    }
    return true;
  }, [repo]);

  useEffect(() => {
    void load();
    const off = repo.onChange(() => void load());
    return off;
  }, [load, repo]);

  return { board, error, load };
}
