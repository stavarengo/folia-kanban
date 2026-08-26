import { describe, it, expect } from "vitest";
import { buildBoard, relationCounts } from "../src/model/board";
import {
  BLOCKS,
  isSelfRelation,
  normalizeRelationTypes,
  readInverse,
  readRelations,
  relationKeys,
  relationLabel,
  relationLinkText,
  relationTarget,
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
  relations: [BLOCKS],
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

/** The same board, with `a-result-of` / `results-in` declared in its note. */
const withResultOf: BoardConfig = {
  ...config,
  relations: normalizeRelationTypes([{ key: "a-result-of", inverse: "results-in" }]),
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
    expect(readInverse({ "blocked-by": [["A"], "[[B]]"] }, BLOCKS)).toEqual(["A", "B"]);
  });

  it("reads an absent or empty list as no relationships", () => {
    expect(readRelations({}, "blocks")).toEqual([]);
    expect(readRelations({ blocks: [] }, "blocks")).toEqual([]);
    expect(readInverse({ "blocked-by": [] }, BLOCKS)).toEqual([]);
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
    expect(withoutRelation({ blocks: ["[[A]]", "[[B]]"] }, "blocks", ["A"])).toEqual(["[[B]]"]);
    expect(withoutRelation({ blocks: ["[[A]]"] }, "blocks", ["A"])).toEqual([]);
    expect(withoutRelation({ blocks: ["[[A]]"] }, "blocks", ["Z"])).toBeNull();
    expect(withoutRelation({ blocks: ["[[A]]"] }, "blocks", [])).toBeNull();
    // Every spelling the panel showed as one row goes in one rewrite.
    expect(
      withoutRelation({ blocks: ["[[A]]", "[[Sub/A]]", "[[B]]"] }, "blocks", ["A", "Sub/A"]),
    ).toEqual(["[[B]]"]);
  });

  it("reads two ways of writing one target as the single relationship they are", () => {
    // Otherwise the note shows two rows and one click clears both, or one row hides the other.
    expect(readRelations({ blocks: ["[[A]]", "[[A|see this]]", "[[A#Notes]]"] }, "blocks")).toEqual(
      ["A"],
    );
    // Case is kept, matching how the board binds a link, so these stay two distinct targets.
    expect(readRelations({ blocks: ["[[A]]", "[[a]]"] }, "blocks")).toEqual(["A", "a"]);
  });

  it("treats an aliased or anchored target as the same relationship the board resolves it to", () => {
    // `[[A|see this]]`, `[[A#Notes]]` and `[[A]]` all name card A, so the list must never hold two
    // of them: the board shows one row, and one click on it has to clear the relationship.
    expect(withRelation({ blocks: ["[[A|see this]]"] }, "blocks", "A")).toBeNull();
    expect(withRelation({ blocks: ["[[A#Notes]]"] }, "blocks", "A")).toBeNull();
    expect(
      withoutRelation({ blocks: ["[[A|see this]]", "[[A]]", "[[B]]"] }, "blocks", ["A"]),
    ).toEqual(["[[B]]"]);
    // Case is kept, matching how the board itself binds a link.
    expect(withRelation({ blocks: ["[[A]]"] }, "blocks", "a")).toEqual(["[[A]]", "[[a]]"]);
  });

  it("normalizes a bare hand-written target only as a side effect of editing that list", () => {
    expect(withRelation({ blocks: ["A"] }, "blocks", "B")).toEqual(["[[A]]", "[[B]]"]);
  });

  it("names the keys it owns, so generic property editing can stay out of them", () => {
    expect(relationKeys([BLOCKS])).toEqual(["blocks", "blocked-by"]);
    expect(
      relationKeys([BLOCKS, { key: "x", inverse: null, label: "X", inverseLabel: "" }]),
    ).toEqual(["blocks", "blocked-by", "x"]);
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
    // A folder-qualified target names one exact note, so a same-named card elsewhere is a real
    // link, not a self-link.
    expect(self("Sub/A")).toBe(false);
    expect(self("[[Tasks/Sub/A]]")).toBe(false);
  });
});

describe("the relationship vocabulary (board note `relations`)", () => {
  it("always holds `blocks` first, whatever the note says", () => {
    expect(normalizeRelationTypes(undefined)).toEqual([BLOCKS]);
    expect(normalizeRelationTypes("nonsense")).toEqual([BLOCKS]);
    expect(normalizeRelationTypes([])).toEqual([BLOCKS]);
  });

  it("reads `{ key, inverse }` entries, labelling both ends from their keys", () => {
    expect(normalizeRelationTypes([{ key: "a-result-of", inverse: "results-in" }])).toEqual([
      BLOCKS,
      {
        key: "a-result-of",
        inverse: "results-in",
        label: "A result of",
        inverseLabel: "Results in",
      },
    ]);
  });

  it("accepts a bare key, whose other end then has no words of its own", () => {
    expect(normalizeRelationTypes(["relates_to"])).toEqual([
      BLOCKS,
      {
        key: "relates_to",
        inverse: null,
        label: "Relates to",
        inverseLabel: "Relates to (reverse)",
      },
    ]);
  });

  it("drops what it cannot use instead of refusing the board", () => {
    expect(
      normalizeRelationTypes([
        42,
        { inverse: "x" },
        { key: "   " },
        { key: "same", inverse: "same" },
        // A key the plugin already gives a meaning to, as the key or as the inverse.
        "status",
        { key: "fine", inverse: "created" },
        // No letters, so no heading to show.
        "---",
        "kept",
      ]),
    ).toEqual([
      BLOCKS,
      { key: "kept", inverse: null, label: "Kept", inverseLabel: "Kept (reverse)" },
    ]);
  });

  it("reads an `inverse:` left without a value as no inverse, not as a broken entry", () => {
    // YAML hands `null` for a key with nothing after the colon.
    expect(normalizeRelationTypes([{ key: "depends-on", inverse: null }])).toEqual([
      BLOCKS,
      {
        key: "depends-on",
        inverse: null,
        label: "Depends on",
        inverseLabel: "Depends on (reverse)",
      },
    ]);
    expect(normalizeRelationTypes([{ key: "depends-on", inverse: "  " }])).toHaveLength(2);
  });

  it("gives one frontmatter key one meaning: a repeat of a key or an inverse is dropped", () => {
    expect(
      normalizeRelationTypes([
        "blocks",
        "Blocks",
        { key: "Held-By", inverse: "BLOCKED-BY" },
        { key: "held-by", inverse: "blocked-by" },
        { key: "a", inverse: "b" },
        { key: "b", inverse: "c" },
        { key: "c", inverse: "a" },
        "a",
      ]),
    ).toEqual([BLOCKS, { key: "a", inverse: "b", label: "A", inverseLabel: "B" }]);
  });

  it("reads a key as a heading", () => {
    expect(relationLabel("blocks")).toBe("Blocks");
    expect(relationLabel("blocked-by")).toBe("Blocked by");
    expect(relationLabel("a-result-of")).toBe("A result of");
    expect(relationLabel("depends_on")).toBe("Depends on");
  });
});

describe("history lines for relationships", () => {
  it("names the type and the target as a link", () => {
    expect(relationAddedLine("blocks", "A")).toBe("Blocks added: [[A]]");
    expect(relationRemovedLine("blocks", "A")).toBe("Blocks removed: [[A]]");
    expect(relationAddedLine("a-result-of", "A")).toBe("A result of added: [[A]]");
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
    expect(b.cards["Tasks/A.md"]?.relations).toEqual([
      {
        type: "blocks",
        direction: "out",
        target: "B",
        targets: ["B"],
        path: "Tasks/B.md",
        source: "own",
      },
    ]);
    expect(b.cards["Tasks/B.md"]?.relations).toEqual([
      {
        type: "blocks",
        direction: "in",
        target: "A",
        targets: ["A"],
        path: "Tasks/A.md",
        source: "inverse",
      },
    ]);
    // The inverse is derived only — nothing is written back to B.
    expect(b.cards["Tasks/B.md"]?.frontmatter["blocked-by"]).toBeUndefined();
  });

  it("reads a hand-written `blocked-by` as the same edge, from the other end", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo" }),
      card("B", { status: "todo", "blocked-by": ["[[A]]"] }),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations).toEqual([
      {
        type: "blocks",
        direction: "out",
        target: "B",
        targets: ["B"],
        path: "Tasks/B.md",
        source: "inverse",
      },
    ]);
    expect(b.cards["Tasks/B.md"]?.relations).toEqual([
      {
        type: "blocks",
        direction: "in",
        target: "A",
        targets: ["A"],
        path: "Tasks/A.md",
        source: "own",
      },
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
      expect(b.cards["Tasks/A.md"]?.relations).toEqual([
        {
          type: "blocks",
          direction: "out",
          target: "B",
          targets: ["B"],
          path: "Tasks/B.md",
          source: "both",
        },
      ]);
      expect(b.cards["Tasks/B.md"]?.relations).toEqual([
        {
          type: "blocks",
          direction: "in",
          target: "A",
          targets: ["A"],
          path: "Tasks/A.md",
          source: "both",
        },
      ]);
    }
  });

  it("does not mistake one note's two ways of writing the same link for two notes", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]", "[[B|see this]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.[0]?.source).toBe("own");
  });

  it("remembers every spelling one note gives a single link, so removing it clears them all", () => {
    // `[[B]]` and `[[Tasks/B]]` name one card, so they are one row — but both are in the note, and
    // leaving either behind would bring that row straight back on the next load.
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]", "[[Tasks/B]]"] }),
      card("B", { status: "todo" }),
    ]);
    const link = b.cards["Tasks/A.md"]?.relations;
    expect(link).toHaveLength(1);
    expect(link?.[0]?.targets).toEqual(["B", "Tasks/B"]);
  });

  it("keeps a target that matches no card, marked unresolved", () => {
    const b = buildBoard(config, [card("A", { status: "todo", blocks: ["[[Ghost]]"] })]);
    expect(b.cards["Tasks/A.md"]?.relations).toEqual([
      {
        type: "blocks",
        direction: "out",
        target: "Ghost",
        targets: ["Ghost"],
        path: null,
        source: "own",
      },
    ]);
  });

  it("drops a self-link rather than show one card as both blocker and blocked", () => {
    const b = buildBoard(config, [card("A", { status: "todo", blocks: ["[[A]]"] })]);
    expect(b.cards["Tasks/A.md"]?.relations).toEqual([]);
  });

  it("resolves a folder-qualified target the same way subcard links resolve", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[Tasks/Sub/B]]"] }),
      card("B", { status: "todo" }, "Tasks/Sub"),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.[0]?.path).toBe("Tasks/Sub/B.md");
  });

  it("refuses to bind an ambiguous basename, exactly as parentage does", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", blocks: ["[[B]]"] }),
      card("B", { status: "todo" }, "Tasks/One"),
      card("B", { status: "todo" }, "Tasks/Two"),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.[0]?.path).toBeNull();
  });

  it("leaves a card with no relationships an empty list, never undefined", () => {
    const b = buildBoard(config, [card("A", { status: "todo" })]);
    expect(b.cards["Tasks/A.md"]?.relations).toEqual([]);
  });

  it("reads a second type from the vocabulary, with its own inverse key", () => {
    const b = buildBoard(withResultOf, [
      card("A", { status: "todo", "a-result-of": ["[[B]]"] }),
      card("B", { status: "done" }),
      card("C", { status: "todo", "results-in": ["[[A]]"] }),
    ]);
    // `results-in: [[A]]` on C says "C results in A", i.e. A is a result of C — the same edge
    // `a-result-of: [[C]]` on A would state, so A shows it outgoing and C incoming.
    expect(b.cards["Tasks/A.md"]?.relations).toEqual([
      {
        type: "a-result-of",
        direction: "out",
        target: "B",
        targets: ["B"],
        path: "Tasks/B.md",
        source: "own",
      },
      {
        type: "a-result-of",
        direction: "out",
        target: "C",
        targets: ["C"],
        path: "Tasks/C.md",
        source: "inverse",
      },
    ]);
    expect(b.cards["Tasks/B.md"]?.relations).toEqual([
      {
        type: "a-result-of",
        direction: "in",
        target: "A",
        targets: ["A"],
        path: "Tasks/A.md",
        source: "inverse",
      },
    ]);
    expect(b.cards["Tasks/C.md"]?.relations).toEqual([
      {
        type: "a-result-of",
        direction: "in",
        target: "A",
        targets: ["A"],
        path: "Tasks/A.md",
        source: "own",
      },
    ]);
  });

  it("keeps the same pair of cards apart per type — one edge of each, never merged", () => {
    const b = buildBoard(withResultOf, [
      card("A", { status: "todo", blocks: ["[[B]]"], "a-result-of": ["[[B]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations?.map((l) => [l.type, l.direction])).toEqual([
      ["blocks", "out"],
      ["a-result-of", "out"],
    ]);
    expect(b.cards["Tasks/B.md"]?.relations?.map((l) => [l.type, l.direction])).toEqual([
      ["blocks", "in"],
      ["a-result-of", "in"],
    ]);
  });

  it("ignores a key the vocabulary does not name, so it stays a plain property", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo", "a-result-of": ["[[B]]"] }),
      card("B", { status: "todo" }),
    ]);
    expect(b.cards["Tasks/A.md"]?.relations).toEqual([]);
    expect(b.cards["Tasks/B.md"]?.relations).toEqual([]);
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
      "Tasks/A.md": [{ type: BLOCKS, out: 1, in: 0 }],
      "Tasks/B.md": [{ type: BLOCKS, out: 0, in: 1 }],
    });
  });

  it("counts every other type whatever column either end is in — only blocking fades when done", () => {
    const b = buildBoard(withResultOf, [
      card("A", { status: "done", blocks: ["[[B]]"], "a-result-of": ["[[B]]"] }),
      card("B", { status: "todo" }),
    ]);
    const resultOf = withResultOf.relations[1];
    expect(relationCounts(b, "done")).toEqual({
      "Tasks/A.md": [{ type: resultOf, out: 1, in: 0 }],
      "Tasks/B.md": [{ type: resultOf, out: 0, in: 1 }],
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
      "Tasks/A.md": [{ type: BLOCKS, out: 1, in: 0 }],
      "Tasks/B.md": [{ type: BLOCKS, out: 0, in: 1 }],
    });
  });
});
