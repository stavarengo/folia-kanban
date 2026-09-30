import { useMemo, useRef } from "react";
import type { Board, Card } from "../model/types";
import { boardLinkResolver } from "../model/board";
import { usePropertyForm } from "./CardProperties";
import { relationChoices } from "./CardRelations";
import { useSettings } from "./context";
import { useCardBody } from "./useCardBody";
import { useCommentReadState } from "./useCommentReadState";
import { useDescriptionDraft, useDescriptionEditor } from "./useDescriptionEditor";
import { useDetailFocus } from "./useDetailFocus";
import { useInlineDraft } from "./useInlineDraft";

/**
 * Everything the detail panel keeps for as long as it is mounted: the note as last read, every
 * draft, and where focus goes. It lives in `CardDetail` itself rather than in the sections that
 * show it, because the panel is one mount from the create form to the card it creates (see App)
 * and a section only exists once there is a card to show.
 */
export function useCardPanel({
  path,
  board,
  card,
  isCreate,
  onChanged,
  focusNew,
  focusAddSubcard,
  focusTitleOverride,
  focusSeq,
}: {
  path: string;
  board: Board;
  card: Card | null;
  isCreate: boolean;
  onChanged: () => void;
  focusNew: boolean | undefined;
  focusAddSubcard: boolean | undefined;
  focusTitleOverride: boolean | undefined;
  focusSeq: number | undefined;
}) {
  const settings = useSettings();
  const deleting = useRef(false);
  const descDraft = useDescriptionDraft();
  const { body, bodyPath, reload, mutate, stillHere } = useCardBody({
    path,
    isCreate,
    board,
    onChanged,
    onRead: descDraft.adopt,
  });
  const todo = useInlineDraft(stillHere);
  const subcard = useInlineDraft(stillHere);
  const comment = useInlineDraft(stillHere);
  const propertyForm = usePropertyForm({ isCreate, board, card, stillHere });
  // Rebuilt only when the board or the open card changes — not on every keystroke in any field.
  const choices = useMemo(() => relationChoices(board, path), [board, path]);
  // The same reading of a `[[wikilink]]` the board used to nest subcards, read from THIS card the
  // way the vault reads a link written in it — so a link the board bound is never shown here as
  // missing, and neither reading can bind a name to a card the other one refused.
  const resolve = useMemo(() => boardLinkResolver(board, path), [board, path]);
  const readState = useCommentReadState({ path, body, bodyPath, settings });
  const focus = useDetailFocus({ isCreate, focusAddSubcard, focusTitleOverride, focusSeq });
  const desc = useDescriptionEditor({
    isCreate,
    focusNew,
    path,
    body,
    draft: descDraft,
    panelRef: focus.panelRef,
  });
  return {
    body,
    reload,
    mutate,
    stillHere,
    deleting,
    focus,
    desc,
    propertyForm,
    readState,
    drafts: { todo, subcard, comment },
    choices,
    resolve,
  };
}

export type CardPanelState = ReturnType<typeof useCardPanel>;
