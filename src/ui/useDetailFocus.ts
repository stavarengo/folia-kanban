import { useEffect, useRef } from "react";

/**
 * Where focus lands in the panel: on open, and on the one-shot actions the context menu asks for.
 * The effects run in this order on purpose: an action requested as the panel opens moves focus
 * on from where opening put it.
 */
export function useDetailFocus({
  isCreate,
  focusAddSubcard,
  focusTitleOverride,
  focusSeq,
}: {
  isCreate: boolean;
  focusAddSubcard: boolean | undefined;
  focusTitleOverride: boolean | undefined;
  focusSeq: number | undefined;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The panel's scroller. Focus lands inside it on open, and every control the panel has sits inside
  // it, because the scroll keys only ever move the focused element's own scroll container or an
  // ancestor's, never a descendant's.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Where focus lands on open: the card's name, inside the scroller, so the scroll keys reach it.
  // Its ring sits in the header's padding, where nothing covers or clips it; one drawn around the
  // whole scroller is cut by the sticky header and by the scrollbar.
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const subcardRef = useRef<HTMLInputElement | null>(null);
  const titleOverrideRef = useRef<HTMLInputElement | null>(null);

  // Focus in on open. The dialog the panel is drawn in gives focus back to whatever had it when it
  // opened. The create form autofocuses its title input (a synchronous commit-phase focus), so
  // don't steal it back here.
  useEffect(() => {
    if (!isCreate) (titleRef.current ?? scrollRef.current ?? panelRef.current)?.focus();
  }, []);

  // The "Add subcard" context-menu action opens this card and lands focus on its subcard input,
  // letting the user type the title there (the input's Enter handler calls repo.addSubcard).
  // Keyed on the open counter, not on `path`: a rename moves the path under a panel that is still
  // about the same card, and must not pull focus back here.
  useEffect(() => {
    if (focusAddSubcard && !isCreate) subcardRef.current?.focus();
  }, [focusSeq]);

  // Same shape for the context-menu "Override card title" action.
  useEffect(() => {
    if (focusTitleOverride && !isCreate) titleOverrideRef.current?.focus();
  }, [focusSeq]);

  return { panelRef, scrollRef, titleRef, subcardRef, titleOverrideRef };
}
