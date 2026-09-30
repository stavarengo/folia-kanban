import { useId, useState } from "react";
import type { ColumnDef } from "../model/types";
import { HostButton } from "./hostControls";
import { useBoardActions, useSettings } from "./context";

/** The column's inline add-card composer: whether it is open, and what is typed into it. */
export function useCardComposer(
  column: ColumnDef,
  /** False when the card was refused, which leaves the title in the composer to be fixed. */
  onAddCard: (columnId: string, title: string) => boolean,
) {
  const settings = useSettings();
  const actions = useBoardActions();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const fillNoteId = useId();

  // 'detail' flow opens the create form in the detail panel; 'inline'/'inline-edit' use the composer.
  const start = () => {
    if (settings.addCardFlow === "detail") actions.startCreate(column.id);
    else setAdding(true);
  };
  const submit = (keepOpen: boolean) => {
    const t = title.trim();
    if (t && !onAddCard(column.id, t)) return;
    setTitle("");
    if (!keepOpen) setAdding(false);
  };
  const cancel = () => {
    setAdding(false);
    setTitle("");
  };
  return { adding, title, setTitle, fillNoteId, start, submit, cancel };
}

export function CardComposer({
  composer,
  fillNote,
}: {
  composer: ReturnType<typeof useCardComposer>;
  /** How the lane fills an added card, said before anything is written; null for a plain column. */
  fillNote: string | null;
}) {
  const { title, setTitle, fillNoteId, submit, cancel } = composer;
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
            submit(false);
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
      <div className="folia-row-actions">
        <HostButton
          className="folia-btn"
          cta
          text="Add card"
          keepFocus
          onClick={() => submit(false)}
        />
        <HostButton className="folia-btn" text="Cancel" onClick={cancel} />
      </div>
    </div>
  );
}
