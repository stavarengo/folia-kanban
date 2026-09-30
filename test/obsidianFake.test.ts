import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeApp, debounce } from "./obsidianFake";

describe("the Obsidian debounce fake", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the original deadline by default while replacing the pending arguments", () => {
    vi.useFakeTimers();
    const callback = vi.fn<(value: string) => void>();
    const schedule = debounce(callback, 150);

    schedule("first");
    vi.advanceTimersByTime(100);
    schedule("last");
    vi.advanceTimersByTime(50);

    expect(callback).toHaveBeenCalledExactlyOnceWith("last");
  });

  it("resets the deadline when asked and supports cancel and run", () => {
    vi.useFakeTimers();
    const callback = vi.fn<(value: string) => string>((value) => value);
    const schedule = debounce(callback, 150, true);

    schedule("first");
    vi.advanceTimersByTime(100);
    schedule("last");
    vi.advanceTimersByTime(149);
    expect(callback).not.toHaveBeenCalled();
    expect(schedule.run()).toBe("last");
    schedule("cancelled");
    expect(schedule.cancel()).toBe(schedule);
    vi.advanceTimersByTime(300);

    expect(callback).toHaveBeenCalledExactlyOnceWith("last");
  });
});

describe("the Obsidian fileToLinktext fake", () => {
  it("uses the shortest unambiguous path and defaults to omitting .md", () => {
    const app = new FakeApp();
    const root = app.vault.addFile("Child.md");
    const nested = app.vault.addFile("Work/Child.md");

    expect(app.metadataCache.fileToLinktext(root, "Work/Parent.md")).toBe("Child");
    expect(app.metadataCache.fileToLinktext(nested, "Work/Parent.md")).toBe("Work/Child");
    expect(app.metadataCache.fileToLinktext(nested, "Work/Parent.md", false)).toBe("Work/Child.md");
  });

  it("follows the relative and absolute path settings", () => {
    const app = new FakeApp();
    const target = app.vault.addFile("Work/Other/Child.md");

    app.metadataCache.newLinkFormat = "relative";
    expect(app.metadataCache.fileToLinktext(target, "Work/Here/Parent.md")).toBe("../Other/Child");
    app.metadataCache.newLinkFormat = "absolute";
    expect(app.metadataCache.fileToLinktext(target, "Work/Here/Parent.md")).toBe(
      "Work/Other/Child",
    );
  });

  it("widens a dotted Markdown basename when an extensionless file takes the short name", () => {
    const app = new FakeApp();
    app.vault.addFile("Report.v2");
    const target = app.vault.addFile("Work/Report.v2.md");

    expect(app.metadataCache.fileToLinktext(target, "Work/Parent.md")).toBe("Work/Report.v2");
  });
});
