import { useContext, useRef, type CSSProperties } from "react";
import type { Board, Card, CardBody } from "../model/types";
import { descriptionRefusal } from "../model/card";
import { CardComments } from "./CardComments";
import { CardFields } from "./CardFields";
import { CardProperties } from "./CardProperties";
import { CardRelations } from "./CardRelations";
import { useRepo } from "./context";
import { CreateCardForm, createColumnTitle, useCreateCard } from "./CreateCardForm";
import { DetailDialogContext } from "./detailDialog";
import { CardHeaderActions, DetailFrame, DetailScroll } from "./DetailFrame";
import { HostButton, HostIconButton } from "./hostControls";
import { Markdown } from "./Markdown";
import { CardSubtasks } from "./SubtaskList";
import { CardTitleFields } from "./TitleFields";
import { useCardPanel, type CardPanelState } from "./useCardPanel";
import type { DescriptionEditor } from "./useDescriptionEditor";

interface Props {
  path: string;
  board: Board;
  onClose: () => void;
  /** Switch the panel to another card (subcard links). The create form never navigates. */
  onNavigate?: (path: string) => void;
  onChanged: () => void;
  /** When set, render the minimal CREATE form (new card in this column) instead of the card body. */
  createColumn?: string;
  /** Called with the new card's path after a successful create. */
  onCreated?: (path: string) => void;
  /** When set, focus the description textarea on mount (fresh card from an add-card flow). */
  focusNew?: boolean;
  /** When set, focus the "Add a subcard" input (the context-menu "Add subcard" action). */
  focusAddSubcard?: boolean;
  /** When set, focus the "Override card title" field (the context-menu action). */
  focusTitleOverride?: boolean;
  /**
   * Advances on every request to open a card, including a re-open of the card already showing.
   * The two flags above are one-shot actions, and a repeat of one lands on the same panel with
   * the same flag already true — so what makes it act a second time is this counter changing,
   * not a remount. (A remount would take every draft in the panel with it.)
   */
  focusSeq?: number;
}

type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

const REFUSAL_REASON: Record<NonNullable<ReturnType<typeof descriptionRefusal>>["kind"], string> = {
  heading:
    "would start a section the plugin owns (Subtasks, Comments, History), and everything below it would leave the description. Rename the heading, or quote it inside a code fence.",
  title:
    "is where the card's title is read from, so saving it would swallow the line and it would not come back. Use a smaller heading, or put it after a line of text.",
  fence:
    "opens a code block that is never closed, so it would run to the end of the note and swallow the sections after it. Close the fence.",
};

interface DescriptionProps {
  body: CardBody | null;
  path: string;
  desc: DescriptionEditor;
  mutate: Mutate;
  stillHere: () => boolean;
}

/** The raw description editor, what stopped its last save, and Save / Revert. */
function DescriptionEditorFields({ body, path, desc, mutate, stillHere }: DescriptionProps) {
  const repo = useRepo();
  const { draft } = desc;
  const save = () => {
    const refusal = descriptionRefusal(draft.draft);
    if (refusal !== null) {
      draft.setRefusal(refusal);
      return;
    }
    // The draft stays dirty through the write and the reload it triggers, so a
    // failed save leaves it in place; only a success makes the saved text the base.
    // Words typed while the write was in flight keep the editor open, unsaved.
    const saved = draft.draft;
    draft.latest.current = saved;
    void mutate(() => repo.setDescription(path, saved)).then((ok) => {
      if (!ok || !stillHere()) return;
      // The note holds the description trimmed, and is read back that way.
      draft.base.current = saved.trim();
      if (draft.latest.current !== saved) return;
      draft.dirty.current = false;
      desc.setEditing(false);
    });
  };
  return (
    <>
      <textarea
        ref={desc.textareaRef}
        className="folia-desc"
        value={draft.draft}
        aria-label="Edit description"
        style={
          desc.preservedHeight != null ? { minHeight: `${desc.preservedHeight}px` } : undefined
        }
        onChange={(e) => draft.type(e.target.value)}
        placeholder="Add a description…"
        onFocus={desc.escape.claim}
        onBlur={desc.escape.release}
      />
      {draft.refusal && (
        <p className="folia-desc-refusal" role="alert">
          Not saved: <code>{draft.refusal.line}</code> {REFUSAL_REASON[draft.refusal.kind]}
        </p>
      )}
      {body && body.description !== draft.base.current && (
        // The note moved on while this draft was being written. Neither side is thrown
        // away on its own: Save writes the draft over it, Revert takes the note's version.
        <p className="folia-desc-behind" role="status">
          The description changed in the note while you were editing. Save keeps your version;
          Revert loads the note's.
        </p>
      )}
      <div className="folia-row-actions">
        <HostButton className="folia-btn" text="Save" cta onClick={save} />
        <HostButton className="folia-btn" text="Revert" onClick={desc.close} />
      </div>
    </>
  );
}

/** The description: rendered by default, the raw editor once clicked, or an invitation to write one. */
function DescriptionSection(props: DescriptionProps) {
  const { body, path, desc } = props;
  const dialog = useContext(DetailDialogContext);
  const { maxHeight } = desc.preview;
  return (
    <section className="folia-section">
      <h3>Description</h3>
      {desc.editing ? (
        <DescriptionEditorFields {...props} />
      ) : body && body.description.trim() ? (
        // a11y exception (no-static-element-interactions, click-events-have-key-events): click-to-edit is a convenience; the keyboard path is the dedicated "Edit description" pencil button rendered below
        <div
          ref={desc.preview.viewRef}
          className="folia-desc-view"
          style={
            maxHeight != null
              ? ({ "--folia-desc-max-h": `${maxHeight}px` } as CSSProperties)
              : undefined
          }
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) return;
            desc.beginFromPreview();
          }}
        >
          <Markdown
            markdown={body.description}
            sourcePath={path}
            className="folia-desc-rendered"
            onFollowLink={() => dialog?.close()}
          />
          <HostIconButton
            className="folia-detail-icon folia-mini folia-desc-edit"
            slotClassName="folia-desc-edit-slot"
            icon="pencil"
            label="Edit description"
            stopPropagation={["click"]}
            onClick={desc.beginFromPreview}
          />
        </div>
      ) : (
        <button
          className="folia-desc-empty folia-muted"
          aria-label="Edit description"
          onClick={() => desc.setEditing(true)}
        >
          Add a description…
        </button>
      )}
    </section>
  );
}

function HistorySection({ body }: { body: CardBody | null }) {
  return (
    <section className="folia-section">
      <h3>History</h3>
      <ul className="folia-history">
        {body?.history.map((h, i) => (
          <li key={i}>
            <span className="folia-ts">{h.timestamp}</span>
            <span>{h.text}</span>
          </li>
        ))}
        {body && body.history.length === 0 && <li className="folia-muted">No history yet.</li>}
      </ul>
    </section>
  );
}

/** The open card, section by section, fed from the state `CardDetail` keeps. */
function CardSections({
  path,
  board,
  card,
  onNavigate,
  panel,
}: {
  path: string;
  board: Board;
  card: Card;
  onNavigate: ((path: string) => void) | undefined;
  panel: CardPanelState;
}) {
  const { body, reload, mutate, stillHere, focus, drafts } = panel;
  return (
    <>
      <CardTitleFields
        board={board}
        card={card}
        body={body}
        path={path}
        overrideRef={focus.titleOverrideRef}
        mutate={mutate}
      />
      <CardFields board={board} card={card} path={path} mutate={mutate} reload={reload} />
      <CardProperties
        card={card}
        path={path}
        form={panel.propertyForm}
        mutate={mutate}
        stillHere={stillHere}
        deleting={panel.deleting}
      />
      <DescriptionSection
        body={body}
        path={path}
        desc={panel.desc}
        mutate={mutate}
        stillHere={stillHere}
      />
      <CardSubtasks
        board={board}
        path={path}
        body={body}
        resolve={panel.resolve}
        onNavigate={onNavigate}
        mutate={mutate}
        reload={reload}
        todoDraft={drafts.todo}
        subcardDraft={drafts.subcard}
        subcardRef={focus.subcardRef}
      />
      <CardRelations
        board={board}
        card={card}
        path={path}
        choices={panel.choices}
        onNavigate={onNavigate}
        mutate={mutate}
      />
      <CardComments
        body={body}
        path={path}
        readState={panel.readState}
        draft={drafts.comment}
        mutate={mutate}
        stillHere={stillHere}
      />
      <HistorySection body={body} />
    </>
  );
}

export function CardDetail({
  path,
  board,
  onClose,
  onNavigate,
  onChanged,
  createColumn,
  onCreated,
  focusNew,
  focusAddSubcard,
  focusTitleOverride,
  focusSeq,
}: Props) {
  // The board reloads on a debounce, so for a moment after this card's file is renamed or moved
  // the board still knows the card only under its old path. Keep showing what it last said about
  // this card instead of flashing "Card not found" at a card that is right there; the next board
  // brings the real thing back. `null` only ever means a path the board has never had a card for.
  const liveCard: Card | undefined = board.cards[path];
  const lastCard = useRef<Card | null>(null);
  if (liveCard) lastCard.current = liveCard;
  const card = liveCard ?? lastCard.current;
  const isCreate = createColumn != null;
  const create = useCreateCard(onCreated);
  const panel = useCardPanel({
    path,
    board,
    card,
    isCreate,
    onChanged,
    focusNew,
    focusAddSubcard,
    focusTitleOverride,
    focusSeq,
  });
  const { panelRef, scrollRef, titleRef } = panel.focus;

  if (isCreate) {
    const columnTitle = createColumnTitle(board, createColumn);
    return (
      <DetailFrame label={`New card in ${columnTitle}`} testId="card-detail" panelRef={panelRef}>
        <DetailScroll
          scrollRef={scrollRef}
          title={<h2 className="folia-detail-title">New card in {columnTitle}</h2>}
        >
          <CreateCardForm board={board} column={createColumn} form={create} onClose={onClose} />
        </DetailScroll>
      </DetailFrame>
    );
  }

  if (!card) {
    return (
      <DetailFrame label="Card not found" panelRef={panelRef}>
        <div className="folia-detail-header">
          <span>Card not found</span>
        </div>
      </DetailFrame>
    );
  }

  return (
    <DetailFrame label={card.title} testId="card-detail" panelRef={panelRef}>
      <DetailScroll
        scrollRef={scrollRef}
        title={
          // A label, not the place to read a long title: clamped to two lines (see
          // `.folia-detail-title`) with the whole of it on hover, and the full, wrapping copy
          // sitting in the "Resulting display title" row a few pixels below.
          <h2 className="folia-detail-title" aria-label={card.title} ref={titleRef} tabIndex={-1}>
            {card.title}
          </h2>
        }
        actions={<CardHeaderActions card={card} path={path} deleting={panel.deleting} />}
      >
        <CardSections path={path} board={board} card={card} onNavigate={onNavigate} panel={panel} />
      </DetailScroll>
    </DetailFrame>
  );
}
