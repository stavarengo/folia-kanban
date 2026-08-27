import { describe, it, expect } from "vitest";
import { moveCardOver, moveCardTo } from "../src/model/boardOps";
import { columnOf } from "../src/model/board";
import type { BoardConfig } from "../src/model/types";
import { FakeRepo } from "./fakeRepo";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto",
  priorities: [],
  relations: [],
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

function repoWithThreeTodoCards(): FakeRepo {
  return new FakeRepo(config, {
    "Tasks/A.md": { fm: { status: "todo", order: 1 }, body: "" },
    "Tasks/B.md": { fm: { status: "todo", order: 2 }, body: "" },
    "Tasks/C.md": { fm: { status: "todo", order: 3 }, body: "" },
  });
}

describe("moveCardTo", () => {
  it("appends to the target column when no index is given", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { status: "doing", order: 1 }, body: "" },
      "Tasks/B.md": { fm: { status: "doing", order: 2 }, body: "" },
      "Tasks/C.md": { fm: { status: "todo" }, body: "" },
    });
    expect(
      await moveCardTo(repo, await repo.loadBoard(), { path: "Tasks/C.md", columnId: "doing" }),
    ).toBe(true);
    const board = await repo.loadBoard();
    expect(board.columns["doing"]).toEqual(["Tasks/A.md", "Tasks/B.md", "Tasks/C.md"]);
  });

  it("places the card at the given slot, counted with the card itself taken out", async () => {
    const repo = repoWithThreeTodoCards();
    await moveCardTo(repo, await repo.loadBoard(), {
      path: "Tasks/C.md",
      columnId: "todo",
      index: 0,
    });
    expect((await repo.loadBoard()).columns["todo"]).toEqual([
      "Tasks/C.md",
      "Tasks/A.md",
      "Tasks/B.md",
    ]);
  });

  it("writes the same history line the board view used to produce", async () => {
    const repo = repoWithThreeTodoCards();
    await moveCardTo(repo, await repo.loadBoard(), { path: "Tasks/A.md", columnId: "done" });
    expect((await repo.readBody("Tasks/A.md")).history.map((h) => h.text)).toEqual([
      "Moved from Todo to Done",
    ]);
  });

  it("reports a card the board does not know, and writes nothing", async () => {
    const repo = repoWithThreeTodoCards();
    const board = await repo.loadBoard();
    expect(await moveCardTo(repo, board, { path: "Tasks/Ghost.md", columnId: "done" })).toBe(false);
  });
});

describe("moveCardOver", () => {
  it("inserts before the card it was dropped on", async () => {
    const repo = repoWithThreeTodoCards();
    await moveCardOver(repo, await repo.loadBoard(), {
      activeId: "Tasks/C.md",
      overId: "Tasks/A.md",
    });
    expect((await repo.loadBoard()).columns["todo"]).toEqual([
      "Tasks/C.md",
      "Tasks/A.md",
      "Tasks/B.md",
    ]);
  });

  it("appends when dropped on a column body", async () => {
    const repo = repoWithThreeTodoCards();
    await moveCardOver(repo, await repo.loadBoard(), { activeId: "Tasks/A.md", overId: "doing" });
    const board = await repo.loadBoard();
    expect(columnOf(board, "Tasks/A.md")).toBe("doing");
  });

  it("reports a drop that resolves to nothing", async () => {
    const repo = repoWithThreeTodoCards();
    const board = await repo.loadBoard();
    expect(await moveCardOver(repo, board, { activeId: "Tasks/A.md", overId: "nowhere" })).toBe(
      false,
    );
  });
});
