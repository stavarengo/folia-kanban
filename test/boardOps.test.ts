import { describe, it, expect } from "vitest";
import { moveCardOver, moveCardTo, setCardPriority, setSubtaskDone } from "../src/model/boardOps";
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

describe("setSubtaskDone", () => {
  function withClaimedLine(): FakeRepo {
    return new FakeRepo(
      { ...config, priorities: ["high"] },
      {
        "Tasks/A.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] Draft it [status:: doing]\n",
        },
      },
      () => "all",
      () => "",
    );
  }

  it("ticks the box", async () => {
    const repo = withClaimedLine();
    await setSubtaskDone(repo, await repo.loadBoard(), {
      path: "Tasks/A.md",
      index: 0,
      done: true,
    });
    expect((await repo.readBody("Tasks/A.md")).subtasks[0]?.done).toBe(true);
  });

  // The line claims a column; ticking it is also a statement about where the work now belongs, so
  // the claim must not go on saying "doing" about work that is finished.
  it("brings a line's column claim into step with its checkbox", async () => {
    const repo = withClaimedLine();
    await setSubtaskDone(repo, await repo.loadBoard(), {
      path: "Tasks/A.md",
      index: 0,
      done: true,
    });
    expect((await repo.readBody("Tasks/A.md")).subtasks[0]?.status).toBe("done");
  });
});

describe("setCardPriority", () => {
  function repoWithOneCard(): FakeRepo {
    return new FakeRepo(
      { ...config, priorities: ["high"] },
      {
        "Tasks/A.md": { fm: { status: "todo", order: 1 }, body: "" },
      },
    );
  }

  it("sets the value and teaches it to the board", async () => {
    const repo = repoWithOneCard();
    await setCardPriority(repo, { path: "Tasks/A.md", value: "urgent" }, ["high"]);
    expect((await repo.loadBoard()).cards["Tasks/A.md"]?.frontmatter.priority).toBe("urgent");
    expect(repo.config.priorities).toEqual(["high", "urgent"]);
  });

  // Clearing a priority removes the key outright rather than writing an empty one, so the card
  // reads as having no priority and its history gets no `Priority → ` line about nothing.
  it("clears the key on an empty value, and teaches the board nothing", async () => {
    const repo = repoWithOneCard();
    await setCardPriority(repo, { path: "Tasks/A.md", value: "urgent" }, ["high"]);
    await setCardPriority(repo, { path: "Tasks/A.md", value: "" }, ["high"]);
    expect((await repo.loadBoard()).cards["Tasks/A.md"]?.frontmatter.priority).toBeUndefined();
    expect(repo.config.priorities).toEqual(["high", "urgent"]);
  });

  it("does not lose a value the board already knew", async () => {
    const repo = repoWithOneCard();
    await setCardPriority(repo, { path: "Tasks/A.md", value: "later" }, ["high", "hand-written"]);
    expect(repo.config.priorities).toEqual(["high", "hand-written", "later"]);
  });
});
