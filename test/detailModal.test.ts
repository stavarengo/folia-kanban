// The dialog the detail panel is drawn in, against a stand-in for Obsidian's `Modal`: when a
// request to close it goes through, and when it has to wait or stay.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { Settled } from "../src/ui/detailDialog";

// Obsidian's Modal reduced to what the dialog asks of it: an element to draw into, with the DOM
// helpers Obsidian adds, and a close that takes the element away and reports it.
vi.mock("obsidian", () => {
  const element = () =>
    Object.assign(document.createElement("div"), {
      addClass() {},
      doc: document,
    });
  class Modal {
    modalEl = element();
    contentEl = element();
    scope = {};
    constructor(public app: unknown) {
      this.modalEl.appendChild(this.contentEl);
    }
    open() {
      document.body.appendChild(this.modalEl);
    }
    close() {
      this.modalEl.remove();
      this.onClose();
    }
    onClose() {}
  }
  class Scope {
    register() {}
  }
  return { Modal, Scope };
});

const { openDetailModal } = await import("../src/obsidian/detailModal");

/** Open the dialog with a field in it, and with `mayClose` as the panel's answer. */
function opened(mayClose: () => Settled) {
  const onClosed = vi.fn();
  const modal = openDetailModal({} as App, onClosed, mayClose);
  const field = document.createElement("input");
  modal.contentEl.appendChild(field);
  field.focus();
  const committed = vi.fn();
  field.addEventListener("blur", committed);
  return { modal, field, onClosed, committed };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("closing the detail dialog", () => {
  it("commits the focused field, then closes at once when the panel has nothing unsaved", () => {
    const { modal, field, onClosed, committed } = opened(() => true);
    modal.close();
    expect(committed).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(field.isConnected).toBe(false);
  });

  it("asks the panel only after the focused field was blurred, so the save it starts is seen", () => {
    const order: string[] = [];
    const { modal, field } = opened(() => {
      order.push("asked");
      return true;
    });
    field.addEventListener("blur", () => order.push("blurred"));
    modal.close();
    expect(order).toEqual(["blurred", "asked"]);
  });

  it("waits for a save in flight, and stays open with its field when the save fails", async () => {
    let fail!: () => void;
    const save = new Promise<boolean>((resolve) => (fail = () => resolve(false)));
    const { modal, field, onClosed } = opened(() => save);

    modal.close();
    // Not closed while the answer is out, and a second request changes nothing.
    modal.close();
    expect(onClosed).not.toHaveBeenCalled();
    expect(field.isConnected).toBe(true);

    fail();
    await save;
    await Promise.resolve();
    expect(onClosed).not.toHaveBeenCalled();
    expect(field.isConnected).toBe(true);
  });

  it("closes once the save in flight has gone through", async () => {
    const { modal, field, onClosed } = opened(() => Promise.resolve(true));
    modal.close();
    expect(onClosed).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(field.isConnected).toBe(false);
  });

  it("stays open when the panel says no, and can be asked again", () => {
    let answer = false;
    const { modal, onClosed } = opened(() => answer);
    modal.close();
    expect(onClosed).not.toHaveBeenCalled();
    answer = true;
    modal.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("is taken away without asking when the panel itself is gone, and only once", () => {
    const mayClose = vi.fn(() => false);
    const { modal, onClosed } = opened(mayClose);
    modal.dispose();
    modal.dispose();
    modal.close();
    expect(mayClose).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
