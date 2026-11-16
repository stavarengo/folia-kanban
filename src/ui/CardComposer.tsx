import { useId, useState } from "react";
import type { ColumnDef } from "../model/types";
import { HostButton } from "./hostControls";
import { useBoardActions, useSettings } from "./context";
import { TitleError } from "./TitleFields";
import { useHeldDraft, type HeldOutcome } from "./useInlineDraft";

/** The column's inline add-card composer: whether it is open, and what is typed into it. */
export function useCardComposer(
  column: ColumnDef,
  onAddCard: (columnId: string, title: string) => Promise<HeldOutcome>,
) {
  const settings = useSettings();
  const actions = useBoardActions();
  const [adding, setAdding] = useState(false);
  // The title leaves the field only once its card exists: whatever stops the write, the text is
  // still here to fix and send again.
  const draft = useHeldDraft();
  const fillNoteId = useId();

  // 'detail' flow opens the create form in the detail panel; 'inline'/'inline-edit' use the composer.
  const start = () => {
    if (settings.addCardFlow === "detail") actions.startCreate(column.id);
    else setAdding(true);
  };
  const cancel = () => {
    // A card being written is not cancelled by closing its composer, and a write that then failed
    // would fail with nobody looking. The composer stays for the answer: it closes itself when
    // the card exists, and shows the reason when it does not.
    if (draft.sending) return;
    setAdding(false);
    draft.clear();
  };
  const submit = () => {
    if (!draft.value.trim()) {
      cancel();
      return;
    }
    // The composer closes with the title it let go of. Words typed while the card was being
    // written are a newer draft: they stay, in a composer that stays open around them.
    draft.send(
      (title) => onAddCard(column.id, title),
      () => setAdding(false),
    );
  };
  return {
    adding,
    title: draft.value,
    setTitle: draft.setValue,
    error: draft.error,
    fillNoteId,
    start,
    submit,
    cancel,
  };
}

export function CardComposer({
  composer,
  fillNote,
}: {
  composer: ReturnType<typeof useCardComposer>;
  /** How the lane fills an added card, said before anything is written; null for a plain column. */
  fillNote: string | null;
}) {
  const { title, setTitle, error, fillNoteId, submit, cancel } = composer;
  return (
    <div className="folia-add-card">
      <textarea
        autoFocus
        rows={2}
        value={title}
        placeholder="What needs doing?"
        aria-label="New card title"
        aria-describedby={fillNote ? fillNoteId : undefined}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            cancel();
          }
        }}
      />
      {fillNote && (
        <p id={fillNoteId} className="folia-add-card-fill">
          Added with {fillNote}
        </p>
      )}
      <TitleError failure={error} />
      <div className="folia-row-actions">
        <HostButton className="folia-btn" cta text="Add card" keepFocus onClick={submit} />
        <HostButton className="folia-btn" text="Cancel" onClick={cancel} />
      </div>
    </div>
  );
}
