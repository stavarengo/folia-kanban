import { useCallback } from "react";
import type { Board as BoardModel, Card } from "../model/types";
import type { CardRepository } from "../model/repo";
import type { MatchContext } from "../model/filter";
import { resolveDrop } from "../model/board";
import { addCard, moveCardOver } from "../model/boardOps";
import { laneFill, laneRefusal, prospectiveCard } from "../model/lanes";
import { laneSubject } from "./cardActions";

/** The board's own writes: a card dropped somewhere, a card added to a column, and the lane rule both answer to. */
export function useBoardMoves({
  repo,
  boardRef,
  matchCtxRef,
  load,
  notify,
  reportError,
  inlineEdit,
  showCreated,
}: {
  repo: CardRepository;
  boardRef: { readonly current: BoardModel | null };
  matchCtxRef: { readonly current: MatchContext | null };
  load: () => Promise<boolean>;
  notify: (text: string, tone?: "success" | "error") => void;
  reportError: (e: unknown) => void;
  /** 'inline-edit': an added card opens in the detail panel, its description focused. */
  inlineEdit: boolean;
  showCreated: (path: string) => void;
}) {
  /**
   * A lane is a view of its rule and never an owner of a card, so filing one into a lane it does
   * not match would leave the card claiming a column that will not draw it. The write is refused
   * with the reason instead: nothing is written, and the card returns to where it was.
   */
  const refusedByLane = useCallback(
    (columnId: string, card: Card): boolean => {
      const b = boardRef.current;
      const ctx = matchCtxRef.current;
      if (!b || !ctx) return false;
      const why = laneRefusal(b, columnId, card, ctx);
      if (why === null) return false;
      notify(`${why} Nothing was changed.`, "error");
      return true;
    },
    [notify, boardRef, matchCtxRef],
  );

  const onMove = useCallback(
    async (dragged: Card, overId: string) => {
      const b = boardRef.current;
      if (!b) return;
      const resolved = resolveDrop(b, dragged.path, overId);
      if (resolved && refusedByLane(resolved.columnId, laneSubject(b, dragged))) {
        // Board holds the make-room gap open across the drop and clears it when a reloaded board
        // arrives, so a refusal still has to reload: that is what puts the card back where it was
        // rather than leaving it in a gap no column draws.
        await load();
        return;
      }
      try {
        await moveCardOver(repo, b, { card: dragged, overId });
      } catch (e) {
        // A move can now touch more than one note; what failed in a second note must be seen.
        reportError(e);
      } finally {
        await load();
      }
    },
    [repo, load, reportError, refusedByLane, boardRef],
  );

  /** Adds the card, answering at once whether it was taken, so a refused title stays typed. */
  const onAddCard = useCallback(
    (columnId: string, title: string): boolean => {
      const b = boardRef.current;
      const ctx = matchCtxRef.current;
      if (!b || !ctx) return false;
      // A lane's rule is written onto the card where it names a plain value, so adding to an
      // `area:research` lane makes a research card. What is left is judged before the note exists:
      // a title that misses a lane's words, say, is a card that lane would never draw.
      const fill = laneFill(b, columnId, ctx);
      if (refusedByLane(columnId, prospectiveCard(title, columnId, fill))) return false;
      void (async () => {
        try {
          const path = await addCard(repo, { title, columnId, fill });
          await load();
          // 'inline' (default): add-only — stay in the column, don't open the detail.
          // 'inline-edit': open the new card's detail and focus its description for editing.
          if (inlineEdit) showCreated(path);
        } catch (e) {
          reportError(e);
        }
      })();
      return true;
    },
    [repo, load, inlineEdit, reportError, refusedByLane, boardRef, matchCtxRef, showCreated],
  );

  return { refusedByLane, onMove, onAddCard };
}
