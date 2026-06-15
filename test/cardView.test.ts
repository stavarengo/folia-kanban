import { describe, it, expect } from "vitest";
import { priorityTone, dueInfo, cardMatches } from "../src/ui/cardView";
import { dateOnly, stamp } from "../src/model/dates";
import type { Card } from "../src/model/types";

function card(fm: Card["frontmatter"], basename = "Card"): Card {
  return { path: `Tasks/${basename}.md`, basename, frontmatter: fm, childLinks: [] };
}

describe("priorityTone", () => {
  it("maps the letter scale", () => {
    expect(priorityTone("A")).toBe("prio-1");
    expect(priorityTone("B")).toBe("prio-2");
    expect(priorityTone("C")).toBe("prio-3");
    expect(priorityTone("D")).toBe("prio-4");
  });
  it("maps the word scale (case-insensitive)", () => {
    expect(priorityTone("urgent")).toBe("prio-1");
    expect(priorityTone("HIGH")).toBe("prio-1");
    expect(priorityTone("medium")).toBe("prio-2");
    expect(priorityTone("low")).toBe("prio-3");
  });
  it("falls back to muted for unknown values (keeps arbitrary scales rendering)", () => {
    expect(priorityTone("someday")).toBe("muted");
    expect(priorityTone("")).toBe("muted");
  });
});

describe("dueInfo", () => {
  const today = "2026-06-16";
  it("flags overdue with a human label", () => {
    expect(dueInfo("2026-06-15", today, false)).toEqual({ label: "Yesterday", urgency: "overdue" });
    expect(dueInfo("2026-06-10", today, false)).toEqual({ label: "6d ago", urgency: "overdue" });
  });
  it("labels today and soon", () => {
    expect(dueInfo("2026-06-16", today, false)).toEqual({ label: "Today", urgency: "today" });
    expect(dueInfo("2026-06-17", today, false)).toEqual({ label: "Tomorrow", urgency: "soon" });
    expect(dueInfo("2026-06-18", today, false)).toEqual({ label: "in 2d", urgency: "soon" });
  });
  it("treats far-out dates as future and done cards as done", () => {
    expect(dueInfo("2026-07-30", today, false).urgency).toBe("future");
    expect(dueInfo("2026-06-10", today, true).urgency).toBe("done"); // done overrides overdue
  });
});

describe("cardMatches", () => {
  const today = "2026-06-16";
  it("matches search text against title, priority and tags", () => {
    const c = card({ priority: "high", area: "garden-prep" }, "Apply the mulch");
    expect(cardMatches(c, today, { text: "apply", due: "" })).toBe(true);
    expect(cardMatches(c, today, { text: "high", due: "" })).toBe(true);
    expect(cardMatches(c, today, { text: "garden-prep", due: "" })).toBe(true);
    expect(cardMatches(c, today, { text: "nope", due: "" })).toBe(false);
  });
  it("filters by overdue / soon", () => {
    const overdue = card({ due: "2026-06-10" });
    const soon = card({ due: "2026-06-17" });
    const far = card({ due: "2026-08-01" });
    expect(cardMatches(overdue, today, { text: "", due: "overdue" })).toBe(true);
    expect(cardMatches(soon, today, { text: "", due: "overdue" })).toBe(false);
    expect(cardMatches(soon, today, { text: "", due: "soon" })).toBe(true);
    expect(cardMatches(far, today, { text: "", due: "soon" })).toBe(false);
    expect(cardMatches(card({}), today, { text: "", due: "soon" })).toBe(false); // no due → excluded
  });
});

describe("dates", () => {
  it("formats date-only and timestamp", () => {
    const d = new Date(2026, 5, 16, 9, 5); // local June 16 2026 09:05
    expect(dateOnly(d)).toBe("2026-06-16");
    expect(stamp(d)).toBe("2026-06-16 09:05");
  });
});
