import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Most suites run in jsdom; the MCP transport suite runs in the `node` environment, where there is
// no DOM at all. Everything below exists to make jsdom look enough like Obsidian, so it is skipped
// rather than crashing the suites that deliberately have no document.
const hasDom = typeof document !== "undefined";

if (hasDom) {
  // jsdom has no Obsidian globals; map activeDocument/activeWindow to the jsdom document/window so
  // the pop-out tests can stand a decoy focused window in for them.
  Object.assign(globalThis, { activeDocument: document, activeWindow: window });

  // Obsidian adds DOM helpers of its own to every element, and jsdom has none of them. Only the
  // ones the plugin actually calls under test are stood in for — an unimplemented helper should
  // fail loudly the first time a test reaches it, not quietly do half of what Obsidian's does.
  if (!HTMLElement.prototype.createEl) {
    HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
      this: HTMLElement,
      tag: K,
      o?: DomElementInfo | string,
    ): HTMLElementTagNameMap[K] {
      const el = this.ownerDocument.createElement(tag);
      const info = typeof o === "string" ? { cls: o } : (o ?? {});
      if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
      if (typeof info.text === "string") el.textContent = info.text;
      for (const [name, value] of Object.entries(info.attr ?? {}))
        if (value !== null && value !== false) el.setAttribute(name, String(value));
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.createDiv) {
    HTMLElement.prototype.createDiv = function (this: HTMLElement, o?: DomElementInfo | string) {
      return this.createEl("div", o);
    };
  }
  if (!HTMLElement.prototype.setAttr) {
    HTMLElement.prototype.setAttr = function (this: HTMLElement, name: string, value: unknown) {
      if (value === null) this.removeAttribute(name);
      else this.setAttribute(name, String(value));
    };
  }
  if (!HTMLElement.prototype.toggle) {
    HTMLElement.prototype.toggle = function (this: HTMLElement, show: boolean) {
      this.style.display = show ? "" : "none";
    };
  }
  if (!Node.prototype.empty) {
    Node.prototype.empty = function (this: Node) {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }

  // jsdom has no ResizeObserver and no layout to drive one. The stub records nothing and never
  // fires: the code under test measures once on mount anyway, and a test that wants a resize calls
  // the measuring path itself.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }

  // jsdom has no matchMedia. Every query answers "no match", the host's state when no preference
  // is set; a test that wants a preference replaces window.matchMedia itself.
  if (!window.matchMedia) {
    window.matchMedia = (media: string) =>
      Object.assign(new EventTarget(), {
        media,
        matches: false,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
      });
  }

  // Obsidian's cross-window stand-ins for `instanceof` and `event.target`. Tests run in one
  // window, so the plain forms are what they reduce to.
  if (!Node.prototype.instanceOf) {
    Node.prototype.instanceOf = function <T>(this: Node, type: new () => T): this is T {
      return this instanceof type;
    };
  }
  if (!("targetNode" in UIEvent.prototype)) {
    Object.defineProperty(UIEvent.prototype, "targetNode", {
      get(this: UIEvent) {
        return this.target instanceof Node ? this.target : null;
      },
    });
  }

  // jsdom doesn't implement the Pointer Capture API; stub it so pointer handlers that capture/release
  // (e.g. the board pan-scroll) don't throw under test.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  }
}

afterEach(() => {
  if (hasDom) cleanup();
});
