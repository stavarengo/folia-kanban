import { describe, it, expect } from "vitest";
import { FakeRepo } from "./fakeRepo";
import { resolveDrop, moveCard } from "../src/model/board";
import type { BoardConfig } from "../src/model/types";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

describe("drag persistence", () => {
  it("moving A onto C persists status, order, and a history line", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { type: "task", status: "todo" }, body: "\n# A\n" },
      "Tasks/B.md": { fm: { type: "task", status: "todo" }, body: "\n# B\n" },
      "Tasks/C.md": { fm: { type: "task", status: "doing" }, body: "\n# C\n" },
    });
    let board = await repo.loadBoard();
    const drop = resolveDrop(board, "Tasks/A.md", "Tasks/C.md")!;
    const mut = moveCard(board, "Tasks/A.md", drop.columnId, drop.index)!;
    await repo.applyMove(mut);

    board = await repo.loadBoard();
    expect(board.columns.doing).toContain("Tasks/A.md");
    expect(board.columns.todo).not.toContain("Tasks/A.md");
    expect(repo.files.get("Tasks/A.md")!.fm.status).toBe("doing");
    expect(repo.files.get("Tasks/A.md")!.body).toContain("## History");
    expect(repo.files.get("Tasks/A.md")!.body).toContain("Moved from Todo to Doing");
  });

  it("dropping on an empty column appends there", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { type: "task", status: "todo" }, body: "\n# A\n" },
    });
    let board = await repo.loadBoard();
    const drop = resolveDrop(board, "Tasks/A.md", "done")!; // over the column id
    const mut = moveCard(board, "Tasks/A.md", drop.columnId, drop.index)!;
    await repo.applyMove(mut);
    board = await repo.loadBoard();
    expect(board.columns.done).toEqual(["Tasks/A.md"]);
  });
});

describe("subcards", () => {
  it("addSubcard creates a child card and nests it out of the top level", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/P.md": { fm: { type: "task", status: "todo" }, body: "\n# P\n" },
    });
    const childPath = await repo.addSubcard("Tasks/P.md", "Kid");
    const board = await repo.loadBoard();
    expect(board.columns.todo).toEqual(["Tasks/P.md"]); // Kid is nested, not top-level
    expect(board.parentOf[childPath]).toBe("Tasks/P.md");
    // parent's body now links the child
    expect(repo.files.get("Tasks/P.md")!.body).toContain("[[Kid]]");
  });
});
