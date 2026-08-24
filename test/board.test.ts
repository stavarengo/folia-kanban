import { describe, it, expect } from "vitest";
import {
  applyReloc,
  buildBoard,
  resolveCardFolder,
  columnEffectiveOrders,
  computeDropOrder,
  deriveContext,
  isComputedOrder,
  makeCardDragId,
  moveCard,
  moveColumn,
  planDrop,
  resolveDragReloc,
  resolveDrop,
  splitCardDragId,
} from "../src/model/board";
import type { BoardConfig, Card, ColumnDef } from "../src/model/types";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto",
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

function card(
  basename: string,
  fm: Partial<Card["frontmatter"]> = {},
  childLinks: string[] = [],
): Card {
  return {
    path: `Tasks/${basename}.md`,
    basename,
    title: basename,
    titleSource: "filename",
    frontmatter: fm,
    childLinks,
  };
}

describe("buildBoard", () => {
  it("groups top-level cards by status into columns", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo" }),
      card("B", { status: "doing" }),
      card("C", { status: "done" }),
    ]);
    expect(b.columns["todo"]).toEqual(["Tasks/A.md"]);
    expect(b.columns["doing"]).toEqual(["Tasks/B.md"]);
    expect(b.columns["done"]).toEqual(["Tasks/C.md"]);
  });

  it("places cards with an unknown status into the first column (nothing lost)", () => {
    const b = buildBoard(config, [card("X", { status: "weird" })]);
    expect(b.columns["todo"]).toEqual(["Tasks/X.md"]);
  });

  it("excludes subcards (linked by a parent) from the board top level", () => {
    const b = buildBoard(config, [
      card("Parent", { status: "todo" }, ["Child"]),
      card("Child", { status: "todo" }),
    ]);
    expect(b.columns["todo"]).toEqual(["Tasks/Parent.md"]); // Child is nested, not top-level
    expect(b.parentOf["Tasks/Child.md"]).toBe("Tasks/Parent.md");
  });

  it("surfaces cards in a mutual/cyclic subcard link as top-level instead of dropping them", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo" }, ["B"]),
      card("B", { status: "todo" }, ["A"]), // A<->B cycle: neither has a real top-level root
    ]);
    expect((b.columns["todo"] ?? []).sort()).toEqual(["Tasks/A.md", "Tasks/B.md"]); // nothing vanishes
    // A cycle has no genuine parentage, so neither card is anyone's nested child — childrenOf is
    // empty for both. (Otherwise each would render doubly: top-level AND nested under the other.)
    expect(b.childrenOf["Tasks/A.md"]).toBeUndefined();
    expect(b.childrenOf["Tasks/B.md"]).toBeUndefined();
  });
});

describe("childrenOf (nested subcard rendering)", () => {
  it("inverts parentOf into ordered children, ordered by order then basename", () => {
    const b = buildBoard(config, [
      card("Parent", { status: "todo" }, ["Zeta", "Yankee", "Echo"]),
      card("Zeta", { status: "todo" }), // unordered -> sorted alphabetically after ordered ones
      card("Yankee", { status: "todo", order: 2 }),
      card("Echo", { status: "todo", order: 1 }),
    ]);
    // Echo (order 1) then Yankee (order 2) then the unordered Zeta — same ranking columns use.
    expect(b.childrenOf["Tasks/Parent.md"]).toEqual([
      "Tasks/Echo.md",
      "Tasks/Yankee.md",
      "Tasks/Zeta.md",
    ]);
  });

  it("nests a grandchild under its parent and keeps it out of every column", () => {
    const b = buildBoard(config, [
      card("Root", { status: "todo" }, ["Mid"]),
      card("Mid", { status: "doing" }, ["Leaf"]),
      card("Leaf", { status: "done" }),
    ]);
    // Only Root is top-level; Mid and Leaf are nested at depth 1 and 2.
    expect(b.columns["todo"]).toEqual(["Tasks/Root.md"]);
    expect(b.columns["doing"]).toEqual([]);
    expect(b.columns["done"]).toEqual([]);
    // The full chain is reachable via childrenOf so recursive rendering surfaces every card once.
    expect(b.childrenOf["Tasks/Root.md"]).toEqual(["Tasks/Mid.md"]);
    expect(b.childrenOf["Tasks/Mid.md"]).toEqual(["Tasks/Leaf.md"]);
  });

  it("does not infinite-loop on a cycle and leaves its members childless", () => {
    // A->B->C->A. buildBoard returns without hanging; cycle members have no genuine parent.
    const b = buildBoard(config, [
      card("A", { status: "todo" }, ["B"]),
      card("B", { status: "todo" }, ["C"]),
      card("C", { status: "todo" }, ["A"]),
    ]);
    expect((b.columns["todo"] ?? []).sort()).toEqual(["Tasks/A.md", "Tasks/B.md", "Tasks/C.md"]);
    expect(Object.keys(b.childrenOf)).toEqual([]);
  });
});

describe("ordering", () => {
  it("sorts unordered cards alphabetically", () => {
    const ranked = columnEffectiveOrders([card("Charlie"), card("Alpha"), card("Bravo")]);
    expect(ranked.map((r) => r.card.basename)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("places ordered cards first, then unordered alphabetically (no synthetic/real collisions)", () => {
    // D has order 1.5 (sorts first); A,B,C unordered get distinct effs beyond the max real order.
    const ranked = columnEffectiveOrders([
      card("A"),
      card("B"),
      card("C"),
      card("D", { order: 1.5 }),
    ]);
    expect(ranked.map((r) => r.card.basename)).toEqual(["D", "A", "B", "C"]);
    // every effective order is distinct, so a drop can never resolve to a duplicate rank
    expect(new Set(ranked.map((r) => r.eff)).size).toBe(ranked.length);
  });

  it("computeDropOrder returns midpoints / edges", () => {
    const cards = [card("A"), card("B"), card("C")]; // eff 0,1,2
    expect(computeDropOrder(cards, 0)).toBe(-1); // before A
    expect(computeDropOrder(cards, 1)).toBe(0.5); // between A,B
    expect(computeDropOrder(cards, 3)).toBe(3); // after C
    expect(computeDropOrder([], 0)).toBe(0); // empty column
  });

  it("a move writes exactly one order and lands in the right spot", () => {
    const cards = [card("A"), card("B"), card("C")];
    // move C to the very top of its column
    const b = buildBoard(
      config,
      cards.map((c) => ({ ...c, frontmatter: { status: "todo" } })),
    );
    const mut = moveCard(b, "Tasks/C.md", "todo", 0)!;
    expect(mut.setFrontmatter).toEqual({ status: "todo", order: -1 });
    // apply and rebuild: C now first
    const moved = cards.map((c) =>
      c.basename === "C"
        ? card("C", { status: "todo", order: -1 })
        : card(c.basename, { status: "todo" }),
    );
    expect(buildBoard(config, moved).columns["todo"]).toEqual([
      "Tasks/C.md",
      "Tasks/A.md",
      "Tasks/B.md",
    ]);
  });
});

describe("moveCard mutation", () => {
  const b = buildBoard(config, [card("A", { status: "todo" }), card("B", { status: "doing" })]);

  it("describes a cross-column move in history", () => {
    const mut = moveCard(b, "Tasks/A.md", "doing", 0)!;
    expect(mut.setFrontmatter?.status).toBe("doing");
    expect(mut.history).toBe("Moved from Todo to Doing");
  });

  it("describes a same-column reorder in history", () => {
    const mut = moveCard(b, "Tasks/A.md", "todo", 0)!;
    expect(mut.history).toBe("Reordered within Todo");
  });
});

describe("deriveContext (#14)", () => {
  it("returns the immediate subfolder for a card nested under the card folder", () => {
    expect(deriveContext("Tasks", "Tasks/Acme/Foo.md")).toBe("Acme");
  });
  it("returns undefined for a card sitting directly in the card folder", () => {
    expect(deriveContext("Tasks", "Tasks/Foo.md")).toBeUndefined();
  });
  it("returns only the FIRST subfolder for a deeply nested card", () => {
    expect(deriveContext("Tasks", "Tasks/Acme/Sub/Foo.md")).toBe("Acme");
  });
  it("takes the card folder as already resolved, so a trailing slash matches nothing", () => {
    // `readConfig` is the single place that turns the raw property into a path; tolerating a
    // second shape here would let a card's context depend on which spelling reached this far.
    expect(deriveContext("Tasks/", "Tasks/Acme/Foo.md")).toBeUndefined();
  });
  it("returns undefined for a path outside the card folder", () => {
    expect(deriveContext("Tasks", "Other/Acme/Foo.md")).toBeUndefined();
  });
});

describe("resolveCardFolder (#20260821.08)", () => {
  const board = "basic/Example Board.md";
  /** Resolve `value` against a vault where exactly `folders` exist. */
  const pick = (boardPath: string, value: string, folders: string[] = []) =>
    resolveCardFolder(boardPath, value, (p) => folders.includes(p));

  describe("which readings a value allows", () => {
    it("prefers the vault-root reading of a plain path, with the board note's as fallback", () => {
      expect(pick(board, "Cards", ["Cards", "basic/Cards"])?.existing).toEqual([
        "Cards",
        "basic/Cards",
      ]);
    });
    it("allows only the board-note reading for an explicitly relative path", () => {
      expect(pick(board, "./Cards", ["Cards", "basic/Cards"])?.existing).toEqual(["basic/Cards"]);
    });
    it("climbs out of the board's folder for a `..` path", () => {
      expect(pick("a/b/Board.md", "../shared/Cards")?.path).toBe("a/shared/Cards");
    });
    it("resolves `.` and `..` segments in the middle of a path", () => {
      expect(pick(board, "Area/./Cards")?.path).toBe("Area/Cards");
      expect(pick(board, "Area/Sub/../Cards")?.path).toBe("Area/Cards");
    });
    it("joins without a stray leading slash for a board note at the vault root", () => {
      expect(pick("Board.md", "./Cards")?.path).toBe("Cards");
    });
    it("ignores a trailing slash", () => {
      expect(pick("Board.md", "Cards/")?.path).toBe("Cards");
    });
    it("treats `..` as a whole segment, so a folder named `..foo` or `...` survives", () => {
      // A nested board note, so a mishandled `..` would visibly climb instead of collapsing into
      // the same string the vault-root reading produces.
      expect(pick(board, "..foo/Cards", ["basic/..foo/Cards"])?.path).toBe("basic/..foo/Cards");
      expect(pick(board, ".../Cards")?.path).toBe(".../Cards");
    });
    it("reads a bare `.` as the board note's own folder", () => {
      expect(pick(board, ".")?.path).toBe("basic");
    });
    it("keeps the board-note reading when only the vault-root one escapes", () => {
      // `x/../../y` climbs one level past the root from the root, but only back to `a/` from `a/b/`.
      expect(pick("a/b/Board.md", "x/../../y")?.path).toBe("a/y");
    });
    it("refuses a value that climbs above the vault root under every reading", () => {
      expect(pick(board, "../../Cards")).toBeNull();
    });
    it("refuses a root-anchored value rather than reading it as the board note's folder", () => {
      // `/` names the vault root under both readings only because it is refused outright: resolved
      // against the board note's folder it would otherwise come out as that folder, silently
      // turning "the whole vault" into "the folder this note happens to sit in".
      expect(pick(board, "/")).toBeNull();
      expect(pick(board, "")).toBeNull();
    });
    it("refuses a relative value that lands on the vault root", () => {
      expect(pick("Board.md", ".")).toBeNull();
      expect(pick("Board.md", "..")).toBeNull();
    });
  });

  describe("which reading wins", () => {
    it("takes the vault-root folder when it exists", () => {
      expect(pick(board, "Cards", ["Cards", "basic/Cards"])?.path).toBe("Cards");
    });
    it("falls back to the folder beside the board note when the root one isn't there", () => {
      expect(pick(board, "Cards", ["basic/Cards"])?.path).toBe("basic/Cards");
    });
    it("keeps the vault-root reading when neither exists, so the folder is still created there", () => {
      // The create-on-first-card story predates this: a board with no card folder yet must keep
      // creating it exactly where it always did, not silently move it beside the board note.
      expect(pick(board, "Cards")).toEqual({ path: "Cards", existing: [] });
    });
    it("stays with the board-note reading of a `./` path even when a root folder exists", () => {
      expect(pick(board, "./Cards", ["Cards"])).toEqual({ path: "basic/Cards", existing: [] });
    });
    it("reports both readings when both exist, so the caller can flag the ambiguity", () => {
      expect(pick(board, "Cards", ["Cards", "basic/Cards"])?.existing).toHaveLength(2);
    });
  });
});

describe("buildBoard context derivation (#14)", () => {
  it("sets card.context from the path and carries the contexts map", () => {
    const b = buildBoard(
      config,
      [
        {
          path: "Tasks/Acme/A.md",
          basename: "A",
          title: "A",
          titleSource: "filename",
          frontmatter: { status: "todo" },
          childLinks: [],
        },
        {
          path: "Tasks/B.md",
          basename: "B",
          title: "B",
          titleSource: "filename",
          frontmatter: { status: "todo" },
          childLinks: [],
        },
      ],
      {
        Acme: {
          name: "Acme Corp",
          color: "#5b8def",
          label: "client",
          body: "Home page",
          folder: "Acme",
        },
      },
    );
    expect(b.cards["Tasks/Acme/A.md"]?.context).toBe("Acme");
    expect(b.cards["Tasks/B.md"]?.context).toBeUndefined();
    expect(b.contexts["Acme"]?.name).toBe("Acme Corp");
    // A folder-context card is still bucketed by status, exactly like any other card.
    expect(b.columns["todo"]).toEqual(expect.arrayContaining(["Tasks/Acme/A.md", "Tasks/B.md"]));
  });
  it("defaults to an empty contexts map (boards with no subfolders behave as today)", () => {
    const b = buildBoard(config, [
      {
        path: "Tasks/B.md",
        basename: "B",
        title: "B",
        titleSource: "filename",
        frontmatter: { status: "todo" },
        childLinks: [],
      },
    ]);
    expect(b.contexts).toEqual({});
    expect(b.cards["Tasks/B.md"]?.context).toBeUndefined();
  });
});

describe("moveColumn", () => {
  const cols: ColumnDef[] = [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ];
  const ids = (c: ColumnDef[]) => c.map((x) => x.id);

  it("moves a column left to the slot held by the target", () => {
    expect(ids(moveColumn(cols, "done", "todo"))).toEqual(["done", "todo", "doing"]);
  });

  it("moves a column right to the slot held by the target", () => {
    expect(ids(moveColumn(cols, "todo", "done"))).toEqual(["doing", "done", "todo"]);
  });

  it("swaps two adjacent columns", () => {
    expect(ids(moveColumn(cols, "todo", "doing"))).toEqual(["doing", "todo", "done"]);
  });

  it("returns the input unchanged when dropped onto itself", () => {
    expect(moveColumn(cols, "doing", "doing")).toBe(cols);
  });

  it("returns the input unchanged for an unknown active or over id", () => {
    expect(moveColumn(cols, "ghost", "todo")).toBe(cols);
    expect(moveColumn(cols, "todo", "ghost")).toBe(cols);
  });

  it("does not mutate the input array", () => {
    const before = ids(cols);
    moveColumn(cols, "done", "todo");
    expect(ids(cols)).toEqual(before);
  });

  it("preserves the full ColumnDef (not just the id) when reordering", () => {
    const rich: ColumnDef[] = [
      { id: "a", title: "A", color: "#fff", limit: 3 },
      { id: "b", title: "B" },
    ];
    expect(moveColumn(rich, "b", "a")).toEqual([
      { id: "b", title: "B" },
      { id: "a", title: "A", color: "#fff", limit: 3 },
    ]);
  });
});

describe("card drag id namespacing (#2 — cross-board lane duplicate-id fix)", () => {
  it("round-trips a plain column + path", () => {
    const id = makeCardDragId("todo", "Tasks/Foo.md");
    expect(id).toBe("todo::Tasks/Foo.md");
    expect(splitCardDragId(id)).toEqual({ columnId: "todo", path: "Tasks/Foo.md" });
  });

  it("gives a card mirrored in two columns two distinct ids that parse to the same path", () => {
    const inStatus = makeCardDragId("todo", "Tasks/Research.md");
    const inLane = makeCardDragId("research", "Tasks/Research.md");
    expect(inStatus).not.toBe(inLane); // distinct sortable ids → no dnd-kit collision
    expect(splitCardDragId(inStatus).path).toBe("Tasks/Research.md");
    expect(splitCardDragId(inLane).path).toBe("Tasks/Research.md"); // both resolve to the real card
    expect(splitCardDragId(inStatus).columnId).toBe("todo");
    expect(splitCardDragId(inLane).columnId).toBe("research");
  });

  it("splits on the FIRST separator so a path containing '::' survives", () => {
    const id = makeCardDragId("todo", "Tasks/Weird::Name.md");
    expect(splitCardDragId(id)).toEqual({ columnId: "todo", path: "Tasks/Weird::Name.md" });
  });

  it("treats an un-namespaced id as a bare path (empty column)", () => {
    expect(splitCardDragId("Tasks/Foo.md")).toEqual({ columnId: "", path: "Tasks/Foo.md" });
  });
});

describe("planDrop (drag routing — #2 namespacing + #3 computed-order guard)", () => {
  const colIds = ["todo", "doing", "done"];

  it("routes a bare column active id to a column reorder", () => {
    const b = buildBoard(config, [card("A", { status: "todo" })]);
    expect(planDrop(b, "doing", "todo", colIds)).toEqual({
      kind: "reorderColumns",
      activeId: "doing",
      overId: "todo",
    });
  });

  it("unwraps a namespaced card drop onto a column to a card move with the real ids", () => {
    const b = buildBoard(config, [card("A", { status: "todo" })]);
    expect(planDrop(b, "todo::Tasks/A.md", "doing", colIds)).toEqual({
      kind: "moveCard",
      path: "Tasks/A.md",
      overId: "doing",
    });
  });

  it("unwraps a namespaced card dropped over another namespaced card to the bare over path", () => {
    const b = buildBoard(config, [card("A", { status: "todo" }), card("B", { status: "doing" })]);
    expect(planDrop(b, "todo::Tasks/A.md", "doing::Tasks/B.md", colIds)).toEqual({
      kind: "moveCard",
      path: "Tasks/A.md",
      overId: "Tasks/B.md",
    });
  });

  it("#3 no-ops a same-column reorder when the column is grouped (computed order)", () => {
    const cfg = {
      ...config,
      columns: [
        { id: "todo", title: "Todo", group: "due" as const },
        { id: "done", title: "Done" },
      ],
    };
    const b = buildBoard(cfg, [card("A", { status: "todo" }), card("B", { status: "todo" })]);
    // Same-column drop on a grouped column → no-op (the order is recomputed every render).
    expect(planDrop(b, "todo::Tasks/A.md", "todo::Tasks/B.md", ["todo", "done"])).toEqual({
      kind: "noop",
    });
  });

  it("#3 STILL allows a cross-column move out of a computed-order column", () => {
    const cfg = {
      ...config,
      columns: [
        { id: "todo", title: "Todo", sort: "priority" as const },
        { id: "done", title: "Done" },
      ],
    };
    const b = buildBoard(cfg, [card("A", { status: "todo" })]);
    expect(planDrop(b, "todo::Tasks/A.md", "done", ["todo", "done"])).toEqual({
      kind: "moveCard",
      path: "Tasks/A.md",
      overId: "done",
    });
  });

  it("#3 allows a same-column reorder on a plain (manual) column", () => {
    const b = buildBoard(config, [card("A", { status: "todo" }), card("B", { status: "todo" })]);
    expect(planDrop(b, "todo::Tasks/A.md", "todo::Tasks/B.md", colIds)).toEqual({
      kind: "moveCard",
      path: "Tasks/A.md",
      overId: "Tasks/B.md",
    });
  });
});

describe("applyReloc (live cross-column make-room reducer)", () => {
  // A bare columns map keyed by column id → ordered card paths (what buildBoard produces).
  const cols = (): Record<string, string[]> => ({
    todo: ["Tasks/A.md", "Tasks/B.md"],
    doing: ["Tasks/C.md", "Tasks/D.md"],
    done: [],
  });

  it("removes the active path from its source and inserts it BEFORE beforePath in the target", () => {
    const out = applyReloc(cols(), {
      activeId: "todo::Tasks/A.md",
      fromColumn: "todo",
      toColumn: "doing",
      beforePath: "Tasks/D.md",
    });
    expect(out["todo"]).toEqual(["Tasks/B.md"]); // A removed from source
    expect(out["doing"]).toEqual(["Tasks/C.md", "Tasks/A.md", "Tasks/D.md"]); // A inserted before D
  });

  it("appends to the target when beforePath is null (dropped on the column body)", () => {
    const out = applyReloc(cols(), {
      activeId: "todo::Tasks/A.md",
      fromColumn: "todo",
      toColumn: "doing",
      beforePath: null,
    });
    expect(out["doing"]).toEqual(["Tasks/C.md", "Tasks/D.md", "Tasks/A.md"]);
  });

  it("appends when beforePath is not present in the target (defensive)", () => {
    const out = applyReloc(cols(), {
      activeId: "todo::Tasks/A.md",
      fromColumn: "todo",
      toColumn: "doing",
      beforePath: "Tasks/ghost.md",
    });
    expect(out["doing"]).toEqual(["Tasks/C.md", "Tasks/D.md", "Tasks/A.md"]);
  });

  it("empties the source column when its last card moves out", () => {
    const out = applyReloc(
      { todo: ["Tasks/A.md"], doing: [] },
      {
        activeId: "todo::Tasks/A.md",
        fromColumn: "todo",
        toColumn: "doing",
        beforePath: null,
      },
    );
    expect(out["todo"]).toEqual([]);
    expect(out["doing"]).toEqual(["Tasks/A.md"]);
  });

  it("is idempotent against a board where the card has ALREADY landed (no duplicate)", () => {
    // The clearing effect fires only after the reloaded board renders, so there's a frame of
    // landed-board + stale reloc. Re-removing from every column first keeps that frame duplicate-free.
    const landed = { todo: ["Tasks/B.md"], doing: ["Tasks/C.md", "Tasks/A.md", "Tasks/D.md"] };
    const out = applyReloc(landed, {
      activeId: "todo::Tasks/A.md",
      fromColumn: "todo",
      toColumn: "doing",
      beforePath: "Tasks/D.md",
    });
    expect(out["todo"]).toEqual(["Tasks/B.md"]);
    expect(out["doing"]).toEqual(["Tasks/C.md", "Tasks/A.md", "Tasks/D.md"]); // A appears exactly once
  });

  it("returns the input untouched when there is no reloc", () => {
    const input = cols();
    expect(applyReloc(input, null)).toBe(input);
  });

  // Rule B (headless): the optimistic gap position (applyReloc's insertion index) must equal the
  // persisted landing index (resolveDrop's index) for the SAME `over`, or the card hops a slot on
  // reload. We derive both from the same beforePath/toColumn the drag drew the gap with.
  describe("Rule B — gap position == landed position", () => {
    const indexOfActiveAfterReloc = (
      columns: Record<string, string[]>,
      activeId: string,
      fromColumn: string,
      toColumn: string,
      beforePath: string | null,
    ) => {
      const out = applyReloc(columns, { activeId, fromColumn, toColumn, beforePath });
      const { path } = splitCardDragId(activeId);
      return (out[toColumn] ?? []).indexOf(path);
    };

    it("insert-before: applyReloc index === resolveDrop index", () => {
      const b = buildBoard(config, [
        card("A", { status: "todo", order: 1 }),
        card("C", { status: "doing", order: 1 }),
        card("D", { status: "doing", order: 2 }),
      ]);
      const gap = indexOfActiveAfterReloc(
        b.columns,
        "todo::Tasks/A.md",
        "todo",
        "doing",
        "Tasks/D.md",
      );
      const landed = resolveDrop(b, "Tasks/A.md", "Tasks/D.md");
      expect(landed).not.toBeNull();
      expect(gap).toBe(landed!.index);
    });

    it("append (over = column body): applyReloc index === resolveDrop index", () => {
      const b = buildBoard(config, [
        card("A", { status: "todo", order: 1 }),
        card("C", { status: "doing", order: 1 }),
        card("D", { status: "doing", order: 2 }),
      ]);
      const gap = indexOfActiveAfterReloc(b.columns, "todo::Tasks/A.md", "todo", "doing", null);
      const landed = resolveDrop(b, "Tasks/A.md", "doing");
      expect(gap).toBe(landed!.index);
    });

    it("empty target: applyReloc index === resolveDrop index (0)", () => {
      const b = buildBoard(config, [card("A", { status: "todo", order: 1 })]);
      const gap = indexOfActiveAfterReloc(b.columns, "todo::Tasks/A.md", "todo", "done", null);
      const landed = resolveDrop(b, "Tasks/A.md", "done");
      expect(gap).toBe(0);
      expect(landed!.index).toBe(0);
    });
  });

  it("cross-column INTO a computed-order column persists (planDrop is NOT a no-op there)", () => {
    const cfg = {
      ...config,
      columns: [
        { id: "todo", title: "Todo" },
        { id: "doing", title: "Doing", sort: "priority" as const },
      ],
    };
    const b = buildBoard(cfg, [card("A", { status: "todo" }), card("B", { status: "doing" })]);
    // A dragged from todo INTO the computed-order `doing` is a real move (only SAME-column reorder
    // no-ops on a computed column), so the status gets set even though the order is don't-care.
    const plan = planDrop(b, "todo::Tasks/A.md", "doing", ["todo", "doing"]);
    expect(plan).toEqual({ kind: "moveCard", path: "Tasks/A.md", overId: "doing" });
  });
});

describe("resolveDragReloc (live make-room gap decision)", () => {
  const colIds = ["todo", "doing", "done"];

  it("over a card in another column → insert before that card's path", () => {
    expect(resolveDragReloc("todo::Tasks/A.md", "doing::Tasks/B.md", colIds)).toEqual({
      activeId: "todo::Tasks/A.md",
      fromColumn: "todo",
      toColumn: "doing",
      beforePath: "Tasks/B.md",
    });
  });

  it("over another column's body → append (beforePath null)", () => {
    expect(resolveDragReloc("todo::Tasks/A.md", "doing", colIds)).toEqual({
      activeId: "todo::Tasks/A.md",
      fromColumn: "todo",
      toColumn: "doing",
      beforePath: null,
    });
  });

  it("same-column hover → null (native sortable owns the reorder, never overridden)", () => {
    expect(resolveDragReloc("todo::Tasks/A.md", "todo::Tasks/B.md", colIds)).toBeNull();
    expect(resolveDragReloc("todo::Tasks/A.md", "todo", colIds)).toBeNull();
  });

  it("a column-drag active id → null (column reorder, not a card move)", () => {
    expect(resolveDragReloc("doing", "todo", colIds)).toBeNull();
  });

  it("no target → null", () => {
    expect(resolveDragReloc("todo::Tasks/A.md", null, colIds)).toBeNull();
  });
});

describe("isComputedOrder (#6 — auto-sorted columns)", () => {
  const mk = (cols: ColumnDef[]) => buildBoard({ ...config, columns: cols }, []);
  it("is false for a plain column (no group, manual sort)", () => {
    expect(isComputedOrder(mk([{ id: "todo", title: "Todo" }]), "todo")).toBe(false);
  });
  it("is true when the column groups", () => {
    expect(isComputedOrder(mk([{ id: "todo", title: "Todo", group: "due" }]), "todo")).toBe(true);
  });
  it("is true when the column sorts non-manually", () => {
    expect(isComputedOrder(mk([{ id: "todo", title: "Todo", sort: "due" }]), "todo")).toBe(true);
  });
  it("is false for an unknown column", () => {
    expect(isComputedOrder(mk([{ id: "todo", title: "Todo" }]), "ghost")).toBe(false);
  });
});
