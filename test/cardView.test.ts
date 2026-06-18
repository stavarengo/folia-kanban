import { describe, it, expect } from "vitest";
import {
  priorityTone,
  dueInfo,
  cardUrgency,
  cardMatches,
  parseFilter,
  matchCard,
  matchQuery,
  isEmptyFilter,
  EMPTY_FILTER,
  groupAndSortCards,
  hasToken,
  toggleToken,
} from "../src/ui/cardView";
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
    expect(cardMatches(c, today, { text: "apply", due: "" }, "done")).toBe(true);
    expect(cardMatches(c, today, { text: "high", due: "" }, "done")).toBe(true);
    expect(cardMatches(c, today, { text: "garden-prep", due: "" }, "done")).toBe(true);
    expect(cardMatches(c, today, { text: "nope", due: "" }, "done")).toBe(false);
  });
  it("filters by overdue / soon", () => {
    const overdue = card({ due: "2026-06-10" });
    const soon = card({ due: "2026-06-17" });
    const far = card({ due: "2026-08-01" });
    expect(cardMatches(overdue, today, { text: "", due: "overdue" }, "done")).toBe(true);
    expect(cardMatches(soon, today, { text: "", due: "overdue" }, "done")).toBe(false);
    expect(cardMatches(soon, today, { text: "", due: "soon" }, "done")).toBe(true);
    expect(cardMatches(far, today, { text: "", due: "soon" }, "done")).toBe(false);
    expect(cardMatches(card({}), today, { text: "", due: "soon" }, "done")).toBe(false); // no due → excluded
  });
  it("respects the resolved done column for due styling (not the literal 'done')", () => {
    // card in a custom done column 'completed' with a past due is NOT overdue
    const finished = card({ due: "2026-06-10", status: "completed" });
    expect(cardMatches(finished, today, { text: "", due: "overdue" }, "completed")).toBe(false);
    expect(cardMatches(finished, today, { text: "", due: "overdue" }, "done")).toBe(true); // wrong done col → treated as overdue
  });
});

describe("parseFilter", () => {
  it("parses the empty/whitespace query to the empty filter", () => {
    expect(parseFilter("")).toEqual({ text: [], tokens: [] });
    expect(parseFilter("   ")).toEqual({ text: [], tokens: [] });
    expect(isEmptyFilter(parseFilter(""))).toBe(true);
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
  });

  it("splits free text into lower-cased terms", () => {
    expect(parseFilter("Buy Milk")).toEqual({ text: ["buy", "milk"], tokens: [] });
  });

  it("recognizes every key:value token and lower-cases the value", () => {
    const f = parseFilter("area:Research status:Todo priority:A tag:Home due:Soon context:Acme");
    expect(f.text).toEqual([]);
    expect(f.tokens).toEqual([
      { key: "area", value: "research" },
      { key: "status", value: "todo" },
      { key: "priority", value: "a" },
      { key: "tag", value: "home" },
      { key: "due", value: "soon" },
      { key: "context", value: "acme" },
    ]);
  });

  it("treats an unknown key:value as free text (not a token)", () => {
    expect(parseFilter("foo:bar")).toEqual({ text: ["foo:bar"], tokens: [] });
  });

  it("mixes free text and tokens", () => {
    const f = parseFilter("urgent area:garden-prep");
    expect(f.text).toEqual(["urgent"]);
    expect(f.tokens).toEqual([{ key: "area", value: "garden-prep" }]);
  });

  it('honors "double quotes" for values and phrases with spaces', () => {
    expect(parseFilter('area:"garden prep"')).toEqual({
      text: [],
      tokens: [{ key: "area", value: "garden prep" }],
    });
    expect(parseFilter('"buy milk"')).toEqual({ text: ["buy milk"], tokens: [] });
  });

  it("ignores a token with an empty value (treats as nothing usable)", () => {
    expect(parseFilter("area:")).toEqual({ text: ["area:"], tokens: [] });
  });
});

describe("matchCard", () => {
  const ctx = { today: "2026-06-16", doneColumnId: "done" as string | null };
  it("matches everything for the empty filter", () => {
    expect(matchCard(card({}), EMPTY_FILTER, ctx)).toBe(true);
  });

  it("free text matches basename, priority and tags; ANDs multiple terms", () => {
    const c = card({ priority: "high", area: "garden-prep", tags: ["remote"] }, "Apply the mulch");
    expect(matchCard(c, parseFilter("apply"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("high"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("remote"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("apply remote"), ctx)).toBe(true); // both present → AND ok
    expect(matchCard(c, parseFilter("apply nope"), ctx)).toBe(false); // one missing → AND fails
  });

  it("area/status/priority tokens are exact, case-insensitive equals", () => {
    const c = card({ area: "research", status: "todo", priority: "A" });
    expect(matchCard(c, parseFilter("area:Research"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("area:pi"), ctx)).toBe(false); // not a prefix match
    expect(matchCard(c, parseFilter("status:todo"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("priority:a"), ctx)).toBe(true);
  });

  it("tag token matches area or any of the tags", () => {
    const c = card({ area: "ops", tags: ["red", "blue"] });
    expect(matchCard(c, parseFilter("tag:ops"), ctx)).toBe(true); // area surfaces as a tag
    expect(matchCard(c, parseFilter("tag:blue"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("tag:green"), ctx)).toBe(false);
  });

  it("context token reads the card's context frontmatter (string or array)", () => {
    expect(matchCard(card({ context: "acme" }), parseFilter("context:acme"), ctx)).toBe(true);
    expect(matchCard(card({ context: ["acme", "beta"] }), parseFilter("context:beta"), ctx)).toBe(
      true,
    );
    expect(matchCard(card({ context: ["acme"] }), parseFilter("context:none"), ctx)).toBe(false);
    expect(matchCard(card({}), parseFilter("context:acme"), ctx)).toBe(false);
  });

  it("context token also matches the folder-derived card.context (#14 bridge)", () => {
    const folderCard = { ...card({}), context: "Acme" };
    expect(matchCard(folderCard, parseFilter("context:acme"), ctx)).toBe(true); // case-insensitive
    expect(matchCard(folderCard, parseFilter("context:other"), ctx)).toBe(false);
    // Frontmatter context and folder context are both honored (one notion of context).
    const both = { ...card({ context: "fm-ctx" }), context: "Acme" };
    expect(matchCard(both, parseFilter("context:fm-ctx"), ctx)).toBe(true);
    expect(matchCard(both, parseFilter("context:acme"), ctx)).toBe(true);
  });

  it("due token: overdue/today/soon buckets, none, and exact date", () => {
    const overdue = card({ due: "2026-06-10" });
    const today = card({ due: "2026-06-16" });
    const soon = card({ due: "2026-06-18" });
    const far = card({ due: "2026-08-01" });
    const noDue = card({});
    expect(matchCard(overdue, parseFilter("due:overdue"), ctx)).toBe(true);
    expect(matchCard(today, parseFilter("due:overdue"), ctx)).toBe(false);
    expect(matchCard(today, parseFilter("due:today"), ctx)).toBe(true);
    // soon is cumulative: soon-or-sooner
    expect(matchCard(overdue, parseFilter("due:soon"), ctx)).toBe(true);
    expect(matchCard(today, parseFilter("due:soon"), ctx)).toBe(true);
    expect(matchCard(soon, parseFilter("due:soon"), ctx)).toBe(true);
    expect(matchCard(far, parseFilter("due:soon"), ctx)).toBe(false);
    expect(matchCard(noDue, parseFilter("due:soon"), ctx)).toBe(false);
    // none = no due date
    expect(matchCard(noDue, parseFilter("due:none"), ctx)).toBe(true);
    expect(matchCard(overdue, parseFilter("due:none"), ctx)).toBe(false);
    // exact date
    expect(matchCard(overdue, parseFilter("due:2026-06-10"), ctx)).toBe(true);
    expect(matchCard(overdue, parseFilter("due:2026-06-11"), ctx)).toBe(false);
  });

  it("a done card is never overdue (delegates to dueInfo with the resolved done column)", () => {
    const finished = card({ due: "2026-06-10", status: "completed" });
    expect(
      matchCard(finished, parseFilter("due:overdue"), {
        today: "2026-06-16",
        doneColumnId: "completed",
      }),
    ).toBe(false);
    expect(
      matchCard(finished, parseFilter("due:overdue"), {
        today: "2026-06-16",
        doneColumnId: "done",
      }),
    ).toBe(true);
  });

  it("ANDs tokens with free text", () => {
    const c = card({ area: "research", status: "todo" }, "Fix the bug");
    expect(matchCard(c, parseFilter("fix area:research status:todo"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("fix area:research status:doing"), ctx)).toBe(false);
  });

  it("matchQuery parses + matches in one call", () => {
    expect(matchQuery(card({ area: "research" }), "area:research", ctx)).toBe(true);
  });
});

describe("groupAndSortCards (#6 in-column grouping + sort)", () => {
  const today = "2026-06-16";
  const done = "done";
  const names = (g: { cards: Card[] }) => g.cards.map((c) => c.basename);

  it("defaults (none/manual) reproduce the flat input order in one unlabeled group", () => {
    const cards = [card({}, "A"), card({}, "B"), card({}, "C")];
    const out = groupAndSortCards(cards, "none", "manual", today, done);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "", label: "" });
    expect(names(out[0])).toEqual(["A", "B", "C"]);
  });

  it("sort: priority orders strongest-first and is stable for ties", () => {
    const cards = [
      card({ priority: "low" }, "Low1"),
      card({ priority: "urgent" }, "Urg"),
      card({}, "None"),
      card({ priority: "low" }, "Low2"),
      card({ priority: "medium" }, "Med"),
    ];
    const out = groupAndSortCards(cards, "none", "priority", today, done);
    expect(names(out[0])).toEqual(["Urg", "Med", "Low1", "Low2", "None"]);
  });

  it("sort: due orders most-pressing-first; no-due cards rank as future", () => {
    const cards = [
      card({ due: "2026-06-20" }, "Future"),
      card({ due: "2026-06-10" }, "Overdue"),
      card({}, "NoDue"),
      card({ due: "2026-06-16" }, "Today"),
    ];
    const out = groupAndSortCards(cards, "none", "due", today, done);
    // overdue > today > future; NoDue ties with Future (both rank "future") and keeps board order.
    expect(names(out[0])).toEqual(["Overdue", "Today", "Future", "NoDue"]);
  });

  it("group: due buckets cards in a fixed scannable order, omitting empty buckets", () => {
    const cards = [
      card({ due: "2026-06-20" }, "Later1"),
      card({ due: "2026-06-10" }, "Over1"),
      card({}, "NoDue1"),
      card({ due: "2026-06-16" }, "Today1"),
    ];
    const out = groupAndSortCards(cards, "due", "manual", today, done);
    expect(out.map((g) => g.key)).toEqual(["overdue", "today", "future", "none"]);
    expect(out.map((g) => g.label)).toEqual(["Overdue", "Today", "Later", "No due date"]);
    expect(names(out[0])).toEqual(["Over1"]);
    expect(names(out[3])).toEqual(["NoDue1"]);
  });

  it("group + sort combine: each bucket is independently sorted", () => {
    const cards = [
      card({ due: "2026-06-10", priority: "low" }, "OverLow"),
      card({ due: "2026-06-10", priority: "urgent" }, "OverUrg"),
    ];
    const out = groupAndSortCards(cards, "due", "priority", today, done);
    expect(out).toHaveLength(1);
    expect(names(out[0])).toEqual(["OverUrg", "OverLow"]);
  });

  it("a done card never lands in the overdue bucket (delegates to dueInfo)", () => {
    const cards = [card({ due: "2026-06-10", status: "done" }, "Finished")];
    const out = groupAndSortCards(cards, "due", "manual", today, done);
    expect(out.map((g) => g.key)).toEqual(["done"]);
  });
});

describe("cardUrgency (#3 card-level cue)", () => {
  const today = "2026-06-16";
  it("returns the urgency bucket for overdue / today / soon", () => {
    expect(cardUrgency(card({ due: "2026-06-10" }), today, "done")).toBe("overdue");
    expect(cardUrgency(card({ due: "2026-06-16" }), today, "done")).toBe("today");
    expect(cardUrgency(card({ due: "2026-06-18" }), today, "done")).toBe("soon"); // in 2d
  });
  it("returns null for far-future, no due date, and unparseable dates", () => {
    expect(cardUrgency(card({ due: "2026-07-30" }), today, "done")).toBeNull(); // > 7d out
    expect(cardUrgency(card({}), today, "done")).toBeNull();
    expect(cardUrgency(card({ due: "" }), today, "done")).toBeNull();
  });
  it("never cues a done card (mirrors the chip / due filter via dueInfo)", () => {
    const finished = card({ due: "2026-06-10", status: "completed" });
    expect(cardUrgency(finished, today, "completed")).toBeNull(); // resolved done column → no cue
    expect(cardUrgency(finished, today, "done")).toBe("overdue"); // not the done column → overdue
  });
});

describe("toggleToken / hasToken (search-as-single-source chips)", () => {
  it("hasToken detects a present token case-insensitively", () => {
    expect(hasToken("due:overdue", "due", "overdue")).toBe(true);
    expect(hasToken("DUE:OVERDUE", "due", "overdue")).toBe(true);
    expect(hasToken("area:garden-prep due:soon", "due", "soon")).toBe(true);
    expect(hasToken("area:garden-prep", "due", "soon")).toBe(false);
    // a substring is not a token match
    expect(hasToken("urgent", "due", "overdue")).toBe(false);
  });

  it("appends the token when absent, onto an empty or non-empty query", () => {
    expect(toggleToken("", "due", "overdue")).toBe("due:overdue");
    expect(toggleToken("area:garden-prep", "due", "soon")).toBe("area:garden-prep due:soon");
    expect(toggleToken("buy milk", "due", "overdue")).toBe("buy milk due:overdue");
  });

  it("removes the token when present, leaving the rest intact (no double spaces)", () => {
    expect(toggleToken("due:overdue", "due", "overdue")).toBe("");
    expect(toggleToken("area:garden-prep due:soon", "due", "soon")).toBe("area:garden-prep");
    expect(toggleToken("due:soon area:garden-prep", "due", "soon")).toBe("area:garden-prep");
    expect(toggleToken("a due:overdue b", "due", "overdue")).toBe("a b");
  });

  it("does not clip inside another term that merely contains the value", () => {
    // "overdueish" is a free-text term, not the due:overdue token — toggling appends, not edits.
    expect(toggleToken("overdueish", "due", "overdue")).toBe("overdueish due:overdue");
  });

  it("round-trips: toggle on then off returns to the original trimmed query", () => {
    const q = "area:garden-prep urgent";
    const on = toggleToken(q, "due", "overdue");
    expect(hasToken(on, "due", "overdue")).toBe(true);
    expect(toggleToken(on, "due", "overdue")).toBe(q);
  });
});

describe("dates", () => {
  it("formats date-only and timestamp", () => {
    const d = new Date(2026, 5, 16, 9, 5); // local June 16 2026 09:05
    expect(dateOnly(d)).toBe("2026-06-16");
    expect(stamp(d)).toBe("2026-06-16 09:05");
  });
});
