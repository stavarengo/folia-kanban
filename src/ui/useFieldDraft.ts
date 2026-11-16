import { useCallback, useEffect, useRef, useState } from "react";
import type { Settled } from "./detailDialog";

/**
 * A one-line field's local draft, committed on blur/Enter. The persisted value follows the note
 * (a reload after an external edit), and the draft follows it too, but only a draft that is
 * clean: one that still reads what the note said, with no save in flight and none that failed.
 * Anything typed is never taken away. `normalize` rewrites the draft on commit (stripping it, say)
 * and can refuse it with `null`, which writes nothing and leaves the text as typed.
 *
 * Three things are kept apart, because each answers a different question about an incoming value:
 *
 * - the save in flight. Its text must outlive whatever the note says meanwhile, since the save
 *   may yet fail, and a failure has to find the text still in the field;
 * - the save that failed (`onCommit` answered `false`). Its text stays until it is saved or given
 *   up, nothing arriving from the note may replace it, and committing it again is sent as a
 *   retry even when the note already reads that text: a save can fail after storing the value;
 * - what the note last said to a clean field. A save that went through makes the field clean
 *   again, and it then shows the note's answer, which need not be what was asked for: a file name
 *   made safe to use as one, or given a number because the name was taken.
 */
export function useFieldDraft(
  value: string,
  onCommit: (v: string, retry: boolean) => void | Promise<boolean>,
  normalize: (v: string) => string | null = (v) => v,
) {
  const [draft, setDraftState] = useState(value);
  // Mirrors the draft for a commit that follows a `setDraft` in the same event (a picked
  // suggestion), before React has re-rendered with the new draft.
  const latest = useRef(value);
  const setDraft = useCallback((d: string) => {
    latest.current = d;
    setDraftState(d);
  }, []);
  const base = useRef(value);
  const pending = useRef<Promise<boolean> | null>(null);
  // Set by a commit asked for while another is in flight: it runs once that one is through.
  const again = useRef(false);
  const { failedText, failed, setFailed } = useFailedText();
  const persisted = useLatest(value);
  // A save can start long after the render that asked for it: one queued behind another runs
  // when that one is through, by which time the card's file may have another name. So what a
  // save calls is always what the newest render handed over, never what an older one closed on.
  const latestCommit = useLatest(onCommit);
  const latestNormalize = useLatest(normalize);
  useEffect(() => {
    if (pending.current !== null || failedText.current !== null) return;
    const before = base.current;
    base.current = value;
    if (latest.current === before) setDraft(value);
  }, [value, setDraft]);

  /** Start the save the draft asks for. Answers how it ends, or at once when there is none. */
  const save = (): Settled => {
    if (pending.current) {
      again.current = true;
      return pending.current;
    }
    const typed = latest.current;
    const next = latestNormalize.current(typed);
    if (next === null) return false;
    if (next !== typed) setDraft(next);
    const retry = failedText.current === next;
    // Against the value as the field would show it: a blur with nothing typed writes nothing.
    if (next === latestNormalize.current(persisted.current) && !retry) {
      setFailed(null);
      base.current = persisted.current;
      return true;
    }
    const from = persisted.current;
    const answer = latestCommit.current(next, retry);
    if (!answer) {
      setFailed(null);
      base.current = next;
      return true;
    }
    const done: Promise<boolean> = answer.then((written) => {
      pending.current = null;
      if (!written) {
        again.current = false;
        setFailed(next);
        return false;
      }
      setFailed(null);
      // The note may have answered while the save was in flight. A draft that still reads what
      // was sent takes the answer; words typed since stay, and are saved next.
      const answered = persisted.current !== from;
      base.current = answered ? persisted.current : next;
      if (answered && latest.current === next) setDraft(persisted.current);
      if (!again.current) return true;
      again.current = false;
      return save();
    });
    pending.current = done;
    return done;
  };
  const commit = () => void save();
  /** Give up what is typed: the field reads what the note says again. */
  const revert = () => {
    setFailed(null);
    base.current = persisted.current;
    setDraft(persisted.current);
  };
  /** Whether the field holds anything the note does not: typed, being saved, or refused. */
  const unsaved = () =>
    pending.current !== null ||
    failedText.current !== null ||
    latestNormalize.current(latest.current) !== latestNormalize.current(persisted.current);
  return { draft, setDraft, commit, flush: save, revert, failed, unsaved };
}

/** The text of the save that failed: read by the saves that follow, and drawn as a flag. */
function useFailedText() {
  const failedText = useRef<string | null>(null);
  const [failed, setFailedState] = useState(false);
  const setFailed = (text: string | null) => {
    failedText.current = text;
    setFailedState(text !== null);
  };
  return { failedText, failed, setFailed };
}

/** What the newest render was given, for work that runs after the render that started it. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export const trimmed = (v: string) => v.trim();
