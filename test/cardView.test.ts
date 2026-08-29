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
  boardPriorities,
  priorityOptions,
  assigneeValues,
  boardAssignees,
  sameAssignee,
  cardChips,
} from "../src/ui/cardView";
import { dateOnly, stamp } from "../src/model/dates";
import { BLOCKS } from "../src/model/relationships";
import type { Card } from "../src/model/types";

function card(fm: Card["frontmatter"], basename = "Card"): Card {
  return {
    path: `Tasks/${basename}.md`,
    basename,
    title: basename,
    titleSource: "filename",
    frontmatter: fm,
    childLinks: [],
  };
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
  it("falls back to muted for unknown values with no vocabulary to rank them by", () => {
    expect(priorityTone("someday")).toBe("muted");
    expect(priorityTone("")).toBe("muted");
    // One value is a scale of one: nothing to rank it against, so no ramp.
    expect(priorityTone("someday", ["someday"])).toBe("muted");
    // Still muted when the board's scale does not hold the value at all.
    expect(priorityTone("someday", ["blocker", "whenever"])).toBe("muted");
  });
  it("ranks a board's own scale across the four tones, ends pinned", () => {
    const ramp = (scale: string[]) => scale.map((v) => priorityTone(v, scale));
    expect(ramp(["blocker", "whenever"])).toEqual(["prio-1", "prio-4"]);
    expect(ramp(["blocker", "meh", "whenever"])).toEqual(["prio-1", "prio-2", "prio-4"]);
    expect(ramp(["s1", "s2", "s3", "s4"])).toEqual(["prio-1", "prio-2", "prio-3", "prio-4"]);
    expect(ramp(["s1", "s2", "s3", "s4", "s5"])).toEqual([
      "prio-1",
      "prio-2",
      "prio-2",
      "prio-3",
      "prio-4",
    ]);
    expect(ramp(["s1", "s2", "s3", "s4", "s5", "s6"])).toEqual([
      "prio-1",
      "prio-2",
      "prio-2",
      "prio-3",
      "prio-3",
      "prio-4",
    ]);
  });
  it("ranks only what the board note lists, so a card-only value stays neutral", () => {
    // The wider vocabulary appends card values alphabetically, an order nobody chose. Colouring by
    // it would invent a ranking, so a value the note has not learned yet gets no ramp position.
    expect(priorityTone("blocker", [])).toBe("muted");
    expect(priorityTone("blocker", ["someday", "whenever"])).toBe("muted");
  });
  it("re-spreads the ramp when the scale grows, and shares tones past four values", () => {
    const three = ["s1", "s2", "s3"];
    expect(priorityTone("s3", three)).toBe("prio-4");
    // A fourth word moves the third one: the ramp is a function of the whole list's length.
    expect(priorityTone("s3", [...three, "s4"])).toBe("prio-3");
    // Seven values into four tones: neighbours share, ends stay pinned, the sort still separates.
    const seven = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
    expect(seven.map((v) => priorityTone(v, seven))).toEqual([
      "prio-1",
      "prio-1",
      "prio-2",
      "prio-2",
      "prio-3",
      "prio-3",
      "prio-4",
    ]);
  });
  it("lets the fixed scales win over the board's order, so a known scale never repaints", () => {
    // `C` keeps its yellow even though this board lists it last, and `normal` keeps its orange
    // between two invented neighbours.
    expect(priorityTone("C", ["blocker", "C"])).toBe("prio-3");
    expect(priorityTone("normal", ["blocker", "normal", "whenever"])).toBe("prio-2");
    expect(priorityTone("blocker", ["blocker", "normal", "whenever"])).toBe("prio-1");
  });
  it("matches the vocabulary case-insensitively, like everything else about priorities", () => {
    expect(priorityTone("BLOCKER", ["blocker", "whenever"])).toBe("prio-1");
  });
  it("ranks the showcase's `someday` under the A-D ramp it sits beside", () => {
    expect(priorityTone("someday", ["A", "B", "C", "D", "someday"])).toBe("prio-4");
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

  it("free text matches the displayed title as well as the file name", () => {
    const c = {
      ...card({}, "01-fix-export"),
      title: "Fix the export path",
      titleSource: "heading" as const,
    };
    expect(matchCard(c, parseFilter("export path"), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("01-fix"), ctx)).toBe(true);
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

describe("assignment (20260827.03)", () => {
  const ctx = { today: "2026-06-16", doneColumnId: "done" as string | null };

  it("reads one name written as a string and several written as a list", () => {
    expect(assigneeValues(card({ assignee: "Rafa" }))).toEqual(["Rafa"]);
    expect(assigneeValues(card({ assignee: ["Rafa", "Alex"] }))).toEqual(["Rafa", "Alex"]);
    // Blanks, non-strings and a missing key are all "nobody", never a name made of spaces.
    expect(assigneeValues(card({ assignee: "  " }))).toEqual([]);
    expect(assigneeValues(card({ assignee: ["Rafa", 7, ""] }))).toEqual(["Rafa"]);
    expect(assigneeValues(card({}))).toEqual([]);
    // Surrounding space is noise; the spelling itself is kept as the note wrote it.
    expect(assigneeValues(card({ assignee: "  Rafa Stavarengo " }))).toEqual(["Rafa Stavarengo"]);
  });

  it("treats case, space and a leading @ as the same person, and nothing further", () => {
    expect(sameAssignee("Rafa", "rafa")).toBe(true);
    expect(sameAssignee("@rafa", " Rafa ")).toBe(true);
    expect(sameAssignee("Alex", "Alex Smith")).toBe(false);
    expect(sameAssignee("", "")).toBe(false);
    expect(sameAssignee("  ", "rafa")).toBe(false);
  });

  it("collects the board's people from its cards, one spelling each, alphabetically", () => {
    const cards = [
      card({ assignee: "Zoe" }, "A"),
      card({ assignee: "rafa" }, "B"),
      card({ assignee: ["Rafa", "@alex"] }, "C"),
      card({}, "D"),
    ];
    expect(boardAssignees(cards)).toEqual(["@alex", "rafa", "Zoe"]);
  });

  it("filters by name, by nobody, and by whoever the reader is", () => {
    const rafa = card({ assignee: "Rafa" }, "Mine");
    const alex = card({ assignee: ["Alex", "Rafa"] }, "Shared");
    const nobody = card({}, "Loose");
    const mine = { ...ctx, me: "rafa" };

    expect(matchCard(rafa, parseFilter("assignee:rafa"), ctx)).toBe(true);
    expect(matchCard(rafa, parseFilter("assignee:RAFA"), ctx)).toBe(true);
    expect(matchCard(alex, parseFilter("assignee:rafa"), ctx)).toBe(true); // one of several
    expect(matchCard(nobody, parseFilter("assignee:rafa"), ctx)).toBe(false);

    expect(matchCard(nobody, parseFilter("assignee:none"), ctx)).toBe(true);
    expect(matchCard(rafa, parseFilter("assignee:none"), ctx)).toBe(false);

    expect(matchCard(rafa, parseFilter("assignee:me"), mine)).toBe(true);
    expect(matchCard(alex, parseFilter("assignee:me"), mine)).toBe(true);
    expect(matchCard(nobody, parseFilter("assignee:me"), mine)).toBe(false);
  });

  it("matches no card for `assignee:me` when nobody has said who they are", () => {
    const rafa = card({ assignee: "Rafa" });
    expect(matchCard(rafa, parseFilter("assignee:me"), ctx)).toBe(false);
    expect(matchCard(rafa, parseFilter("assignee:me"), { ...ctx, me: "   " })).toBe(false);
  });

  it("keeps a name spelled with spaces addressable through quotes", () => {
    const c = card({ assignee: "Rafa Stavarengo" });
    expect(matchCard(c, parseFilter('assignee:"rafa stavarengo"'), ctx)).toBe(true);
    expect(matchCard(c, parseFilter("assignee:rafa"), ctx)).toBe(false);
  });

  it("finds a card by its assignee's name typed as plain search text", () => {
    const c = card({ assignee: "Rafa" }, "Apply the mulch");
    expect(matchCard(c, parseFilter("rafa"), ctx)).toBe(true);
  });

  it("shows every assigned name on the tile, one chip each", () => {
    const chips = cardChips(card({ assignee: ["Rafa", "Alex"] }), "2026-06-16", "done");
    expect(chips.map((c) => [c.label, c.icon, c.tone])).toEqual([
      ["Rafa", "user", "muted"],
      ["Alex", "user", "muted"],
    ]);
    expect(chips[0]?.title).toBe("Assigned to Rafa");
    expect(cardChips(card({}), "2026-06-16", "done")).toEqual([]);
  });
});

describe("boardPriorities (the board's own vocabulary)", () => {
  it("comes back empty for a board that has never seen a priority (no invented values)", () => {
    expect(boardPriorities([], [])).toEqual([]);
    expect(boardPriorities([], [card({ priority: "a" })])).toEqual(["a"]);
  });

  it("learns the values the cards use, ordered by severity tone then alphabetically", () => {
    const cards = [
      card({ priority: "low" }, "1"),
      card({ priority: "urgent" }, "2"),
      card({ priority: "medium" }, "3"),
      card({ priority: "high" }, "4"),
    ];
    // `high` and `urgent` share the strongest tone, so the alphabetical tie-break separates them.
    expect(boardPriorities([], cards)).toEqual(["high", "urgent", "medium", "low"]);
  });

  it("keeps the remembered order first and appends only what is genuinely new", () => {
    const cards = [card({ priority: "c" }, "1"), card({ priority: "zzz" }, "2")];
    expect(boardPriorities(["c", "b", "a"], cards)).toEqual(["c", "b", "a", "zzz"]);
  });

  it("treats a value as one value regardless of case, keeping the first spelling", () => {
    expect(boardPriorities(["A"], [card({ priority: "a" }), card({ priority: "B" })])).toEqual([
      "A",
      "B",
    ]);
  });

  it("ignores blank and whitespace-only priorities", () => {
    expect(boardPriorities([], [card({ priority: "" }), card({ priority: "   " })])).toEqual([]);
  });
});

describe("priorityOptions", () => {
  it("offers the vocabulary as-is when it already holds the current value", () => {
    expect(priorityOptions(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(priorityOptions(["a", "b"], "")).toEqual(["a", "b"]);
  });

  it("prepends a current value the vocabulary does not hold, so the control never lies", () => {
    expect(priorityOptions(["a", "b"], "zzz")).toEqual(["zzz", "a", "b"]);
  });
});

describe("groupAndSortCards (#6 in-column grouping + sort)", () => {
  const today = "2026-06-16";
  const done = "done";
  const names = (g: { cards: Card[] }) => g.cards.map((c) => c.basename);

  it("defaults (none/manual) reproduce the flat input order in one unlabeled group", () => {
    const cards = [card({}, "A"), card({}, "B"), card({}, "C")];
    const out = groupAndSortCards(cards, {
      group: "none",
      sort: "manual",
      today,
      doneColumnId: done,
    });
    expect(out).toHaveLength(1);
    if (!out[0]) throw new Error("expected group at index 0");
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
    const out = groupAndSortCards(cards, {
      group: "none",
      sort: "priority",
      today,
      doneColumnId: done,
    });
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["Urg", "Med", "Low1", "Low2", "None"]);
  });

  it("sort: priority breaks a severity tie by the board's own vocabulary order", () => {
    // No `scale`, so all three words are unknown and share the `muted` tone — what a board whose
    // note has not learned them looks like. They used to collapse into one tie that fell back to
    // board order; the vocabulary now decides between them.
    const cards = [
      card({ priority: "whenever" }, "W"),
      card({ priority: "blocker" }, "B"),
      card({ priority: "someday" }, "N"),
    ];
    const out = groupAndSortCards(cards, {
      group: "none",
      sort: "priority",
      today,
      doneColumnId: done,
      priorities: ["blocker", "someday", "whenever"],
    });
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["B", "N", "W"]);
  });

  it("sort: priority follows the scale the board note holds, not the tone words start with", () => {
    // The wiring the board actually uses: `scale` is the note's list, so these words carry real
    // tones and lead the sort. Without it `blocker` and `whenever` would be `muted` and the known
    // `normal` would sort ABOVE both — which is exactly what this asserts is not happening.
    const cards = [
      card({ priority: "normal" }, "N"),
      card({ priority: "whenever" }, "W"),
      card({ priority: "blocker" }, "B"),
    ];
    const scale = ["blocker", "normal", "whenever"];
    const out = groupAndSortCards(cards, {
      group: "none",
      sort: "priority",
      today,
      doneColumnId: done,
      priorities: scale,
      scale,
    });
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["B", "N", "W"]);
  });

  it("sort: priority leaves a card-only value below everything the note ranks", () => {
    // `invented` is not on the note's list, so it has no tone — it sorts under the ranked words,
    // and still above a card with no priority at all.
    const cards = [
      card({ priority: "invented" }, "I"),
      card({}, "None"),
      card({ priority: "whenever" }, "W"),
    ];
    const scale = ["blocker", "normal", "whenever"];
    const out = groupAndSortCards(cards, {
      group: "none",
      sort: "priority",
      today,
      doneColumnId: done,
      priorities: [...scale, "invented"],
      scale,
    });
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["W", "I", "None"]);
  });

  it("sort: priority keeps severity above the vocabulary order", () => {
    // `urgent` sits last in the vocabulary but is a stronger tone than `C`, so it still leads —
    // a board that sorted correctly before this vocabulary existed still does.
    const cards = [card({ priority: "C" }, "C"), card({ priority: "urgent" }, "U")];
    const out = groupAndSortCards(cards, {
      group: "none",
      sort: "priority",
      today,
      doneColumnId: done,
      priorities: ["A", "B", "C", "urgent"],
    });
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["U", "C"]);
  });

  it("sort: priority ranks a weak-but-real priority above no priority at all", () => {
    const cards = [card({}, "None"), card({ priority: "someday" }, "Someday")];
    const out = groupAndSortCards(cards, {
      group: "none",
      sort: "priority",
      today,
      doneColumnId: done,
      priorities: ["A", "someday"],
    });
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["Someday", "None"]);
  });

  it("sort: due orders most-pressing-first; no-due cards rank as future", () => {
    const cards = [
      card({ due: "2026-06-20" }, "Future"),
      card({ due: "2026-06-10" }, "Overdue"),
      card({}, "NoDue"),
      card({ due: "2026-06-16" }, "Today"),
    ];
    const out = groupAndSortCards(cards, { group: "none", sort: "due", today, doneColumnId: done });
    // overdue > today > future; NoDue ties with Future (both rank "future") and keeps board order.
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["Overdue", "Today", "Future", "NoDue"]);
  });

  it("group: due buckets cards in a fixed scannable order, omitting empty buckets", () => {
    const cards = [
      card({ due: "2026-06-20" }, "Later1"),
      card({ due: "2026-06-10" }, "Over1"),
      card({}, "NoDue1"),
      card({ due: "2026-06-16" }, "Today1"),
    ];
    const out = groupAndSortCards(cards, {
      group: "due",
      sort: "manual",
      today,
      doneColumnId: done,
    });
    expect(out.map((g) => g.key)).toEqual(["overdue", "today", "future", "none"]);
    expect(out.map((g) => g.label)).toEqual(["Overdue", "Today", "Later", "No due date"]);
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["Over1"]);
    if (!out[3]) throw new Error("expected group at index 3");
    expect(names(out[3])).toEqual(["NoDue1"]);
  });

  it("group + sort combine: each bucket is independently sorted", () => {
    const cards = [
      card({ due: "2026-06-10", priority: "low" }, "OverLow"),
      card({ due: "2026-06-10", priority: "urgent" }, "OverUrg"),
    ];
    const out = groupAndSortCards(cards, {
      group: "due",
      sort: "priority",
      today,
      doneColumnId: done,
    });
    expect(out).toHaveLength(1);
    if (!out[0]) throw new Error("expected group at index 0");
    expect(names(out[0])).toEqual(["OverUrg", "OverLow"]);
  });

  it("a done card never lands in the overdue bucket (delegates to dueInfo)", () => {
    const cards = [card({ due: "2026-06-10", status: "done" }, "Finished")];
    const out = groupAndSortCards(cards, {
      group: "due",
      sort: "manual",
      today,
      doneColumnId: done,
    });
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

describe("is: and unread: tokens (state beyond the card's own note)", () => {
  const today = "2026-06-16";
  const blocked = card({}, "Waiting");
  const blocker = card({}, "Blocker");
  const loose = card({}, "Loose");
  const relations = {
    "Tasks/Waiting.md": [{ type: BLOCKS, out: 0, in: 1 }],
    "Tasks/Blocker.md": [{ type: BLOCKS, out: 1, in: 0 }],
  };
  const ctx = { today, doneColumnId: "done", relations };

  it("is:blocked / is:blocking read the same active counts the tile markers show", () => {
    expect(matchQuery(blocked, "is:blocked", ctx)).toBe(true);
    expect(matchQuery(blocker, "is:blocked", ctx)).toBe(false);
    expect(matchQuery(blocker, "is:blocking", ctx)).toBe(true);
    expect(matchQuery(loose, "is:blocking", ctx)).toBe(false);
  });

  it("is:unblocked is the question the marker makes people ask, since the grammar has no negation", () => {
    expect(matchQuery(loose, "is:unblocked", ctx)).toBe(true);
    expect(matchQuery(blocker, "is:unblocked", ctx)).toBe(true);
    expect(matchQuery(blocked, "is:unblocked", ctx)).toBe(false);
  });

  it("only blocking answers is:, whatever other types the counts hold", () => {
    const resultOf = { key: "a-result-of", inverse: null, label: "A result of", inverseLabel: "" };
    const linked = { "Tasks/Loose.md": [{ type: resultOf, out: 1, in: 1 }] };
    expect(matchQuery(loose, "is:blocked", { today, doneColumnId: null, relations: linked })).toBe(
      false,
    );
    expect(matchQuery(loose, "is:blocking", { today, doneColumnId: null, relations: linked })).toBe(
      false,
    );
  });

  it("with no counts in the context nothing is blocked, and an unknown value matches nothing", () => {
    const bare = { today, doneColumnId: null };
    expect(matchQuery(blocked, "is:blocked", bare)).toBe(false);
    expect(matchQuery(blocked, "is:unblocked", bare)).toBe(true);
    expect(matchQuery(blocked, "is:whatever", ctx)).toBe(false);
  });

  it("unread: reads the reader's verdict handed in through the context", () => {
    const verdict = (kind: "none" | "unread" | "reply") => ({
      today,
      doneColumnId: null,
      unread: () => ({ kind, indices: kind === "none" ? [] : [0], replyIndex: null }),
    });
    expect(matchQuery(loose, "unread:comments", verdict("unread"))).toBe(true);
    expect(matchQuery(loose, "unread:comments", verdict("reply"))).toBe(true);
    expect(matchQuery(loose, "unread:comments", verdict("none"))).toBe(false);
    expect(matchQuery(loose, "unread:replies", verdict("reply"))).toBe(true);
    expect(matchQuery(loose, "unread:replies", verdict("unread"))).toBe(false);
    expect(matchQuery(loose, "unread:none", verdict("none"))).toBe(true);
    expect(matchQuery(loose, "unread:none", verdict("unread"))).toBe(false);
    expect(matchQuery(loose, "unread:whatever", verdict("unread"))).toBe(false);
  });

  it("with no reader in the context nothing is unread", () => {
    const bare = { today, doneColumnId: null };
    expect(matchQuery(loose, "unread:comments", bare)).toBe(false);
    expect(matchQuery(loose, "unread:none", bare)).toBe(true);
  });

  it("parses both as tokens, and the chips toggle them like any other", () => {
    expect(parseFilter("is:blocked unread:replies").tokens).toEqual([
      { key: "is", value: "blocked" },
      { key: "unread", value: "replies" },
    ]);
    expect(toggleToken("", "unread", "comments")).toBe("unread:comments");
    expect(hasToken("is:Blocked", "is", "blocked")).toBe(true);
  });
});
