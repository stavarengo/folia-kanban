import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board as BoardModel } from "../model/types";
import { moveCard, resolveDrop } from "../model/board";
import type { CardRepository } from "../obsidian/repo";
import { RepoContext } from "./context";
import { Board } from "./Board";
import { CardDetail } from "./CardDetail";

function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  const todayValue = useMemo(() => today ?? todayStr(), [today]);

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
      if (!board) return;
      const drop = resolveDrop(board, activeId, overId);
      if (!drop) return;
      const mut = moveCard(board, activeId, drop.columnId, drop.index);
      if (!mut) return;
      await repo.applyMove(mut);
      await load();
    },
    [board, repo, load],
  );

  const onAddCard = useCallback(
    async (columnId: string, title: string) => {
      const path = await repo.createCard(title, columnId);
      await load();
      setSelected(path);
    },
    [repo, load],
  );

  if (error) return <div className="mdkb-error">Couldn’t load the board: {error}</div>;
  if (!board) return <div className="mdkb-loading">Loading board…</div>;

  return (
    <RepoContext.Provider value={repo}>
      <div className="mdkb-root">
        <Board
          board={board}
          today={todayValue}
          selectedPath={selected}
          onOpen={setSelected}
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
    </RepoContext.Provider>
  );
}
