import { isTodoLine, moveSubtask, subtaskRef, todoTile } from "../model/board";
import { setSubtaskDone } from "../model/boardOps";
import type { MatchContext } from "../model/filter";
import type { TodoLine } from "../model/types";
import type { CardActionDeps } from "./cardActions";
import type { BoardActions } from "./context";

/** The writes a checklist line takes, each held to the line as the caller read it. */
export function todoActions(
  d: CardActionDeps & { matchCtxRef: { readonly current: MatchContext | null } },
): Pick<BoardActions, "readTodo" | "toggleTodo" | "moveTodo" | "removeTodo"> {
  const { repo, boardRef, load, reportError } = d;
  return {
    readTodo: (path, index) => {
      const b = boardRef.current;
      const line = b && subtaskRef(b, path, index);
      // A todo and nothing else. The actions this reading is taken for are the todo actions, and
      // a line naming a child note is a different thing with a different write behind it — one
      // that reaches into that other note. None of the callers can point at such a line today;
      // handing one back would be the way that changes without anybody deciding it.
      return line && isTodoLine(line) ? line : null;
    },
    toggleTodo: (path, line, done) => {
      void (async () => {
        try {
          // The line as the caller read it, text and all: the write refuses rather than tick a
          // position the note has since given to somebody else's todo.
          const b = boardRef.current;
          if (!b) throw new Error(`"${path}" no longer has the subtask that was clicked.`);
          // Ticking a box is also a statement about where the work belongs, for a line that
          // claims a column, so the claim is kept in step with the checkbox.
          const ctx = d.matchCtxRef.current;
          const refused = await setSubtaskDone(repo, b, {
            path,
            line,
            done,
            ...(ctx ? { ctx } : {}),
          });
          if (refused !== null) {
            d.notify(`${refused} The box is ticked; its column is unchanged.`, "error");
          }
        } catch (e) {
          reportError(e);
        } finally {
          await load();
        }
      })();
    },
    moveTodo: (path, line, columnId) => {
      void (async () => {
        try {
          await moveTodo(d, path, line, columnId);
        } catch (e) {
          reportError(e);
        } finally {
          await load();
        }
      })();
    },
    removeTodo: async (path, line) => {
      try {
        const ok = await repo.confirm({
          title: "Remove todo",
          message: `Remove "${line.text}" from the note's checklist?`,
          cta: "Remove",
        });
        if (!ok) return;
        // The line as it read when the person asked, not as it reads now: the note refuses the
        // delete when the position no longer holds that line, however long they took.
        await repo.removeSubtask(path, line);
      } catch (e) {
        reportError(e);
      } finally {
        await load();
      }
    },
  };
}

/** Give a checklist line a column of its own, or send it back to its card (`null`). */
async function moveTodo(
  d: CardActionDeps,
  path: string,
  line: TodoLine,
  columnId: string | null,
): Promise<void> {
  const b = d.boardRef.current;
  // The card has to be there, because the move is worked out against it: which column
  // the card itself stands in. A board without it is one this choice no longer fits — a
  // renamed card is on the board under its old path for a moment — and that is reported
  // rather than swallowed, with the same reload behind it.
  if (!b || !b.cards[path])
    throw new Error(
      `The board no longer draws the todo that was moved in "${path}". Let it reload and try again.`,
    );
  // A placed checklist line stands in a column exactly as a card does, so a lane may no
  // more take one by hand.
  if (columnId !== null) {
    const todo = todoTile(b, path, line, columnId);
    if (todo && d.refusedByLane(columnId, todo)) return;
  }
  // The line is named, so the one `null` left here is the line already standing, BY THE
  // READING THIS CHOICE WAS MADE AGAINST, where it was just sent — which is the reading
  // the person was looking at when they picked, the panel's row or the menu's ticked
  // column. They asked for no change and there is none to report; a note that has moved
  // on underneath is not something their pick failed at, and the reload below is what
  // brings the board onto it. Every other pick does reach the write, and a claim that
  // moved is refused there, loudly.
  const mut = moveSubtask(b, path, line, columnId);
  if (!mut) {
    // "The line already says this", by the reading the choice was made against — and that
    // stays the answer however far the note has drifted since, because a pick that asks
    // for no change has none to report and nothing was written for a drifted note to
    // refuse. What it cannot cover is a position the board holds no line at: there the
    // reading was not merely older, it was of a row that has gone, and the pick has
    // nowhere to have landed. Only that is said out loud.
    if (subtaskRef(b, path, line.index)?.kind !== "todo")
      throw new Error(
        `The board no longer draws the todo that was moved in "${path}". Let it reload and try again.`,
      );
    return;
  }
  await d.repo.applyMove(mut);
}
