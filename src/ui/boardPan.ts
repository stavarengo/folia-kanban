import { useEffect, type RefObject } from "react";
import { PointerSensor } from "@dnd-kit/core";

// The pan gesture and the card-drag sensor share the same pointer, so exactly one must claim a given
// press. The live pan mode (settings.boardPan) decides which — but dnd-kit instantiates the sensor
// fresh per activation and only exposes a *static* activator, so it can't read React state directly.
// A module-scoped ref bridges that gap: Board keeps it in sync with the setting, and the activator
// reads it. (One board is mounted at a time, so a single shared ref is safe.)
export const panModeRef = { current: "shift" as "shift" | "empty" };

// Whether a plain left-press should start a card drag. In "shift" mode the Shift/middle-button press
// is reserved for panning, so the card sensor bows out for it (current behavior). In "empty" mode
// cards drag on a plain left-press as usual; panning only kicks in on empty board background (handled
// by the pointer listeners below, which never see a press that lands on a draggable card).
export class PanAwarePointerSensor extends PointerSensor {
  static override activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) return false;
        if (panModeRef.current === "shift" && nativeEvent.shiftKey) return false;
        return true;
      },
    },
  ];
}

// In "empty" mode a plain left-press only pans when it lands on bare board background — never on a
// card, column, or any interactive control. (.folia-board is the background; the columns/AddColumn
// are its children, so a press whose closest interactive ancestor is the board itself is "empty".)
function isEmptyBackground(e: PointerEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    !t.closest(".folia-column, .folia-add-column, button, a, input, textarea, [role='button']")
  );
}

function shouldPan(e: PointerEvent): boolean {
  if (e.button === 1) return true; // middle-button always pans
  if (e.button !== 0) return false;
  if (panModeRef.current === "shift") return e.shiftKey;
  return isEmptyBackground(e); // "empty" mode: plain left-drag on bare background
}

// Horizontal panning of the board. Two modes (settings.boardPan):
//  - "shift": Shift+drag (or middle-button drag) pans from anywhere, incl. over cards/columns. The
//    card-drag sensor bows out for the Shift press (see PanAwarePointerSensor), so the two never
//    fight over the same pointer.
//  - "empty": a plain left-drag pans, but only when the press lands on the empty board background
//    (not a card/column/interactive element); over a card a plain left-drag is a card drag. Shift is
//    not required. Middle-button drag still pans from anywhere in both modes; a middle click
//    that never moved is not a drag, and reaches whatever it landed on.
// The effect reads the live mode each press via panModeRef, so toggling the setting takes effect
// without re-binding listeners.
export function useBoardPan(boardRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let startX = 0;
    let startScroll = 0;
    let panning = false;
    // True once a pan has actually moved past the threshold. preventDefault() on pointerdown does NOT
    // suppress the high-level `click` the browser later synthesizes, so a press that begins and ends on
    // a card would still fire the card's click-to-open. We track the real pan and swallow that click in
    // the capture phase below.
    let didPan = false;

    const onPointerDown = (e: PointerEvent) => {
      // Reset unconditionally (before the gesture guard) so every gesture starts clean — a middle-button
      // pan emits `auxclick` (never `click`), so its didPan would otherwise go stale and eat the next
      // legitimate left-click.
      didPan = false;
      if (!shouldPan(e)) return;
      panning = true;
      startX = e.clientX;
      startScroll = board.scrollLeft;
      board.classList.add("folia-is-pan-scrolling");
      // Capture keeps move/up events flowing to the board even if the pointer leaves it. Guard the
      // call: a pointer can be absent in odd states (e.g. already released), and a throw here would
      // abort the gesture mid-pan.
      try {
        board.setPointerCapture(e.pointerId);
      } catch {
        /* no active pointer to capture — pan still works via the board-level listeners */
      }
      // NOTE: we deliberately do NOT preventDefault here. In "empty" mode a press lands on bare board
      // background often without moving (a plain click to dismiss a popover / blur an inline editor);
      // preventDefault on pointerdown would suppress the native focus-shift and break that commit-on-blur.
      // We only suppress the default (text selection) once an actual pan starts — see onPointerMove.
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      // Match the card-drag sensor's 5px distance so jitter on a shift-click isn't mistaken for a pan.
      if (Math.abs(e.clientX - startX) > 5) {
        didPan = true;
        // Now it's a real pan: kill the text selection a drag would otherwise paint as it scrolls.
        e.preventDefault();
      }
      board.scrollLeft = startScroll - (e.clientX - startX);
    };
    const end = (e: PointerEvent) => {
      if (!panning) return;
      panning = false;
      board.classList.remove("folia-is-pan-scrolling");
      if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
    };
    // Capture phase fires before the event bubbles to React's delegated root container, so this blocks
    // the card's onClick when a pan ended on it.
    const onClickCapture = (e: MouseEvent) => {
      if (!didPan) return;
      e.stopPropagation();
      e.preventDefault();
      didPan = false;
    };

    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("pointermove", onPointerMove);
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", end);
    board.addEventListener("click", onClickCapture, { capture: true });
    // A middle-button pan emits `auxclick`, never `click`, so the same suppression needs both —
    // which is also what lets a middle click that never moved reach the button under it, now that
    // "Open note" reads one as "open in a new tab".
    board.addEventListener("auxclick", onClickCapture, { capture: true });
    return () => {
      board.removeEventListener("pointerdown", onPointerDown);
      board.removeEventListener("pointermove", onPointerMove);
      board.removeEventListener("pointerup", end);
      board.removeEventListener("pointercancel", end);
      board.removeEventListener("click", onClickCapture, { capture: true });
      board.removeEventListener("auxclick", onClickCapture, { capture: true });
    };
  }, [boardRef]);
}
