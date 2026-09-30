import { useContext, type MutableRefObject, type ReactNode, type RefObject } from "react";
import type { Card } from "../model/types";
import { useBoardActions, useRepo } from "./context";
import { DetailDialogContext } from "./detailDialog";
import { HostIconButton } from "./hostControls";

/**
 * The dialog element itself. Every branch of the panel renders through this one component, so
 * the create form handing over to the card it made keeps the same element on screen.
 */
export function DetailFrame({
  label,
  testId,
  panelRef,
  children,
}: {
  label: string;
  testId?: string;
  panelRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      className="folia-detail"
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      ref={panelRef}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

/** The panel's scroller: a sticky header with the title and its actions, then the body. */
export function DetailScroll({
  scrollRef,
  title,
  actions,
  children,
}: {
  scrollRef: RefObject<HTMLDivElement>;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="folia-detail-scroll" ref={scrollRef} tabIndex={-1}>
      <div className="folia-detail-header">
        {title}
        {actions}
      </div>
      <div className="folia-detail-body">{children}</div>
    </div>
  );
}

/** What can be done to the open card as a whole: finish it, open its note, delete it. */
export function CardHeaderActions({
  card,
  path,
  deleting,
}: {
  card: Card;
  path: string;
  deleting: MutableRefObject<boolean>;
}) {
  const repo = useRepo();
  const actions = useBoardActions();
  const dialog = useContext(DetailDialogContext);
  // A note opened somewhere else in the workspace would open under the dialog, so the dialog goes
  // first. Closed directly rather than through `onClose`, which only asks for a render: the dialog
  // gives focus back as it closes, and that has to happen before the note takes it.
  const openElsewhere = (open: () => Promise<void>) => {
    dialog?.close();
    void open();
  };
  return (
    <div className="folia-row-actions">
      {actions.doneColumnId && card.frontmatter.status !== actions.doneColumnId && (
        <HostIconButton
          className="folia-detail-icon folia-detail-action folia-action-done"
          icon="circle-check"
          label="Mark done"
          onClick={() => actions.complete(card)}
        />
      )}
      <HostIconButton
        className="folia-detail-icon folia-detail-action"
        icon="external-link"
        label="Open note"
        middleClick
        onClick={(evt) => openElsewhere(() => repo.openCard(path, evt))}
      />
      <HostIconButton
        className="folia-detail-icon folia-detail-action folia-action-delete"
        icon="trash-2"
        label="Delete card"
        onClick={() => {
          // Set before asking: the panel unmounts as the note goes, before the answer is in.
          deleting.current = true;
          void actions.remove(path).then((gone) => {
            if (!gone) deleting.current = false;
          });
        }}
      />
    </div>
  );
}
