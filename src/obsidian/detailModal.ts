// The dialog the card detail panel is drawn in: Obsidian's own `Modal`, so the backdrop, the focus
// trap, Escape, the close button and focus restore are the app's. The panel itself is portalled
// into `contentEl` by the board; nothing here knows what it shows.

import { Modal, Scope, type App } from "obsidian";
import type { DetailModalHandle } from "../ui/App";
import type { Settled } from "../ui/detailDialog";

class DetailModal extends Modal {
  private closed = false;
  /** A request to close is waiting for `mayClose`. */
  private closing = false;

  constructor(
    app: App,
    private onClosed: () => void,
    private mayClose: () => Settled,
  ) {
    super(app);
    this.modalEl.addClass("folia-detail-modal");
    // The portal leaves the board root, and every `--folia-*` token hangs off `folia-scope`.
    this.contentEl.addClass("folia-scope", "folia-detail-modal-content");
  }

  /**
   * Escape, the backdrop, the close button and a closing pop-out window all end here, and the
   * inherited close removes the DOM before `onClose` runs. A field commits on blur, so the focused
   * one is blurred first, while it is still in the document: otherwise a half-typed value is lost.
   *
   * A commit is not a save that went through. The panel is asked whether it may go, and a save
   * still in flight is waited for: one that fails would otherwise fail on a field already taken
   * away, with the text typed into it. So the dialog closes once the answer is yes, and stays,
   * field and reason in view, when it is no.
   */
  override close(): void {
    if (this.closed || this.closing) return;
    const focused = this.contentEl.doc.activeElement;
    if (
      focused?.instanceOf(HTMLElement) &&
      this.contentEl.contains(focused) &&
      (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")
    )
      focused.blur();
    const may = this.mayClose();
    if (may === true) {
      this.dispose();
      return;
    }
    if (may === false) return;
    this.closing = true;
    void may
      .catch(() => false)
      .then((ok) => {
        this.closing = false;
        if (ok) this.dispose();
      });
  }

  /**
   * Close without asking. The board does this when the panel goes away, which can come right
   * after the dialog closed itself, so a second call does nothing.
   */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    super.close();
  }

  override onClose(): void {
    this.onClosed();
  }

  /**
   * A child of the dialog's own scope, so while it is pushed Escape reaches `handler` and not the
   * dialog, and every other key still resolves through the dialog and the app.
   */
  pushEscape(handler: () => void): () => void {
    const scope = new Scope(this.scope);
    scope.register([], "Escape", () => {
      handler();
      return false;
    });
    this.app.keymap.pushScope(scope);
    let popped = false;
    return () => {
      if (popped) return;
      popped = true;
      this.app.keymap.popScope(scope);
    };
  }
}

/**
 * Open the detail panel's dialog on the active window. `onClosed` runs however it was closed, and
 * `mayClose` decides whether a request to close it goes through (see `BoardHost.openDetailModal`).
 */
export function openDetailModal(
  app: App,
  onClosed: () => void,
  mayClose: () => Settled,
): DetailModalHandle {
  const modal = new DetailModal(app, onClosed, mayClose);
  modal.open();
  return {
    contentEl: modal.contentEl,
    close: () => modal.close(),
    dispose: () => modal.dispose(),
    pushEscape: (handler) => modal.pushEscape(handler),
  };
}
