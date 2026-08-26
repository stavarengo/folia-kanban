import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseFrontmatter,
  parseBody,
  parseSubtasks,
  splitFrontmatter,
  appendComment,
  appendHistory,
  addTodo,
  addSubcard,
  pendingSubcardLinks,
  setSubcardDone,
  setSubtaskDone,
  setSubtaskStatus,
  removeSubtask,
  setDescription,
  descriptionRefusal,
  cardStats,
  updateTimestampedLine,
  removeTimestampedLine,
  SECTION,
} from "../src/model/card";
import { historyAllows } from "../src/model/history";

const SAMPLE_CARD = `---
type: task
status: doing
area: docs
priority: B
projects:
  - docs
context:
  - computer
created: 2026-01-15
---

# Write the getting-started guide

Cover installation and creating a first board.
`;

describe("frontmatter", () => {
  it("parses scalar, list and date fields", () => {
    const fm = parseFrontmatter(SAMPLE_CARD);
    expect(fm["status"]).toBe("doing");
    expect(fm["priority"]).toBe("B");
    expect(fm["projects"]).toEqual(["docs"]);
  });

  it("returns {} when there is no frontmatter", () => {
    expect(parseFrontmatter("# Just a title\n")).toEqual({});
  });
});

describe("parseBody", () => {
  it("extracts title and description, empty sections", () => {
    const b = parseBody(SAMPLE_CARD);
    expect(b.title).toBe("Write the getting-started guide");
    expect(b.description).toBe("Cover installation and creating a first board.");
    expect(b.subtasks).toEqual([]);
    expect(b.comments).toEqual([]);
    expect(b.history).toEqual([]);
  });
});

describe("byte-stability — frontmatter is never rewritten", () => {
  const ops: Array<[string, (t: string) => string]> = [
    ["appendComment", (t) => appendComment(t, "hello", "2026-06-13 10:00")],
    ["appendHistory", (t) => appendHistory(t, "Created", "2026-06-13 10:00")],
    ["addTodo", (t) => addTodo(t, "buy milk")],
    ["addSubcard", (t) => addSubcard(t, "Child Card")],
    ["setDescription", (t) => setDescription(t, "new desc")],
  ];
  for (const [name, op] of ops) {
    it(`${name} leaves the frontmatter block byte-identical`, () => {
      const before = splitFrontmatter(SAMPLE_CARD).fmText;
      const after = splitFrontmatter(op(SAMPLE_CARD)).fmText;
      expect(after).toBe(before);
    });
  }
});

describe("append operations only add at the end (input body is a prefix)", () => {
  it("appendComment creates a Comments section without touching prior bytes", () => {
    const out = appendComment(SAMPLE_CARD, "first note", "2026-06-13 10:00");
    expect(out.startsWith(SAMPLE_CARD)).toBe(true);
    expect(out).toContain("## Comments\n- _2026-06-13 10:00:_ first note");
    expect(parseBody(out).comments).toEqual([
      { timestamp: "2026-06-13 10:00", author: null, text: "first note" },
    ]);
  });

  it("a second comment appends under the same heading", () => {
    let out = appendComment(SAMPLE_CARD, "first", "2026-06-13 10:00");
    out = appendComment(out, "second", "2026-06-13 11:00");
    const comments = parseBody(out).comments;
    expect(comments.map((c) => c.text)).toEqual(["first", "second"]);
    expect(out.match(/## Comments/g)).toHaveLength(1);
  });
});

describe("subtasks: todos vs subcards", () => {
  it("addTodo and addSubcard produce a mixed checklist", () => {
    let out = addTodo(SAMPLE_CARD, "warm up");
    out = addSubcard(out, "Leg day plan");
    const subs = parseSubtasks(out);
    expect(subs).toHaveLength(2);
    expect(subs[0]).toMatchObject({ kind: "todo", text: "warm up", done: false, index: 0 });
    expect(subs[1]).toMatchObject({ kind: "card", link: "Leg day plan", done: false, index: 1 });
  });

  it("parses a subcard link with alias/heading down to the target", () => {
    const t = addSubcard(SAMPLE_CARD, "Big Plan");
    const withAlias = t.replace("[[Big Plan]]", "[[Big Plan#Section|Alias]]");
    expect(parseSubtasks(withAlias)[0]).toMatchObject({ kind: "card", link: "Big Plan" });
  });

  it("toggles the correct subtask by index", () => {
    let out = addTodo(SAMPLE_CARD, "one");
    out = addTodo(out, "two");
    out = setSubtaskDone(out, 1, true);
    const subs = parseSubtasks(out);
    if (!subs[0] || !subs[1]) throw new Error("expected 2 subtasks");
    expect(subs[0].done).toBe(false);
    expect(subs[1].done).toBe(true);
    // toggling back
    out = setSubtaskDone(out, 1, false);
    const subsAfter = parseSubtasks(out);
    if (!subsAfter[1]) throw new Error("expected subtask at index 1");
    expect(subsAfter[1].done).toBe(false);
  });

  it("removes the correct subtask by index", () => {
    let out = addTodo(SAMPLE_CARD, "one");
    out = addTodo(out, "two");
    out = addTodo(out, "three");
    out = removeSubtask(out, 1);
    expect(parseSubtasks(out).map((s) => s.text)).toEqual(["one", "three"]);
  });
});

describe("setDescription", () => {
  it("replaces description, preserves title and later sections", () => {
    let t = appendComment(SAMPLE_CARD, "keep me", "2026-06-13 10:00");
    t = setDescription(t, "A brand new description.");
    const b = parseBody(t);
    expect(b.title).toBe("Write the getting-started guide");
    expect(b.description).toBe("A brand new description.");
    expect(b.comments).toEqual([{ timestamp: "2026-06-13 10:00", author: null, text: "keep me" }]);
    expect(splitFrontmatter(t).fmText).toBe(splitFrontmatter(SAMPLE_CARD).fmText);
  });
});

describe("cardStats — progress counts EVERY checklist line by its checkbox", () => {
  // 13 plain todos (3 done) + 1 done subcard-link → 4/14 (the live NAS bug).
  const NAS = [
    "---",
    "status: doing",
    "---",
    "",
    "# NAS",
    "",
    "## Subtasks",
    ...Array.from({ length: 13 }, (_, i) => `- [${i < 3 ? "x" : " "}] todo ${i + 1}`),
    "- [x] [[adf]]",
    "",
  ].join("\n");

  it("counts plain todos AND subcard-links by line (NAS → 4/14)", () => {
    const s = cardStats(NAS);
    expect(s.checklist).toBe(14);
    expect(s.checklistDone).toBe(4);
    expect(s.subcards).toBe(1); // git-branch count is kept separate
  });

  it("duplicate-titled lines each count once by their own line", () => {
    const text = "# C\n\n## Subtasks\n- [ ] Foo\n- [x] [[Foo]]\n";
    const s = cardStats(text);
    expect(s.checklist).toBe(2);
    expect(s.checklistDone).toBe(1); // only the subcard line is done — not collapsed by title
    expect(s.subcards).toBe(1);
  });

  it("toggling the subcard line moves checklistDone", () => {
    const text = "# C\n\n## Subtasks\n- [ ] plain\n- [ ] [[Child]]\n";
    expect(cardStats(text).checklistDone).toBe(0);
    const toggled = setSubtaskDone(text, 1, true); // the subcard-link line
    expect(cardStats(toggled).checklistDone).toBe(1);
    expect(cardStats(toggled).checklist).toBe(2);
  });
});

describe("setSubcardDone — a subcard line is found by its link, never by a position", () => {
  const doc = [
    "---",
    "status: todo",
    "---",
    "# P",
    "",
    "## Subtasks",
    "- [x] Freeze",
    "- [ ] Cut [status:: doing]",
    "- [ ] [[Child]]",
    "- [ ] [[Other|alias]]",
    "",
    "## Comments",
    "- [ ] [[Child]] is mentioned here, but this is not the checklist",
    "",
  ].join("\n");

  it("ticks only the line that links the child, wherever it sits among plain todos", () => {
    expect(setSubcardDone(doc, ["Child"], true)).toBe(
      doc.replace("- [ ] [[Child]]", "- [x] [[Child]]"),
    );
    expect(setSubcardDone(doc, ["Other"], true)).toBe(
      doc.replace("- [ ] [[Other|alias]]", "- [x] [[Other|alias]]"),
    );
  });

  it("unticks, and returns the text byte-identical when no line links the child", () => {
    const ticked = doc.replace("- [ ] [[Child]]", "- [x] [[Child]]");
    expect(setSubcardDone(ticked, ["Child"], false)).toBe(doc);
    expect(setSubcardDone(doc, ["Nobody"], true)).toBe(doc);
    expect(setSubcardDone(doc, ["Child"], false)).toBe(doc); // already says so
  });

  it("never touches a plain todo whose text is the child's name, nor a line outside Subtasks", () => {
    const tricky = doc.replace("- [x] Freeze", "- [ ] Child");
    expect(setSubcardDone(tricky, ["Child"], true)).toBe(
      tricky.replace("- [ ] [[Child]]", "- [x] [[Child]]"),
    );
  });

  it("reports each link that still needs the write once, so a writer can skip the rest", () => {
    // The line's own text rides along, so a history line can name it as written.
    expect(pendingSubcardLinks(doc, ["Child", "Other", "Nobody"], true)).toEqual([
      { link: "Child", text: "[[Child]]" },
      { link: "Other", text: "[[Other|alias]]" },
    ]);
    expect(pendingSubcardLinks(doc, ["Child"], false)).toEqual([]); // already unticked
    const twice = doc.replace("- [ ] [[Other|alias]]", "- [ ] [[Child]]");
    expect(pendingSubcardLinks(twice, ["Child", "Child"], true)).toEqual([
      { link: "Child", text: "[[Child]]" },
    ]);
    expect(setSubcardDone(twice, ["Child"], true)).toBe(
      doc
        .replace("- [ ] [[Child]]", "- [x] [[Child]]")
        .replace("- [ ] [[Other|alias]]", "- [x] [[Child]]"),
    );
  });

  it("changes one character: the author's spacing around the box is not the plugin's to tidy", () => {
    const spaced = doc.replace("- [ ] [[Child]]", "  *   [ ]   [[Child]]   ");
    expect(setSubcardDone(spaced, ["Child"], true)).toBe(
      spaced.replace("  *   [ ]   [[Child]]   ", "  *   [x]   [[Child]]   "),
    );
    expect(setSubtaskDone(spaced, 2, true)).toBe(setSubcardDone(spaced, ["Child"], true));
  });
});

describe("nextTodos — the outstanding plain todos, in order", () => {
  it("excludes done todos and subcard-links, carrying each todo's checklist index", () => {
    const text = [
      "# C",
      "",
      "## Subtasks",
      "- [ ] alpha", // index 0
      "- [x] beta", // index 1, done → excluded
      "- [ ] [[Child]]", // index 2, subcard-link → excluded
      "- [ ] gamma", // index 3
      "",
    ].join("\n");
    // `index` is the SubItem.index (0-based among ALL checklist lines), NOT the filtered position —
    // so gamma keeps index 3 even though it's the 2nd surviving todo (the handle D2 toggles).
    expect(cardStats(text).nextTodos).toEqual([
      { text: "alpha", index: 0 },
      { text: "gamma", index: 3 },
    ]);
  });

  it("caps nothing — the board still has placed todos to drop, and the tile takes the first N", () => {
    // A cap here would be applied BEFORE `buildBoard` removes the todos standing in a column of
    // their own, so a card whose first few todos are placed could end up showing no next action at
    // all while others are still waiting on it.
    const text =
      "# C\n\n## Subtasks\n" + Array.from({ length: 8 }, (_, i) => `- [ ] t${i}`).join("\n") + "\n";
    expect(cardStats(text).nextTodos.map((t) => t.text)).toEqual([
      "t0",
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
    ]);
  });
});

describe("updateTimestampedLine / removeTimestampedLine — byte-stable on Comments", () => {
  const withThreeComments = (() => {
    let t = appendComment(SAMPLE_CARD, "one", "2026-06-13 10:00");
    t = appendComment(t, "two", "2026-06-13 11:00");
    t = appendComment(t, "three", "2026-06-13 12:00");
    return t;
  })();

  it("updateComment edits only comment 2: timestamp preserved, others byte-identical", () => {
    const out = updateTimestampedLine(withThreeComments, SECTION.comments, 1, "edited two");
    const comments = parseBody(out).comments;
    expect(comments.map((c) => c.text)).toEqual(["one", "edited two", "three"]);
    if (!comments[1]) throw new Error("expected comment at index 1");
    expect(comments[1].timestamp).toBe("2026-06-13 11:00"); // timestamp kept
    // every byte except comment 2's text is identical: rebuild expected from the original.
    const expected = withThreeComments.replace(
      "- _2026-06-13 11:00:_ two",
      "- _2026-06-13 11:00:_ edited two",
    );
    expect(out).toBe(expected);
    expect(splitFrontmatter(out).fmText).toBe(splitFrontmatter(withThreeComments).fmText);
  });

  it("removeTimestampedLine deletes only its line", () => {
    const out = removeTimestampedLine(withThreeComments, SECTION.comments, 1);
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "three"]);
    const expected = withThreeComments.replace("- _2026-06-13 11:00:_ two\n", "");
    expect(out).toBe(expected);
  });

  it("updateTimestampedLine edits a bare-bullet (no timestamp) comment, not just timestamped ones", () => {
    const body =
      "# C\n\n## Comments\n- _2026-06-13 10:00:_ one\n- bare note\n- _2026-06-13 12:00:_ three\n";
    const out = updateTimestampedLine(body, SECTION.comments, 1, "edited bare");
    expect(out).toBe(body.replace("- bare note", "- edited bare"));
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "edited bare", "three"]);
  });

  it("updateTimestampedLine collapses an embedded newline so the index walk can't desync", () => {
    const out = updateTimestampedLine(withThreeComments, SECTION.comments, 1, "line1\nline2");
    expect(out).toBe(
      withThreeComments.replace("- _2026-06-13 11:00:_ two", "- _2026-06-13 11:00:_ line1 line2"),
    );
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "line1 line2", "three"]);
  });
});

describe("legacy bracketed timestamp lines — read forever, edited in place without migrating", () => {
  const legacyThreeComments = [
    "# C",
    "",
    "## Comments",
    "- [2026-06-13 10:00] one",
    "- [2026-06-13 11:00] two",
    "- [2026-06-13 12:00] three",
    "",
  ].join("\n");

  it("parseBody reads the legacy [timestamp] form", () => {
    expect(parseBody(legacyThreeComments).comments).toEqual([
      { timestamp: "2026-06-13 10:00", author: null, text: "one" },
      { timestamp: "2026-06-13 11:00", author: null, text: "two" },
      { timestamp: "2026-06-13 12:00", author: null, text: "three" },
    ]);
  });

  it("updateTimestampedLine edits a legacy line's text, keeping its [timestamp] prefix as-is", () => {
    const out = updateTimestampedLine(legacyThreeComments, SECTION.comments, 1, "edited two");
    expect(out).toBe(
      legacyThreeComments.replace("[2026-06-13 11:00] two", "[2026-06-13 11:00] edited two"),
    );
    const comments = parseBody(out).comments;
    expect(comments.map((c) => c.text)).toEqual(["one", "edited two", "three"]);
    expect(comments[1]?.timestamp).toBe("2026-06-13 11:00");
  });

  it("removeTimestampedLine deletes a legacy line same as a current one", () => {
    const out = removeTimestampedLine(legacyThreeComments, SECTION.comments, 1);
    expect(out).toBe(legacyThreeComments.replace("- [2026-06-13 11:00] two\n", ""));
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "three"]);
  });

  it("appendComment on a card whose Comments section is all-legacy still appends in the current format, mixing formats in one section", () => {
    const out = appendComment(legacyThreeComments, "four", "2026-06-13 13:00");
    expect(out).toContain("- _2026-06-13 13:00:_ four");
    expect(out).toContain("- [2026-06-13 10:00] one"); // legacy lines untouched
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "two", "three", "four"]);
  });
});

describe("TS_LINE_RE's timestamp capture is restricted to digits/dash/colon/space", () => {
  it("a well-formed date-time timestamp round-trips through updateTimestampedLine byte-stably", () => {
    const body = "# C\n\n## Comments\n- _2026-06-13 10:00:_ note\n";
    const out = updateTimestampedLine(body, SECTION.comments, 0, "edited note");
    expect(out).toBe(
      body.replace("- _2026-06-13 10:00:_ note", "- _2026-06-13 10:00:_ edited note"),
    );
  });

  it("a timestamp value outside that character set degrades to a plain, timestamp-less bullet on read-back — never a wrong boundary", () => {
    const out = appendComment(SAMPLE_CARD, "note", "build_42");
    expect(out).toContain("- _build_42:_ note");
    expect(parseBody(out).comments).toEqual([
      { timestamp: "", author: null, text: "_build_42:_ note" },
    ]);
  });

  it("does not swallow an ordinary italic-labelled bullet as a timestamp", () => {
    const body = "# C\n\n## Comments\n- _Decision:_ use SQLite\n";
    expect(parseBody(body).comments).toEqual([
      { timestamp: "", author: null, text: "_Decision:_ use SQLite" },
    ]);
  });
});

describe("CRLF files round-trip byte-stably (only the touched line changes)", () => {
  // A \r\n fixture with 3 comments. The model splits on "\n", so each segment keeps a trailing
  // \r; the edit/remove must preserve those CRs everywhere — including on the line it touches.
  const crlf = [
    "---\r",
    "status: doing\r",
    "---\r",
    "\r",
    "# C\r",
    "\r",
    "## Comments\r",
    "- _2026-06-13 10:00:_ one\r",
    "- _2026-06-13 11:00:_ two\r",
    "- _2026-06-13 12:00:_ three\r",
    "",
  ].join("\n");

  const everyLineKeepsCRLF = (s: string) => {
    const segs = s.split("\n");
    // Every segment except the final (post-trailing-\n) empty one must end with \r.
    for (let i = 0; i < segs.length - 1; i++) expect((segs[i] ?? "").endsWith("\r")).toBe(true);
  };

  it("updateComment edits comment 2 of 3 with the CR preserved on that line", () => {
    const out = updateTimestampedLine(crlf, SECTION.comments, 1, "edited two");
    const expected = crlf.replace(
      "- _2026-06-13 11:00:_ two\r",
      "- _2026-06-13 11:00:_ edited two\r",
    );
    expect(out).toBe(expected); // whole file byte-identical except the intended change
    everyLineKeepsCRLF(out);
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "edited two", "three"]);
  });

  it("removeComment removes only comment 2 of 3, leaving the rest CRLF-intact", () => {
    const out = removeTimestampedLine(crlf, SECTION.comments, 1);
    const expected = crlf.replace("- _2026-06-13 11:00:_ two\r\n", "");
    expect(out).toBe(expected);
    everyLineKeepsCRLF(out);
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "three"]);
  });
});

describe("historyAllows — scope policy", () => {
  it("structural keys need >= structural; comment/subtask need 'all'; nothing emits under 'moves'", () => {
    expect(historyAllows("moves", "priority")).toBe(false);
    expect(historyAllows("moves", "status")).toBe(false);
    expect(historyAllows("structural", "priority")).toBe(true);
    expect(historyAllows("structural", "due")).toBe(true);
    expect(historyAllows("structural", "status")).toBe(true);
    expect(historyAllows("structural", "comment")).toBe(false);
    expect(historyAllows("all", "comment")).toBe(true);
    expect(historyAllows("all", "subtask")).toBe(true);
  });
});

// --- The make-or-break test: real card files must round-trip without corruption.
// Fixtures cover the shapes the plugin meets in the wild: bare frontmatter + body, and
// files that already contain Subtasks / Comments / History sections.
describe("round-trip on fixture cards", () => {
  const fixturesDir = path.resolve(process.cwd(), "test/fixtures");
  const files = fs.existsSync(fixturesDir)
    ? fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".md"))
    : [];

  it("found the fixture cards", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`preserves all untouched bytes of "${file}"`, () => {
      const original = fs.readFileSync(path.join(fixturesDir, file), "utf8");
      const before = parseBody(original);
      const fmBefore = splitFrontmatter(original).fmText;
      // Apply a representative mix of edits.
      let out = appendComment(original, "verification comment", "2026-06-13 10:00");
      out = appendHistory(out, "Verified by test", "2026-06-13 10:01");
      out = addTodo(out, "a subtask");
      const after = parseBody(out);
      // Frontmatter must be byte-identical.
      expect(splitFrontmatter(out).fmText).toBe(fmBefore);
      // Title and description must be untouched.
      expect(after.title).toBe(before.title);
      expect(after.description).toBe(before.description);
      // Nothing lost: every pre-existing item survives, plus exactly the new ones appended.
      expect(after.comments.map((c) => c.text)).toEqual([
        ...before.comments.map((c) => c.text),
        "verification comment",
      ]);
      expect(after.history.map((h) => h.text)).toEqual([
        ...before.history.map((h) => h.text),
        "Verified by test",
      ]);
      expect(after.subtasks.map((s) => s.text)).toEqual([
        ...before.subtasks.map((s) => s.text),
        "a subtask",
      ]);
    });
  }
});

// --- The description is everything the plugin does NOT own: a note that keeps its body under its
// own headings (`## Question` / `## Answer`) must read back whole, and survive being written back.
describe("description spanning the note's own headings", () => {
  const ownHeadings = `---
status: doing
---

# Rename the widget factory helpers

Context: [overview.md](../overview.md)

## Question

Apply the renames that still stand.

## Answer

All three landed.
`;

  it("keeps foreign headings in the description", () => {
    const b = parseBody(ownHeadings);
    expect(b.title).toBe("Rename the widget factory helpers");
    expect(b.description).toBe(
      [
        "Context: [overview.md](../overview.md)",
        "",
        "## Question",
        "",
        "Apply the renames that still stand.",
        "",
        "## Answer",
        "",
        "All three landed.",
      ].join("\n"),
    );
  });

  it("stops at the first section the plugin owns, and still reads that section", () => {
    const mixed = `${ownHeadings}
## Comments
- _2026-08-21 11:49:_ Applied and checked.

## History
- _2026-08-21 11:00:_ Created
`;
    const b = parseBody(mixed);
    expect(b.description).toBe(parseBody(ownHeadings).description);
    expect(b.comments).toEqual([
      { timestamp: "2026-08-21 11:49", author: null, text: "Applied and checked." },
    ]);
    expect(b.history).toEqual([{ timestamp: "2026-08-21 11:00", author: null, text: "Created" }]);
  });

  it("agrees with the section readers on a lowercase owned heading", () => {
    // The boundary and `headingIndex` are both case-insensitive on purpose: if they disagreed,
    // `## comments` would show inside the description AND in the comments list.
    const b = parseBody("# T\n\ndesc\n\n## comments\n- _2026-08-21 11:49:_ hi\n");
    expect(b.description).toBe("desc");
    expect(b.comments).toEqual([{ timestamp: "2026-08-21 11:49", author: null, text: "hi" }]);
  });

  it("reads the whole body when the note has no H1", () => {
    const b = parseBody("## Question\n\nWhy?\n\n## Comments\n- _t:_ x\n");
    expect(b.title).toBe("");
    expect(b.description).toBe("## Question\n\nWhy?");
  });

  it("leaves a foreign heading that follows an owned section on disk, outside the description", () => {
    const trailing =
      "# T\n\ndesc\n\n## Comments\n- _2026-08-21 11:49:_ hi\n\n## Appendix\n\nkept\n";
    expect(parseBody(trailing).description).toBe("desc");
    const out = setDescription(trailing, "edited");
    expect(out).toContain("## Appendix\n\nkept\n");
    expect(parseBody(out).comments).toHaveLength(1);
  });

  it("round-trips an unedited description without reshaping the note", () => {
    // Deliberately the mixed shape: with owned sections present, `setDescription` has to splice
    // the region back in ahead of a tail it must not touch. The section-less shape would leave
    // that branch unexercised.
    const withSections = `${ownHeadings}
## Comments
- _2026-08-21 11:49:_ Applied and checked.

## History
- _2026-08-21 11:00:_ Created
`;
    const once = setDescription(withSections, parseBody(withSections).description);
    expect(parseBody(once).description).toBe(parseBody(withSections).description);
    expect(parseBody(once).comments).toEqual(parseBody(withSections).comments);
    expect(parseBody(once).history).toEqual(parseBody(withSections).history);
    expect(once).toContain("## Comments\n- _2026-08-21 11:49:_ Applied and checked.");
    // Writing again changes nothing: the only difference from the original is the blank-line
    // normalization `setDescription` has always applied around the region.
    expect(setDescription(once, parseBody(once).description)).toBe(once);
  });

  it("keeps a heading the plugin owns as a section, wherever it is typed", () => {
    // Pre-existing and unchanged by the description boundary: `## History` typed into the
    // Description box starts a real History section rather than a heading of the note's own.
    // Verified identical against the previous boundary rule; pinned so it stays a decision.
    const out = setDescription("# My card\n\nIntro\n", "Intro\n\n## History\n\n- 2024: started");
    expect(parseBody(out).description).toBe("Intro");
    expect(parseBody(out).history).toEqual([
      { timestamp: "", author: null, text: "2024: started" },
    ]);
  });

  it("survives an edit that adds a heading of the note's own", () => {
    const edited = `${parseBody(ownHeadings).description}\n\n## Notes\n\nOne more.`;
    const out = setDescription(ownHeadings, edited);
    expect(parseBody(out).description).toBe(edited);
    expect(splitFrontmatter(out).fmText).toBe(splitFrontmatter(ownHeadings).fmText);
  });

  it("refuses a heading the plugin owns, or an open fence, before it reaches the file", () => {
    // The Description box asks before saving; `setDescription` itself stays permissive so a
    // section can still be written by anything that means to.
    expect(descriptionRefusal("Intro\n\n## History\n\nof the project")).toEqual({
      kind: "heading",
      line: "## History",
    });
    expect(descriptionRefusal("Intro\n\n## comments \n")).toEqual({
      kind: "heading",
      line: "## comments",
    });
    expect(descriptionRefusal("Intro\n\n## Notes\n\n### Comments\n")).toBeNull();
    expect(descriptionRefusal("```md\n## Comments\n```\n")).toBeNull();
    // Left open, a fence would run to the end of the note and take every section with it.
    expect(descriptionRefusal("Intro\n\n```js\nconst a = 1;")).toEqual({
      kind: "fence",
      line: "```js",
    });
    expect(descriptionRefusal("~~~~\ncode\n~~~\n")).toEqual({ kind: "fence", line: "~~~~" });
    // The fence reported is the line that opened it, not just its marker.
    expect(descriptionRefusal("```js\nok\n```\n\n```sh\nopen")).toEqual({
      kind: "fence",
      line: "```sh",
    });
    // `setDescription` trims, so an indent that would keep the first line inert is judged gone.
    expect(descriptionRefusal("    ## History\n\nof the project")).toEqual({
      kind: "heading",
      line: "## History",
    });
    expect(descriptionRefusal("     ```\noops")).toEqual({ kind: "fence", line: "```" });
    expect(descriptionRefusal("Intro\n    ## History\n")).toBeNull();
  });
});

describe("code fences hide structure from every lookup at once", () => {
  const fenced =
    "# T\n\ndesc\n\n```md\n## Comments\n- _2026-08-21 11:49:_ sample\n```\n\nafter\n\n## Comments\n- _2026-08-22 09:00:_ real\n";

  it("keeps a quoted owned heading inside the description, and out of the comments", () => {
    const b = parseBody(fenced);
    expect(b.description).toBe(
      "desc\n\n```md\n## Comments\n- _2026-08-21 11:49:_ sample\n```\n\nafter",
    );
    expect(b.comments).toEqual([{ timestamp: "2026-08-22 09:00", author: null, text: "real" }]);
  });

  it("writes the description back around the quoted heading without reshaping the note", () => {
    expect(setDescription(fenced, parseBody(fenced).description)).toBe(fenced);
  });

  it("appends to the real section, not the quoted one", () => {
    const out = appendComment(fenced, "new", "2026-08-23 10:00");
    expect(out).toBe(fenced + "- _2026-08-23 10:00:_ new\n");
  });

  it("edits and deletes address the real section's entries", () => {
    expect(updateTimestampedLine(fenced, SECTION.comments, 0, "edited")).toBe(
      fenced.replace("- _2026-08-22 09:00:_ real", "- _2026-08-22 09:00:_ edited"),
    );
    expect(removeTimestampedLine(fenced, SECTION.comments, 0)).toBe(
      fenced.replace("- _2026-08-22 09:00:_ real\n", ""),
    );
  });

  it("a quoted bullet inside a section is code, to the reader and the writers alike", () => {
    const doc = "# T\n\n## Comments\n```\n- _t:_ quoted\n```\n- _2026-08-22 09:00:_ real\n";
    expect(parseBody(doc).comments.map((c) => c.text)).toEqual(["real"]);
    expect(removeTimestampedLine(doc, SECTION.comments, 0)).toBe(
      "# T\n\n## Comments\n```\n- _t:_ quoted\n```\n",
    );
  });

  it("a quoted checkbox is not a subtask", () => {
    const doc = "# T\n\n## Subtasks\n~~~\n- [ ] quoted\n~~~\n- [ ] real\n";
    expect(parseSubtasks(doc).map((s) => s.text)).toEqual(["real"]);
    expect(setSubtaskDone(doc, 0, true)).toBe(doc.replace("- [ ] real", "- [x] real"));
  });

  it("a fence left open runs to the end, so the new section is written after closing it", () => {
    const doc = "# T\n\n```\ncode\n";
    const out = appendComment(doc, "c", "2026-08-23 10:00");
    expect(out).toBe(doc + "```\n\n## Comments\n- _2026-08-23 10:00:_ c\n");
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["c"]);
  });

  it("closes a fence left open inside an existing section before appending to it", () => {
    const doc = "# T\n\n## Comments\n- _2026-08-22 09:00:_ real\n\n```\ncode\n\n";
    const out = appendHistory(doc, "Moved", "2026-08-23 10:00");
    expect(out).toBe(doc + "```\n\n## History\n- _2026-08-23 10:00:_ Moved\n");
    const out2 = appendComment(doc, "new", "2026-08-23 10:00");
    expect(out2).toBe(
      "# T\n\n## Comments\n- _2026-08-22 09:00:_ real\n\n```\ncode\n```\n- _2026-08-23 10:00:_ new\n\n",
    );
    expect(parseBody(out2).comments.map((c) => c.text)).toEqual(["real", "new"]);
  });

  it("a backtick line whose info string holds a backtick is inline code, not a fence", () => {
    const doc = "# T\n\n``` `\n\n## Comments\n- _2026-08-22 09:00:_ real\n";
    expect(parseBody(doc).comments.map((c) => c.text)).toEqual(["real"]);
    expect(parseBody("# T\n\n~~~ `\n## Comments\n- _t:_ quoted\n~~~\n").comments).toEqual([]);
  });

  it("sees fences on CRLF notes too", () => {
    const doc =
      "# T\r\n\r\n```md\r\n## Comments\r\n- _t:_ quoted\r\n```\r\n\r\n## Comments\r\n- _2026-08-22 09:00:_ real\r\n";
    const b = parseBody(doc);
    expect(b.description).toBe("```md\r\n## Comments\r\n- _t:_ quoted\r\n```");
    expect(b.comments).toEqual([{ timestamp: "2026-08-22 09:00", author: null, text: "real" }]);
    expect(appendComment(doc, "new", "2026-08-23 10:00")).toBe(doc + "- _2026-08-23 10:00:_ new\n");
  });

  it("a fenced `# heading` is not the title", () => {
    expect(parseBody("```\n# not me\n```\n# Me\n\nbody\n")).toMatchObject({
      title: "Me",
      description: "body",
    });
  });
});

describe("prose under Comments / History", () => {
  const doc =
    "# T\n\n## Comments\n\n**2026-08-21** — Applied and checked\nagainst the test suite.\n\n- _2026-08-22 09:00:_ bullet\n  a continuation line\n\nA closing remark.\n\n## History\n- _2026-08-20 08:00:_ Created\n";

  it("reads a paragraph as one comment, without timestamp or author", () => {
    expect(parseBody(doc).comments).toEqual([
      {
        timestamp: "",
        author: null,
        text: "**2026-08-21** — Applied and checked\nagainst the test suite.",
      },
      { timestamp: "2026-08-22 09:00", author: null, text: "bullet\n  a continuation line" },
      { timestamp: "", author: null, text: "A closing remark." },
    ]);
  });

  it("keeps a continuation line's whitespace, since a hard break or an indent means something", () => {
    const text = parseBody("# T\n\n## Comments\n\nFirst line  \nsecond line\n").comments[0]?.text;
    expect(text).toBe("First line  \nsecond line");
  });

  it("a bullet wrapped over two lines is one comment, edited and deleted as one", () => {
    expect(updateTimestampedLine(doc, SECTION.comments, 1, "edited")).toBe(
      doc.replace(
        "- _2026-08-22 09:00:_ bullet\n  a continuation line",
        "- _2026-08-22 09:00:_ edited",
      ),
    );
    expect(removeTimestampedLine(doc, SECTION.comments, 1)).toBe(
      doc.replace("- _2026-08-22 09:00:_ bullet\n  a continuation line\n\n", ""),
    );
  });

  it("a prose edit that would read as structure is written as a bullet instead", () => {
    for (const text of ["## History", "# Title", "#\u00a0Title", "```", "~~~js"]) {
      const out = updateTimestampedLine(doc, SECTION.comments, 0, text);
      expect(out).toBe(
        doc.replace("**2026-08-21** — Applied and checked\nagainst the test suite.", `- ${text}`),
      );
      expect(parseBody(out).comments.map((c) => c.text)).toEqual([
        text,
        "bullet\n  a continuation line",
        "A closing remark.",
      ]);
      expect(parseBody(out).history).toHaveLength(1);
    }
  });

  it("edits the paragraph the panel showed, as one line, leaving every other byte alone", () => {
    expect(updateTimestampedLine(doc, SECTION.comments, 0, "Applied.")).toBe(
      doc.replace("**2026-08-21** — Applied and checked\nagainst the test suite.", "Applied."),
    );
    expect(updateTimestampedLine(doc, SECTION.comments, 2, "Bye.")).toBe(
      doc.replace("A closing remark.", "Bye."),
    );
  });

  it("deletes the whole paragraph the panel showed, with the blank line that separated it", () => {
    expect(removeTimestampedLine(doc, SECTION.comments, 0)).toBe(
      doc.replace("**2026-08-21** — Applied and checked\nagainst the test suite.\n\n", ""),
    );
    expect(removeTimestampedLine(doc, SECTION.comments, 2)).toBe(
      doc.replace("A closing remark.\n\n", ""),
    );
  });

  it("an index past the end changes nothing", () => {
    expect(updateTimestampedLine(doc, SECTION.comments, 9, "x")).toBe(doc);
    expect(removeTimestampedLine(doc, SECTION.comments, 9)).toBe(doc);
  });

  it("counts a prose comment on the card, untracked for unread marking", () => {
    const stats = cardStats(doc);
    expect(stats.comments).toBe(3);
    expect(stats.commentMarks[0]).toEqual({ timestamp: "", author: null });
  });
});

describe("inline subtask status (a checklist line's own column)", () => {
  const doc =
    "# T\n\n## Subtasks\n- [ ] Write the docs [status:: doing]\n- [ ] Stay home\n- [x] [[Child]]\n";

  it("reads the field off the line and keeps it out of the text people see", () => {
    const items = parseSubtasks(doc);
    expect(items[0]).toMatchObject({ kind: "todo", text: "Write the docs", status: "doing" });
    expect(items[1]).toMatchObject({ kind: "todo", text: "Stay home" });
    expect(items[1]?.status).toBeUndefined();
  });

  it("still reads a subcard link that carries a field, as a link", () => {
    const items = parseSubtasks("# T\n\n## Subtasks\n- [ ] [[Child]] [status:: done]\n");
    expect(items[0]).toMatchObject({ kind: "card", link: "Child", text: "[[Child]]" });
  });

  it("treats an empty field as no claim at all", () => {
    expect(
      parseSubtasks("# T\n\n## Subtasks\n- [ ] Thing [status::  ]\n")[0]?.status,
    ).toBeUndefined();
  });

  it("tolerates a hand-typed field with no space after the colons", () => {
    expect(parseSubtasks("# T\n\n## Subtasks\n- [ ] Thing [status::doing]\n")[0]?.status).toBe(
      "doing",
    );
  });

  it("keeps the field out of the parent's inline next-todos text", () => {
    expect(cardStats(doc).nextTodos.map((t) => t.text)).toEqual(["Write the docs", "Stay home"]);
  });

  it("adds a field to a line that has none, touching nothing else", () => {
    const out = setSubtaskStatus(doc, 1, "done");
    expect(out.split("\n")[4]).toBe("- [ ] Stay home [status:: done]");
    expect(out.split("\n")[3]).toBe("- [ ] Write the docs [status:: doing]");
    expect(out.split("\n")[5]).toBe("- [x] [[Child]]");
  });

  it("rewrites a field in place rather than appending a second one", () => {
    const out = setSubtaskStatus(doc, 0, "done");
    expect(out.split("\n")[3]).toBe("- [ ] Write the docs [status:: done]");
    expect(parseSubtasks(out)[0]?.status).toBe("done");
  });

  it("clears a field with null and leaves no double space behind", () => {
    const out = setSubtaskStatus("# T\n\n## Subtasks\n- [ ] A [status:: doing] tail\n", 0, null);
    expect(out.split("\n")[3]).toBe("- [ ] A tail");
  });

  it("keeps the bullet prefix, indent and frontmatter byte-identical", () => {
    const src = "---\nstatus: todo\n---\n# T\n\n## Subtasks\n  * [x] Deep one\n";
    const out = setSubtaskStatus(src, 0, "doing");
    expect(out.split("\n")[6]).toBe("  * [x] Deep one [status:: doing]");
    expect(splitFrontmatter(out).fmText).toBe(splitFrontmatter(src).fmText);
  });

  it("round-trips through the checkbox writer without losing the field", () => {
    const out = setSubtaskStatus(setSubtaskDone(doc, 0, true), 0, "done");
    expect(out.split("\n")[3]).toBe("- [x] Write the docs [status:: done]");
  });

  it("leaves the author's own spacing alone when it reads the field off the line", () => {
    const items = parseSubtasks("# T\n\n## Subtasks\n- [ ] Deploy  to  prod [status:: doing]\n");
    expect(items[0]?.text).toBe("Deploy  to  prod");
  });

  it("replaces the field where it sits, touching no other byte of the line", () => {
    const src = "# T\n\n## Subtasks\n- [ ] Deploy  to  prod [status:: doing] (soon)\n";
    const out = setSubtaskStatus(src, 0, "next");
    expect(out.split("\n")[3]).toBe("- [ ] Deploy  to  prod [status:: next] (soon)");
  });

  it("closes only the gap the field leaves when it is cleared", () => {
    const src = "# T\n\n## Subtasks\n- [ ] Deploy  to  prod [status:: doing] (soon)\n";
    const out = setSubtaskStatus(src, 0, null);
    expect(out.split("\n")[3]).toBe("- [ ] Deploy  to  prod (soon)");
  });

  it("is a no-op when the card has no Subtasks section", () => {
    const src = "# T\n\nJust prose.\n";
    expect(setSubtaskStatus(src, 0, "doing")).toBe(src);
  });
});

describe("comment authorship — an optional @name inside the italic prefix", () => {
  it("signs a new comment when an author is given, and leaves it unsigned when it isn't", () => {
    expect(appendComment(SAMPLE_CARD, "hi", "2026-06-13 10:00", "rafa")).toContain(
      "- _2026-06-13 10:00 @rafa:_ hi",
    );
    expect(appendComment(SAMPLE_CARD, "hi", "2026-06-13 10:00")).toContain(
      "- _2026-06-13 10:00:_ hi",
    );
    expect(appendComment(SAMPLE_CARD, "hi", "2026-06-13 10:00", "")).toContain(
      "- _2026-06-13 10:00:_ hi",
    );
  });

  it("normalizes a name that would otherwise break the line grammar", () => {
    expect(appendComment(SAMPLE_CARD, "hi", "2026-06-13 10:00", "@Ana Maria")).toContain(
      "- _2026-06-13 10:00 @Ana-Maria:_ hi",
    );
  });

  it("reads the author back, and reports null for every unsigned form", () => {
    const authored = appendComment(SAMPLE_CARD, "from the agent", "2026-06-13 10:00", "agent");
    expect(parseBody(authored).comments).toEqual([
      { timestamp: "2026-06-13 10:00", author: "agent", text: "from the agent" },
    ]);
    const legacy = "# C\n\n## Comments\n- [2026-06-13 10:00] old one\n- plain bullet\n";
    expect(parseBody(legacy).comments).toEqual([
      { timestamp: "2026-06-13 10:00", author: null, text: "old one" },
      { timestamp: "", author: null, text: "plain bullet" },
    ]);
  });

  it("reads a name with an underscore in it, and edits it without eating the prefix", () => {
    const body = "# C\n\n## Comments\n- _2026-06-13 14:32 @alex_smith:_ hello\n";
    expect(parseBody(body).comments).toEqual([
      { timestamp: "2026-06-13 14:32", author: "alex_smith", text: "hello" },
    ]);
    expect(updateTimestampedLine(body, SECTION.comments, 0, "goodbye")).toBe(
      body.replace("hello", "goodbye"),
    );
  });

  it("never writes an author onto a History line", () => {
    const out = appendHistory(SAMPLE_CARD, "Created", "2026-06-13 10:00");
    expect(out).toContain("- _2026-06-13 10:00:_ Created");
    expect(parseBody(out).history).toEqual([
      { timestamp: "2026-06-13 10:00", author: null, text: "Created" },
    ]);
  });

  it("edits an authored comment's text and keeps its `@name` prefix byte-identical", () => {
    const authored = appendComment(SAMPLE_CARD, "first draft", "2026-06-13 10:00", "rafa");
    const out = updateTimestampedLine(authored, SECTION.comments, 0, "second draft");
    expect(out).toBe(
      authored.replace(
        "- _2026-06-13 10:00 @rafa:_ first draft",
        "- _2026-06-13 10:00 @rafa:_ second draft",
      ),
    );
  });

  it("carries the author onto cardStats, alongside the plain count", () => {
    let t = appendComment(SAMPLE_CARD, "one", "2026-06-13 10:00", "agent");
    t = appendComment(t, "two", "2026-06-13 11:00");
    const s = cardStats(t);
    expect(s.comments).toBe(2);
    expect(s.commentMarks).toEqual([
      { timestamp: "2026-06-13 10:00", author: "agent" },
      { timestamp: "2026-06-13 11:00", author: null },
    ]);
  });
});

describe("author names are sanitized into something the line grammar can hold", () => {
  it("strips the markdown characters that would break out of the italic prefix", () => {
    const out = appendComment(SAMPLE_CARD, "hi", "2026-06-13 10:00", "*Al*[x]@");
    expect(out).toContain("- _2026-06-13 10:00 @Alx:_ hi");
    expect(parseBody(out).comments).toEqual([
      { timestamp: "2026-06-13 10:00", author: "Alx", text: "hi" },
    ]);
  });
});
