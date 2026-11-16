import { useCallback, useContext, useEffect, useRef, type RefObject } from "react";
import { DetailDialogContext, LeaveGuardContext, type PanelHold } from "./detailDialog";

/** A field of the detail panel that holds a title, as the one rule below needs to see it. */
export interface HeldField extends PanelHold {
  /** The text in the field was refused, and the reason is showing beside it. */
  failed: boolean;
  /** The person gives the text up. */
  giveUp(): void;
}

/**
 * The one rule every field of the detail panel that holds a title follows: the card's Title, the
 * create form's, the "Add a subcard" box. Text typed there is never dropped by anything but the
 * person.
 *
 * - The panel is not left while the text is unsaved. Closing the dialog, or pointing the panel at
 *   something else, first asks the field to settle, waits for a save in flight, and stays when
 *   the answer is no (see `LeaveGuard`).
 * - A refusal puts the focus in the field, which brings its reason into view.
 * - While the field shows a failure and has the focus, Escape gives the text up instead of
 *   closing the dialog, which would only be refused again. That is the way out, and the only one.
 *
 * Answers with what the field's focus and blur handlers must call.
 */
export function usePanelHold(input: RefObject<HTMLInputElement | null>, field: HeldField) {
  const guard = useContext(LeaveGuardContext);
  const dialog = useContext(DetailDialogContext);
  const latest = useRef(field);
  latest.current = field;

  useEffect(
    () =>
      guard?.hold({
        settle: () => {
          const settled = latest.current.settle();
          if (settled === true) return true;
          return Promise.resolve(settled).then((ok) => {
            if (!ok) input.current?.focus();
            return ok;
          });
        },
        unsaved: () => latest.current.unsaved(),
      }),
    [guard, input],
  );

  const off = useRef<(() => void) | null>(null);
  const release = useCallback(() => {
    off.current?.();
    off.current = null;
  }, []);
  const claim = useCallback(() => {
    release();
    off.current = dialog?.pushEscape(() => latest.current.giveUp()) ?? null;
  }, [dialog, release]);
  const { failed } = field;
  useEffect(() => {
    const el = input.current;
    if (failed && el !== null && el.ownerDocument.activeElement === el) claim();
    else release();
  }, [failed, input, claim, release]);
  useEffect(() => release, [release]);

  return {
    onFocus: () => {
      if (latest.current.failed) claim();
    },
    onBlur: release,
  };
}

/** How a title that was not saved is given up, said under the reason it was not. */
export const GIVE_UP = {
  /** A retitle: the card keeps the title it has. */
  retitle: "Press Escape in the field to go back to the title the card has.",
  /** A card that was never made: the text is all there is. */
  unmade: "Press Escape in the field to clear it.",
  /** Something was written, and the message says what is left to do. */
  partly: "Press Escape in the field to dismiss this.",
} as const;
