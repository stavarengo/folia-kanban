import type { BoardHost, DetailModalHandle } from "../src/ui/App";
import type { AgentLaunches } from "../src/model/agent";

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

/**
 * Launches a test drives by hand: `wait` and `prepare` put one on a card, `clear` takes it off, and
 * every call the tile makes is recorded.
 */
export function fakeLaunches() {
  const pending = new Map<string, number>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((cb) => cb());
  const calls: { cancel: string[]; startNow: string[] } = { cancel: [], startNow: [] };
  const agents: AgentLaunches = {
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    pending: (path) => pending.get(path) ?? null,
    cancel: (path) => {
      calls.cancel.push(path);
    },
    startNow: (path) => {
      calls.startNow.push(path);
    },
  };
  return {
    agents,
    calls,
    wait(path: string, firesAt: number) {
      pending.set(path, firesAt);
      changed();
    },
    prepare(path: string) {
      pending.set(path, 0);
      changed();
    },
    clear(path: string) {
      pending.delete(path);
      changed();
    },
  };
}

/** A host with nothing but the dialog, for a board whose test is not about the leaf. */
export function testHost(doc: Document = document, agents?: AgentLaunches): BoardHost {
  return {
    bindSearchShortcut: () => () => {},
    openDetailModal: fakeDetailModals(doc).openDetailModal,
    agents: agents ?? fakeLaunches().agents,
  };
}
