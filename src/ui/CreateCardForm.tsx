import { useId } from "react";
import type { Board, CardFrontmatter } from "../model/types";
import { addCard } from "../model/boardOps";
import { laneFill, prospectiveCard } from "../model/lanes";
import { describeFill } from "./cardView";
import { useBoardActions, useMatchContext, useRepo } from "./context";
import { HostButton } from "./hostControls";
import { TitleError } from "./TitleFields";
import { titleFailure, useHeldDraft } from "./useInlineDraft";

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
  // The title stays in its field until the card exists, and a second submit (rapid Enter, or
  // Enter-then-click) is blocked while the first is being written.
  const draft = useHeldDraft();
  const submit = (column: string, fill: Partial<CardFrontmatter>) =>
    draft.send(async (title) => {
      // The same refusal the inline composer and a drag get: a lane draws by its rule, so a
      // card it would not draw is never written, whichever flow asked for it.
      if (actions.refusedByLane(column, prospectiveCard(title, column, fill))) {
        return { sent: false };
      }
      try {
        onCreated?.(await addCard(repo, { title, columnId: column, fill }));
        return { sent: true };
      } catch (e) {
        // The title stays in its field, with the reason under it, to fix and send again.
        return { sent: false, failure: titleFailure(e) };
      }
    });
  return {
    title: draft.value,
    setTitle: draft.setValue,
    error: draft.error,
    sending: draft.sending,
    submit,
  };
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
          // Held as sent while the card is being written: the form gives way to the card it
          // made, and words typed in between would go with it.
          readOnly={form.sending}
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
      <TitleError failure={form.error} />
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
