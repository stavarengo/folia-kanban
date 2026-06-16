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
  setSubtaskDone,
  removeSubtask,
  setDescription,
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
    expect(fm.status).toBe("doing");
    expect(fm.priority).toBe("B");
    expect(fm.projects).toEqual(["docs"]);
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
    expect(out).toContain("## Comments\n- [2026-06-13 10:00] first note");
    expect(parseBody(out).comments).toEqual([
      { timestamp: "2026-06-13 10:00", text: "first note" },
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
    expect(subs[0].done).toBe(false);
    expect(subs[1].done).toBe(true);
    // toggling back
    out = setSubtaskDone(out, 1, false);
    expect(parseSubtasks(out)[1].done).toBe(false);
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
    expect(b.comments).toEqual([{ timestamp: "2026-06-13 10:00", text: "keep me" }]);
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

describe("nextTodos — undone plain todos, in order, capped at 5", () => {
  it("excludes done todos and subcard-links, preserves order", () => {
    const text = [
      "# C",
      "",
      "## Subtasks",
      "- [ ] alpha",
      "- [x] beta", // done → excluded
      "- [ ] [[Child]]", // subcard-link → excluded
      "- [ ] gamma",
      "",
    ].join("\n");
    expect(cardStats(text).nextTodos).toEqual(["alpha", "gamma"]);
  });

  it("caps at the first 5 undone todos", () => {
    const text =
      "# C\n\n## Subtasks\n" + Array.from({ length: 8 }, (_, i) => `- [ ] t${i}`).join("\n") + "\n";
    expect(cardStats(text).nextTodos).toEqual(["t0", "t1", "t2", "t3", "t4"]);
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
    expect(comments[1].timestamp).toBe("2026-06-13 11:00"); // timestamp kept
    // every byte except comment 2's text is identical: rebuild expected from the original.
    const expected = withThreeComments.replace("- [2026-06-13 11:00] two", "- [2026-06-13 11:00] edited two");
    expect(out).toBe(expected);
    expect(splitFrontmatter(out).fmText).toBe(splitFrontmatter(withThreeComments).fmText);
  });

  it("removeTimestampedLine deletes only its line", () => {
    const out = removeTimestampedLine(withThreeComments, SECTION.comments, 1);
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "three"]);
    const expected = withThreeComments.replace("- [2026-06-13 11:00] two\n", "");
    expect(out).toBe(expected);
  });

  it("updateTimestampedLine edits a bare-bullet (no timestamp) comment, not just timestamped ones", () => {
    const body = "# C\n\n## Comments\n- [2026-06-13 10:00] one\n- bare note\n- [2026-06-13 12:00] three\n";
    const out = updateTimestampedLine(body, SECTION.comments, 1, "edited bare");
    expect(out).toBe(body.replace("- bare note", "- edited bare"));
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "edited bare", "three"]);
  });

  it("updateTimestampedLine collapses an embedded newline so the index walk can't desync", () => {
    const out = updateTimestampedLine(withThreeComments, SECTION.comments, 1, "line1\nline2");
    expect(out).toBe(withThreeComments.replace("- [2026-06-13 11:00] two", "- [2026-06-13 11:00] line1 line2"));
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "line1 line2", "three"]);
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
    "- [2026-06-13 10:00] one\r",
    "- [2026-06-13 11:00] two\r",
    "- [2026-06-13 12:00] three\r",
    "",
  ].join("\n");

  const everyLineKeepsCRLF = (s: string) => {
    const segs = s.split("\n");
    // Every segment except the final (post-trailing-\n) empty one must end with \r.
    for (let i = 0; i < segs.length - 1; i++) expect(segs[i].endsWith("\r")).toBe(true);
  };

  it("updateComment edits comment 2 of 3 with the CR preserved on that line", () => {
    const out = updateTimestampedLine(crlf, SECTION.comments, 1, "edited two");
    const expected = crlf.replace("- [2026-06-13 11:00] two\r", "- [2026-06-13 11:00] edited two\r");
    expect(out).toBe(expected); // whole file byte-identical except the intended change
    everyLineKeepsCRLF(out);
    expect(parseBody(out).comments.map((c) => c.text)).toEqual(["one", "edited two", "three"]);
  });

  it("removeComment removes only comment 2 of 3, leaving the rest CRLF-intact", () => {
    const out = removeTimestampedLine(crlf, SECTION.comments, 1);
    const expected = crlf.replace("- [2026-06-13 11:00] two\r\n", "");
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
      expect(after.comments.map((c) => c.text)).toEqual([...before.comments.map((c) => c.text), "verification comment"]);
      expect(after.history.map((h) => h.text)).toEqual([...before.history.map((h) => h.text), "Verified by test"]);
      expect(after.subtasks.map((s) => s.text)).toEqual([...before.subtasks.map((s) => s.text), "a subtask"]);
    });
  }
});
