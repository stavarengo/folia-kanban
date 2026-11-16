import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Card } from "../model/types";
import { useBoardActions } from "./context";
import { useTitleEditAt, useTitleEdits } from "./titleEdits";

/**
 * #12 inline title edit. Entered via the right-click menu's "Rename" (a single title click can't
 * trigger it — that opens the detail), which swaps the title for an <input> seeded with it.
 *
 * What is typed, and why its last save failed, are kept by the board and not by this tile (see
 * `TitleEdits`): a retitle renames the file, which replaces the tile with a new one, and the new
 * one has to open on the same text and the same reason.
 */
export function useTitleEdit(card: Card) {
  const actions = useBoardActions();
  const edits = useTitleEdits();
  const edit = useTitleEditAt(card.path);
  const id = edit?.id ?? null;
  const asked = edit?.asked ?? 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = () => {
    const open = edits.at(card.path);
    // One save at a time: Enter, then the blur it causes, is one commit.
    if (!open || open.saving) return;
    const typed = open.text;
    const next = typed.trim();
    // A save that failed is sent again even when the card already reads that title: the title
    // may be in the note, with the file still to rename after it.
    const retry = open.failure !== null;
    // Otherwise rename only on a real change; empty/whitespace is rejected (revert).
    if (!next || (next === card.title && !retry)) {
      edits.close(open.id);
      return;
    }
    edits.change(open.id, { saving: true, failure: null });
    // The input closes only once the title is written: whatever stops the rename, the text is
    // still in it, with the reason underneath, to fix and send again or to abandon with Escape.
    void actions.renameCard(card.path, next, retry).then((failure) => {
      const now = edits.byId(open.id);
      // Closed meanwhile, with its card: there is no tile left to answer to.
      if (!now) return;
      if (failure !== null) edits.change(open.id, { saving: false, failure });
      // Words typed while the rename was being written are a newer draft, and stay.
      else if (now.text === typed) edits.close(open.id);
      else edits.change(open.id, { saving: false });
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // keep typing (incl. Space) out of the dnd keyboard sensor
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Cancel, with no write. Not while one is in flight: the box stays for its answer, closes
      // itself when the title is written, and shows the reason when it is not.
      const open = edits.at(card.path);
      if (open && !open.saving) edits.close(open.id);
    }
  };
  // A rename that has just been opened takes the focus with its text selected. One that was
  // already open keeps the caret, since selecting the text there would have the next key replace
  // it: it takes the focus when Rename is chosen for it again, and takes it back, on a tile drawn
  // anew for its card, only if it had it.
  useEffect(() => {
    const el = inputRef.current;
    if (id === null || !el) return;
    const wanted = edits.takeFocusWanted(id);
    if (wanted === null && !edits.hadFocus(id)) return;
    el.focus();
    if (wanted === "select") el.select();
  }, [id, asked, edits]);
  return {
    editing: edit?.text ?? null,
    error: edit?.failure ?? null,
    /** Open the rename on `card`, as it reads now. One already open keeps what is typed in it. */
    start: (now: Card) => edits.start(now.path, now.title),
    setEditing: (text: string) => edits.type(card.path, text),
    inputRef,
    onKeyDown,
    onFocus: () => {
      if (id !== null) edits.setFocused(id, true);
    },
    onBlur: (e: { currentTarget: HTMLElement }) => {
      // An input taken away with its tile did not lose the focus to anything.
      if (id !== null && e.currentTarget.isConnected) edits.setFocused(id, false);
      commit();
    },
  };
}
