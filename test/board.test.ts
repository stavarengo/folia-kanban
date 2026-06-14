import { describe, it, expect } from "vitest";
import {
  buildBoard,
  columnEffectiveOrders,
  computeDropOrder,
  childPaths,
  subtreePaths,
  moveCard,
} from "../src/model/board";
import type { BoardConfig, Card } from "../src/model/types";

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
    expect(childPaths(b, "Tasks/Parent.md")).toEqual(["Tasks/Child.md"]);
  });
});

describe("ordering", () => {
  it("sorts unordered cards alphabetically", () => {
    const ranked = columnEffectiveOrders([card("Charlie"), card("Alpha"), card("Bravo")]);
    expect(ranked.map((r) => r.card.basename)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("interleaves a fractional order among unordered cards", () => {
    // A,B,C unordered (eff 0,1,2); D has order 1.5 -> between B and C
    const ranked = columnEffectiveOrders([card("A"), card("B"), card("C"), card("D", { order: 1.5 })]);
    expect(ranked.map((r) => r.card.basename)).toEqual(["A", "B", "D", "C"]);
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

describe("cycle safety", () => {
  it("subtreePaths does not loop on a cycle", () => {
    const b = buildBoard(config, [
      card("A", { status: "todo" }, ["B"]),
      card("B", { status: "todo" }, ["A"]), // B links back to A
    ]);
    expect(subtreePaths(b, "Tasks/A.md").sort()).toEqual(["Tasks/A.md", "Tasks/B.md"]);
  });
});
