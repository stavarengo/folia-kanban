import { useRef, useState } from "react";

/**
 * An add-something box that empties as it sends: a failed write hands the text back, into an
 * empty box only, and only while the panel is still there to show it.
 */
export function useInlineDraft(stillHere: () => boolean) {
  const [value, setValue] = useState("");
  const send = (text: string, write: () => Promise<boolean>) => {
    setValue("");
    void write().then((ok) => {
      if (!ok && stillHere()) setValue((cur) => cur || text);
    });
  };
  return { value, setValue, send };
}

export type InlineDraft = ReturnType<typeof useInlineDraft>;

/**
 * How a held write ended. Not sent, the text stays in its field; `reason` is why, for the field to
 * show, and is left out when the person has already been told.
 */
export interface HeldOutcome {
  sent: boolean;
  reason?: string;
}

/**
 * A field for text that must never be lost: the title of a card about to be made. Unlike
 * {@link useInlineDraft} it does not empty as it sends. The text stays until the write has gone
 * through, and when it has not, it is still there, with the reason, to fix and send again.
 */
export function useHeldDraft() {
  const [value, setValue] = useState("");
  /** Why the last send did not go through, shown until the text is sent again. */
  const [error, setError] = useState<string | null>(null);
  // Blocks a second send (Enter, then the button) while the first is being written.
  const sending = useRef(false);
  const send = (write: (text: string) => Promise<HeldOutcome>) => {
    const sent = value;
    if (!sent.trim() || sending.current) return;
    sending.current = true;
    setError(null);
    void write(sent.trim()).then((outcome) => {
      sending.current = false;
      if (!outcome.sent) setError(outcome.reason ?? null);
      // Words typed while the write was in flight are the start of the next one, and stay.
      else setValue((now) => (now === sent ? "" : now));
    });
  };
  const clear = () => {
    setValue("");
    setError(null);
  };
  return { value, setValue, error, send, clear };
}

export type HeldDraft = ReturnType<typeof useHeldDraft>;
