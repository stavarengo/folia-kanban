import type { BoardHost, DetailModalHandle } from "../src/ui/App";

/** One open stand-in for the detail panel's dialog, as a test can drive it. */
export interface FakeDetailModal extends DetailModalHandle {
  /** The whole dialog, close button included; `contentEl` sits inside it. */
  readonly containerEl: HTMLElement;
  /** Whether it has closed, by any route. */
  readonly closed: boolean;
}

/**
 * Stands in for `src/obsidian/detailModal.ts`, keeping the behaviour the panel relies on: the
 * dialog sees Escape before anything inside it, a pushed Escape handler wins over closing, closing
 * blurs the focused field first so it commits, and focus goes back to whatever had it at open.
 * The dialog lands in `doc`, the way Obsidian opens a modal on the active window.
 */
export function fakeDetailModals(doc: Document = document) {
  const opened: FakeDetailModal[] = [];
  const openDetailModal = (onClosed: () => void): FakeDetailModal => {
    const opener = doc.activeElement as HTMLElement | null;
    const containerEl = doc.createElement("div");
    const closeButton = doc.createElement("button");
    closeButton.setAttribute("aria-label", "Close dialog");
    const contentEl = doc.createElement("div");
    contentEl.className = "folia-scope";
    containerEl.append(closeButton, contentEl);
    doc.body.appendChild(containerEl);
    const escapes: (() => void)[] = [];
    let closed = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || opened.at(-1) !== modal) return;
      e.preventDefault();
      e.stopPropagation();
      const handler = escapes.at(-1);
      if (handler) handler();
      else modal.close();
    };
    doc.addEventListener("keydown", onKey, true);
    const modal: FakeDetailModal = {
      containerEl,
      contentEl,
      get closed() {
        return closed;
      },
      close() {
        if (closed) return;
        closed = true;
        const focused = doc.activeElement as HTMLElement | null;
        if (
          focused &&
          contentEl.contains(focused) &&
          (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")
        )
          focused.blur();
        doc.removeEventListener("keydown", onKey, true);
        containerEl.remove();
        opened.splice(opened.indexOf(modal), 1);
        opener?.focus?.();
        onClosed();
      },
      pushEscape(handler) {
        escapes.push(handler);
        return () => {
          const i = escapes.indexOf(handler);
          if (i >= 0) escapes.splice(i, 1);
        };
      },
    };
    closeButton.addEventListener("click", () => modal.close());
    opened.push(modal);
    return modal;
  };
  return {
    openDetailModal,
    /** The dialog on screen, if any. */
    current: (): FakeDetailModal | undefined => opened.at(-1),
  };
}

/** A host with nothing but the dialog, for a board whose test is not about the leaf. */
export function testHost(doc: Document = document): BoardHost {
  return {
    bindSearchShortcut: () => () => {},
    openDetailModal: fakeDetailModals(doc).openDetailModal,
  };
}
