import { describe, it, expect } from "vitest";
import { buildBoard, columnEffectiveOrders, computeDropOrder, deriveContext, moveCard, moveColumn } from "../src/model/board";
import type { BoardConfig, Card, ColumnDef } from "../src/model/types";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

function card(basename: string, fm: Partial<Card["frontmatter"]> = {}, childLinks: string[] = []): Card {
  return { path: `Tasks/${basename}.md`, basename, frontmatter: fm, childLinks };
}

describe("buildBoard", () => {
  it("groups top-level cards by status into columns", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo" }),
      card("B", { status: "doing" }),
      card("C", { status: "done" }),
    ]);
    expect(b.columns.todo).toEqual(["Tasks/A.md"]);
    expect(b.columns.doing).toEqual(["Tasks/B.md"]);
    expect(b.columns.done).toEqual(["Tasks/C.md"]);
  });

  it("places cards with an unknown status into the first column (nothing lost)", () => {
    const b = buildBoard(config, [card("X", { status: "weird" })]);
    expect(b.columns.todo).toEqual(["Tasks/X.md"]);
  });

  it("excludes subcards (linked by a parent) from the board top level", () => {
    const b = buildBoard(config, [
      card("Parent", { status: "todo" }, ["Child"]),
      card("Child", { status: "todo" }),
    ]);
    expect(b.columns.todo).toEqual(["Tasks/Parent.md"]); // Child is nested, not top-level
    expect(b.parentOf["Tasks/Child.md"]).toBe("Tasks/Parent.md");
  });

  it("surfaces cards in a mutual/cyclic subcard link as top-level instead of dropping them", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo" }, ["B"]),
      card("B", { status: "todo" }, ["A"]), // A<->B cycle: neither has a real top-level root
    ]);
    expect(b.columns.todo.sort()).toEqual(["Tasks/A.md", "Tasks/B.md"]); // nothing vanishes
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
    expect(b.childrenOf["Tasks/Parent.md"]).toEqual(["Tasks/Echo.md", "Tasks/Yankee.md", "Tasks/Zeta.md"]);
  });

  it("nests a grandchild under its parent and keeps it out of every column", () => {
    const b = buildBoard(config, [
      card("Root", { status: "todo" }, ["Mid"]),
      card("Mid", { status: "doing" }, ["Leaf"]),
      card("Leaf", { status: "done" }),
    ]);
    // Only Root is top-level; Mid and Leaf are nested at depth 1 and 2.
    expect(b.columns.todo).toEqual(["Tasks/Root.md"]);
    expect(b.columns.doing).toEqual([]);
    expect(b.columns.done).toEqual([]);
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
    expect(b.columns.todo.sort()).toEqual(["Tasks/A.md", "Tasks/B.md", "Tasks/C.md"]);
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
    const ranked = columnEffectiveOrders([card("A"), card("B"), card("C"), card("D", { order: 1.5 })]);
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
    const b = buildBoard(config, cards.map((c) => ({ ...c, frontmatter: { status: "todo" } })));
    const mut = moveCard(b, "Tasks/C.md", "todo", 0)!;
    expect(mut.setFrontmatter).toEqual({ status: "todo", order: -1 });
    // apply and rebuild: C now first
    const moved = cards.map((c) =>
      c.basename === "C" ? card("C", { status: "todo", order: -1 }) : card(c.basename, { status: "todo" }),
    );
    expect(buildBoard(config, moved).columns.todo).toEqual(["Tasks/C.md", "Tasks/A.md", "Tasks/B.md"]);
  });
});

describe("moveCard mutation", () => {
  const b = buildBoard(config, [
    card("A", { status: "todo" }),
    card("B", { status: "doing" }),
  ]);

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
  it("tolerates a trailing slash on the card folder", () => {
    expect(deriveContext("Tasks/", "Tasks/Acme/Foo.md")).toBe("Acme");
  });
  it("returns undefined for a path outside the card folder", () => {
    expect(deriveContext("Tasks", "Other/Acme/Foo.md")).toBeUndefined();
  });
});

describe("buildBoard context derivation (#14)", () => {
  it("sets card.context from the path and carries the contexts map", () => {
    const b = buildBoard(
      config,
      [
        { path: "Tasks/Acme/A.md", basename: "A", frontmatter: { status: "todo" }, childLinks: [] },
        { path: "Tasks/B.md", basename: "B", frontmatter: { status: "todo" }, childLinks: [] },
      ],
      { Acme: { name: "Acme Corp", color: "#5b8def", label: "client", body: "Home page", folder: "Acme" } },
    );
    expect(b.cards["Tasks/Acme/A.md"].context).toBe("Acme");
    expect(b.cards["Tasks/B.md"].context).toBeUndefined();
    expect(b.contexts.Acme.name).toBe("Acme Corp");
    // A folder-context card is still bucketed by status, exactly like any other card.
    expect(b.columns.todo).toEqual(expect.arrayContaining(["Tasks/Acme/A.md", "Tasks/B.md"]));
  });
  it("defaults to an empty contexts map (boards with no subfolders behave as today)", () => {
    const b = buildBoard(config, [
      { path: "Tasks/B.md", basename: "B", frontmatter: { status: "todo" }, childLinks: [] },
    ]);
    expect(b.contexts).toEqual({});
    expect(b.cards["Tasks/B.md"].context).toBeUndefined();
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
