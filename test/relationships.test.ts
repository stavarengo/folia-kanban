import { describe, it, expect } from "vitest";
import { buildBoard, relationCounts } from "../src/model/board";
import {
  RELATION_KEYS,
  relationKey,
  isSelfRelation,
  relationLinkText,
  relationTarget,
  readBlockedBy,
  readRelations,
  withRelation,
  withoutRelation,
} from "../src/model/relationships";
import { relationAddedLine, relationRemovedLine, historyAllows } from "../src/model/history";
import type { BoardConfig, Card } from "../src/model/types";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto",
  priorities: [],
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

function card(basename: string, fm: Partial<Card["frontmatter"]> = {}, folder = "Tasks"): Card {
  return {
    path: `${folder}/${basename}.md`,
    basename,
    title: basename,
    titleSource: "filename",
    frontmatter: fm,
    childLinks: [],
  };
}

describe("relationship frontmatter", () => {
  it("reads wikilink targets out of the stored list", () => {
    expect(readRelations({ blocks: ["[[A]]", "[[Sub/B]]"] }, "blocks")).toEqual(["A", "Sub/B"]);
  });

  it("accepts a bare target and a single scalar, so a hand edit still points somewhere", () => {
    expect(readRelations({ blocks: "A" }, "blocks")).toEqual(["A"]);
    expect(readRelations({ blocks: ["A", "[[B]]"] }, "blocks")).toEqual(["A", "B"]);
  });

  it("ignores non-string entries and duplicates", () => {
    expect(readRelations({ blocks: ["[[A]]", 42, null, "[[A]]"] }, "blocks")).toEqual(["A"]);
  });

  it("reads the unquoted list item YAML turns into a nested sequence", () => {
    // `blocks:\n  - [[A]]` (no quotes) is what a person typing into a note produces, and YAML
    // reads it as a sequence inside a sequence rather than as a string.
    expect(readRelations({ blocks: [["A"]] }, "blocks")).toEqual(["A"]);
    expect(readBlockedBy({ "blocked-by": [["A"], "[[B]]"] })).toEqual(["A", "B"]);
  });

  it("reads an absent or empty list as no relationships", () => {
    expect(readRelations({}, "blocks")).toEqual([]);
    expect(readRelations({ blocks: [] }, "blocks")).toEqual([]);
    expect(readBlockedBy({ "blocked-by": [] })).toEqual([]);
  });

  it("strips an alias/anchor only when the board resolves it — the raw target is kept verbatim", () => {
    expect(relationTarget("[[A|Alias]]")).toBe("A|Alias");
    expect(relationTarget("  [[A]]  ")).toBe("A");
  });

  it("adds a target as a wikilink and reports 'already there' as null", () => {
    expect(withRelation({}, "blocks", "A")).toEqual(["[[A]]"]);
    expect(withRelation({ blocks: ["[[A]]"] }, "blocks", "B")).toEqual(["[[A]]", "[[B]]"]);
    expect(withRelation({ blocks: ["[[A]]"] }, "blocks", "[[A]]")).toBeNull();
    expect(withRelation({}, "blocks", "   ")).toBeNull();
  });

  it("removes a target, and reports 'not there' as null", () => {
    expect(withoutRelation({ blocks: ["[[A]]", "[[B]]"] }, "blocks", "A")).toEqual(["[[B]]"]);
    expect(withoutRelation({ blocks: ["[[A]]"] }, "blocks", "A")).toEqual([]);
    expect(withoutRelation({ blocks: ["[[A]]"] }, "blocks", "Z")).toBeNull();
  });

  it("treats an aliased or anchored target as the same relationship the board resolves it to", () => {
    // `[[A|see this]]`, `[[A#Notes]]` and `[[A]]` all name card A, so the list must never hold two
    // of them: the board shows one row, and one click on it has to clear the relationship.
    expect(withRelation({ blocks: ["[[A|see this]]"] }, "blocks", "A")).toBeNull();
    expect(withRelation({ blocks: ["[[A#Notes]]"] }, "blocks", "A")).toBeNull();
    expect(
      withoutRelation({ blocks: ["[[A|see this]]", "[[A]]", "[[B]]"] }, "blocks", "A"),
    ).toEqual(["[[B]]"]);
    // Case is kept, matching how the board itself binds a link.
    expect(withRelation({ blocks: ["[[A]]"] }, "blocks", "a")).toEqual(["[[A]]", "[[a]]"]);
  });

  it("normalizes a bare hand-written target only as a side effect of editing that list", () => {
    expect(withRelation({ blocks: ["A"] }, "blocks", "B")).toEqual(["[[A]]", "[[B]]"]);
  });

  it("names the keys it owns, so generic property editing can stay out of them", () => {
    expect(relationKey("blocks")).toBe("blocks");
    expect([...RELATION_KEYS]).toEqual(["blocks", "blocked-by"]);
    expect(relationLinkText("A")).toBe("[[A]]");
  });

  it("never double-wraps a target that already arrives bracketed", () => {
    expect(relationLinkText("[[A]]")).toBe("[[A]]");
    expect(relationLinkText("  [[A]] ")).toBe("[[A]]");
  });

  it("recognises a self-link in every form a target can be written", () => {
    const self = (t: string) => isSelfRelation("Tasks/A.md", "A", t);
    expect(self("A")).toBe(true);
    expect(self("[[A]]")).toBe(true);
    expect(self("A.md")).toBe(true);
    expect(self("Tasks/A")).toBe(true);
    expect(self("[[A|see this]]")).toBe(true);
    expect(self("[[A#Notes]]")).toBe(true);
    expect(self("   ")).toBe(true);
    expect(self("B")).toBe(false);
    expect(self("Other/B")).toBe(false);
  });
});

describe("history lines for relationships", () => {
  it("names the type and the target as a link", () => {
    expect(relationAddedLine("blocks", "A")).toBe("Blocks added: [[A]]");
    expect(relationRemovedLine("blocks", "A")).toBe("Blocks removed: [[A]]");
  });

  it("is logged under the same scope as a subtask link, not the stricter structural one", () => {
    expect(historyAllows("moves", "relation")).toBe(false);
    expect(historyAllows("structural", "relation")).toBe(false);
    expect(historyAllows("all", "relation")).toBe(true);
  });
});

describe("buildBoard relationships", () => {
  it("resolves a `blocks` link and derives the inverse on the other card", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.blocks).toEqual([
      { type: "blocks", target: "B", path: "Tasks/B.md", source: "own" },
    ]);
    expect(b.cards["Tasks/B.md"]?.relations?.blockedBy).toEqual([
      { type: "blocks", target: "A", path: "Tasks/A.md", source: "inverse" },
    ]);
    // The inverse is derived only — nothing is written back to B.
    expect(b.cards["Tasks/B.md"]?.frontmatter["blocked-by"]).toBeUndefined();
  });

  it("reads a hand-written `blocked-by` as the same edge, from the other end", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo" }),
      card("B", { status: "todo", "blocked-by": ["[[A]]"] }),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.blocks).toEqual([
      { type: "blocks", target: "B", path: "Tasks/B.md", source: "inverse" },
    ]);
    expect(b.cards["Tasks/B.md"]?.relations?.blockedBy).toEqual([
      { type: "blocks", target: "A", path: "Tasks/A.md", source: "own" },
    ]);
  });

  it("counts an edge stated from BOTH ends once, marked as stated by both", () => {
    // Neither note can end it alone — deleting A's `blocks` would leave B's `blocked-by` to derive
    // it again on the next load — so neither row claims to own it. Order must not change that.
    for (const order of [0, 1]) {
      const pair = [
        card("A", { status: "todo", blocks: ["[[B]]"] }),
        card("B", { status: "todo", "blocked-by": ["[[A]]"] }),
      ];
      const b = buildBoard(config, order === 0 ? pair : pair.reverse());
      expect(b.cards["Tasks/A.md"]?.relations?.blocks).toEqual([
        { type: "blocks", target: "B", path: "Tasks/B.md", source: "both" },
      ]);
      expect(b.cards["Tasks/B.md"]?.relations?.blockedBy).toEqual([
        { type: "blocks", target: "A", path: "Tasks/A.md", source: "both" },
      ]);
    }
  });

  it("does not mistake one note's two ways of writing the same link for two notes", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]", "[[B|see this]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.blocks[0]?.source).toBe("own");
  });

  it("keeps a target that matches no card, marked unresolved", () => {
    const b = buildBoard(config, [card("A", { status: "todo", blocks: ["[[Ghost]]"] })]);
    expect(b.cards["Tasks/A.md"]?.relations?.blocks).toEqual([
      { type: "blocks", target: "Ghost", path: null, source: "own" },
    ]);
  });

  it("drops a self-link rather than show one card as both blocker and blocked", () => {
    const b = buildBoard(config, [card("A", { status: "todo", blocks: ["[[A]]"] })]);
    expect(b.cards["Tasks/A.md"]?.relations).toEqual({ blocks: [], blockedBy: [] });
  });

  it("resolves a folder-qualified target the same way subcard links resolve", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[Tasks/Sub/B]]"] }),
      card("B", { status: "todo" }, "Tasks/Sub"),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.blocks[0]?.path).toBe("Tasks/Sub/B.md");
  });

  it("refuses to bind an ambiguous basename, exactly as parentage does", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]"] }),
      card("B", { status: "todo" }, "Tasks/One"),
      card("B", { status: "todo" }, "Tasks/Two"),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.blocks[0]?.path).toBeNull();
  });

  it("leaves a card with no relationships an empty pair, never undefined", () => {
    const b = buildBoard(config, [card("A", { status: "todo" })]);
    expect(b.cards["Tasks/A.md"]?.relations).toEqual({ blocks: [], blockedBy: [] });
  });

  it("does not turn a blocking link into parentage (relationships stay non-hierarchical)", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]"] }),
      card("B", { status: "doing" }),
    ]);
    expect(b.parentOf["Tasks/B.md"]).toBeUndefined();
    expect(b.columns["doing"]).toEqual(["Tasks/B.md"]);
  });
});

describe("relationCounts", () => {
  it("counts both directions of a live edge", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(relationCounts(b, "done")).toEqual({
      "Tasks/A.md": { blocks: 1, blockedBy: 0 },
      "Tasks/B.md": { blocks: 0, blockedBy: 1 },
    });
  });

  it("drops an edge once either end is done — finished work neither waits nor holds up", () => {
    const done = buildBoard(config, [
      card("A", { status: "done", blocks: ["[[B]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(relationCounts(done, "done")).toEqual({});
    const blockedDone = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]"] }),
      card("B", { status: "done" }),
    ]);
    expect(relationCounts(blockedDone, "done")).toEqual({});
  });

  it("counts nothing for an unresolved target — there is no card to be waiting on", () => {
    const b = buildBoard(config, [card("A", { status: "todo", blocks: ["[[Ghost]]"] })]);
    expect(relationCounts(b, "done")).toEqual({});
  });

  it("counts every edge on a board with no done column", () => {
    const b = buildBoard(config, [
      card("A", { status: "done", blocks: ["[[B]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(relationCounts(b, null)).toEqual({
      "Tasks/A.md": { blocks: 1, blockedBy: 0 },
      "Tasks/B.md": { blocks: 0, blockedBy: 1 },
    });
  });
});
