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
} from "../src/model/card";

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
