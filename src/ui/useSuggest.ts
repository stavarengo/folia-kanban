import { useCallback, useEffect, useRef } from "react";
import type { Suggestion, SuggestSource } from "../model/repo";
import { useRepo } from "./context";

/**
 * Give an input the host's type-ahead: spread `ref` on the input. The host binds a popup to an
 * element for good, so the source is attached once per element and reads the current render's
 * words and handlers through a ref instead of re-attaching.
 */
export function useSuggest(source: SuggestSource) {
  const repo = useRepo();
  const latest = useRef(source);
  useEffect(() => {
    latest.current = source;
  });
  const stable = useRef<SuggestSource>({
    ...source,
    candidates: (query) => latest.current.candidates(query),
    onPick: (item) => latest.current.onPick(item),
  });
  const input = useRef<HTMLInputElement | null>(null);
  const off = useRef<(() => void) | null>(null);
  const ref = useCallback(
    (el: HTMLInputElement | null) => {
      off.current?.();
      input.current = el;
      off.current = el ? repo.attachSuggest(el, stable.current) : null;
    },
    [repo],
  );
  return { ref, input };
}

/**
 * A free-text field's rows, one per value it could take. Nothing while the field is empty, so no
 * popup opens there and Enter on an emptied field still clears it.
 */
export const freeTextRows =
  (values: () => readonly string[]) =>
  (query: string): Suggestion[] =>
    query.trim() ? values().map((text) => ({ text })) : [];
export const always = () => true;

/**
 * A free-text field's suggestions: what was typed stays what Enter commits, and picking a row
 * commits that row the way Enter does, by leaving the field.
 */
export function useFreeTextSuggest(
  values: readonly string[],
  setDraft: (text: string) => void,
  commit: () => void,
) {
  const suggest = useSuggest({
    freeText: always,
    candidates: freeTextRows(() => values),
    onPick: ({ text }) => {
      setDraft(text);
      const el = suggest.input.current;
      if (el && el === el.ownerDocument.activeElement) el.blur();
      else commit();
    },
  });
  return suggest.ref;
}
