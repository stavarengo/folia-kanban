import { useId, useRef, useState } from "react";
import type { Board, CardFrontmatter } from "../model/types";
import { addCard } from "../model/boardOps";
import { laneFill, prospectiveCard } from "../model/lanes";
import { describeFill } from "./cardView";
import { useBoardActions, useMatchContext, useRepo } from "./context";
import { HostButton } from "./hostControls";

/** The title of the column a new card is being created in, or its id when the board has none. */
export const createColumnTitle = (board: Board, createColumn: string) =>
  board.config.columns.find((c) => c.id === createColumn)?.title ?? createColumn;

/**
 * The create form's state, kept by the panel: the form and the card it creates are one mounted
 * component (see App), so this lives as long as the panel does.
 */
export function useCreateCard(onCreated: ((path: string) => void) | undefined) {
  const repo = useRepo();
  const actions = useBoardActions();
  const [title, setTitle] = useState("");
  // Synchronous in-flight guard for the create form: blocks a second submit (rapid Enter, or
  // Enter-then-click) during the async createCard window before onCreated unmounts this branch.
  const creatingRef = useRef(false);
  const submit = (column: string, fill: Partial<CardFrontmatter>) => {
    const t = title.trim();
    if (!t || creatingRef.current) return;
    creatingRef.current = true;
    void (async () => {
      try {
        // The same refusal the inline composer and a drag get: a lane draws by its rule, so a
        // card it would not draw is never written, whichever flow asked for it.
        if (actions.refusedByLane(column, prospectiveCard(t, column, fill))) {
          creatingRef.current = false;
          return;
        }
        const newPath = await addCard(repo, { title: t, columnId: column, fill });
        onCreated?.(newPath);
        // On success this branch unmounts (createColumn→null), so no need to reset the guard.
      } catch (e) {
        creatingRef.current = false; // let the user retry after a failed create
        actions.reportError(e);
      }
    })();
  };
  return { title, setTitle, submit };
}

/** The minimal CREATE form: a title for a new card in one column. */
export function CreateCardForm({
  board,
  column,
  form,
  onClose,
}: {
  board: Board;
  column: string;
  form: ReturnType<typeof useCreateCard>;
  onClose: () => void;
}) {
  const matchCtx = useMatchContext();
  const createFillId = useId();
  const fill = laneFill(board, column, matchCtx);
  const fillNote = describeFill(fill);
  const { title, setTitle } = form;
  const submit = () => form.submit(column, fill);
  return (
    <section className="folia-section">
      <label>
        Title
        <input
          className="folia-create-title"
          autoFocus
          value={title}
          aria-label="New card title"
          placeholder="What needs doing?"
          aria-describedby={fillNote ? createFillId : undefined}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      {fillNote && (
        <p id={createFillId} className="folia-add-card-fill">
          Added with {fillNote}
        </p>
      )}
      <div className="folia-row-actions">
        <HostButton
          className="folia-btn"
          text="Create"
          cta
          disabled={!title.trim()}
          onClick={submit}
        />
        <HostButton className="folia-btn" text="Cancel" onClick={onClose} />
      </div>
    </section>
  );
}
