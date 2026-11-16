import { useRef, useState } from "react";
import { PartlyWritten } from "../model/repo";
import type { Settled } from "./detailDialog";

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
 * Why a typed title did not go through whole, for the field that still holds it to show. `partly`
 * is a title that was stored, where only something after it failed: it is not "not saved".
 */
export interface TitleFailure {
  reason: string;
  partly: boolean;
}

/** A failed write as the reason a title field shows. */
export function titleFailure(e: unknown): TitleFailure {
  return {
    reason: e instanceof Error ? e.message : String(e),
    partly: e instanceof PartlyWritten,
  };
}

/**
 * How a held write ended. Not sent, the text stays in its field, and `failure` is why, for the
 * field to show: there is no way for a title to stay unsent without its reason beside it.
 */
export type HeldOutcome = { sent: true } | { sent: false; failure: TitleFailure };

/**
 * A field for text that must never be lost: the title of a card about to be made. Unlike
 * {@link useInlineDraft} it does not empty as it sends. The text stays until the write has gone
 * through, and when it has not, it is still there, with the reason, to fix and send again.
 *
 * What it answers about itself (`settle`, `unsaved`, `failed`, `giveUp`) is what `usePanelHold`
 * holds the detail panel with, so a field in the panel keeps the panel for as long as a title in
 * it is being written or was refused.
 */
export function useHeldDraft() {
  const [value, setValueState] = useState("");
  // Mirrors the value for the answer to a write, which arrives long after the render that sent it.
  const latest = useRef("");
  const setValue = (text: string) => {
    latest.current = text;
    setValueState(text);
  };
  /** Why the last send did not go through, shown until the text is sent again or given up. */
  const [error, setErrorState] = useState<TitleFailure | null>(null);
  const refused = useRef(false);
  const setError = (failure: TitleFailure | null) => {
    refused.current = failure !== null;
    setErrorState(failure);
  };
  // The write in flight. It blocks a second send (Enter, then the button), and its outcome is
  // what leaving the panel waits for.
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [sending, setSending] = useState(false);
  /** Whether a refused title is still in the field. Emptied by hand, there is nothing to keep. */
  const holdsRefused = () => refused.current && latest.current.trim() !== "";
  /**
   * Send the text through `write`. `onLetGo` runs when the write went through and the field was
   * emptied for it, which it is not when more was typed while the write was in flight.
   */
  const send = (write: (text: string) => Promise<HeldOutcome>, onLetGo?: () => void) => {
    const sent = latest.current;
    if (!sent.trim() || inFlight.current) return;
    setError(null);
    setSending(true);
    inFlight.current = write(sent.trim())
      .catch((e: unknown): HeldOutcome => ({ sent: false, failure: titleFailure(e) }))
      .then((outcome) => {
        inFlight.current = null;
        setSending(false);
        if (!outcome.sent) {
          setError(outcome.failure);
          return false;
        }
        // Words typed while the write was in flight are the start of the next one, and stay.
        if (latest.current === sent) {
          setValue("");
          onLetGo?.();
        }
        return true;
      });
  };
  const clear = () => {
    setValue("");
    setError(null);
  };
  return {
    value,
    setValue,
    error,
    sending,
    send,
    clear,
    /** Safe to leave at once with nothing refused; otherwise as the write in flight ends. */
    settle: (): Settled => inFlight.current ?? !holdsRefused(),
    unsaved: () => inFlight.current !== null || holdsRefused(),
  };
}

export type HeldDraft = ReturnType<typeof useHeldDraft>;
