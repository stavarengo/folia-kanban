import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A one-line field's local draft, committed on blur/Enter. The persisted value follows the note
 * (a reload after an external edit), and the draft follows it too — but only a draft that still
 * reads what the field showed before: anything typed, committed or not, is never taken away. So a
 * write that fails keeps its text in the field, and an edit landing from elsewhere waits for the
 * field to be left. `normalize` rewrites the draft on commit (stripping it, say) and can refuse it
 * with `null`, which writes nothing and leaves the text as typed.
 *
 * Committing counts as showing what was committed. That matters where the write answers back with
 * something other than what was asked for — a file name made safe to use as one, or given a
 * suffix because that name was taken — since the field would otherwise keep the asked-for text,
 * read as still unsaved, and re-submit it on the next blur, renaming again and again.
 */
export function useFieldDraft(
  value: string,
  onCommit: (v: string) => void,
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
  const shown = useRef(value);
  useEffect(() => {
    const before = shown.current;
    shown.current = value;
    if (latest.current === before) setDraft(value);
  }, [value, setDraft]);
  const commit = () => {
    const typed = latest.current;
    const next = normalize(typed);
    if (next === null) return;
    if (next !== typed) setDraft(next);
    // Against the value as the field would show it: a blur with nothing typed writes nothing.
    if (next === normalize(value)) return;
    shown.current = next;
    onCommit(next);
  };
  return { draft, setDraft, commit };
}

export const trimmed = (v: string) => v.trim();
