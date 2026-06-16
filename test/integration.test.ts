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

describe("comment edit/delete are byte-stable", () => {
  const bodyWith3 =
    "\n# A\n\n## Comments\n- [2026-06-13 10:00] one\n- [2026-06-13 11:00] two\n- [2026-06-13 12:00] three\n";

  it("updateComment edits comment 2 of 3, keeps timestamp, leaves every other byte identical", async () => {
    const repo = new FakeRepo(config, { "Tasks/A.md": { fm: { status: "todo" }, body: bodyWith3 } });
    await repo.updateComment("Tasks/A.md", 1, "edited two");
    const expected = bodyWith3.replace("- [2026-06-13 11:00] two", "- [2026-06-13 11:00] edited two");
    expect(repo.files.get("Tasks/A.md")!.body).toBe(expected);
  });

  it("removeComment removes only its line", async () => {
    const repo = new FakeRepo(config, { "Tasks/A.md": { fm: { status: "todo" }, body: bodyWith3 } });
    await repo.removeComment("Tasks/A.md", 0);
    const expected = bodyWith3.replace("- [2026-06-13 10:00] one\n", "");
    expect(repo.files.get("Tasks/A.md")!.body).toBe(expected);
  });
});

describe("unsetFrontmatterKey removes only that key", () => {
  it("drops the key and keeps the other keys", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { type: "task", status: "todo", area: "docs", priority: "B" }, body: "\n# A\n" },
    });
    await repo.unsetFrontmatterKey("Tasks/A.md", "area");
    const fm = repo.files.get("Tasks/A.md")!.fm;
    expect("area" in fm).toBe(false);
    expect(fm).toEqual({ type: "task", status: "todo", priority: "B" });
  });
});

describe("history seam — gated by scope (default 'moves' = no extra history)", () => {
  const seed = () => ({ "Tasks/A.md": { fm: { status: "todo" }, body: "\n# A\n" } });

  it("scope 'all': addComment appends exactly one History line, stable elsewhere", async () => {
    const repo = new FakeRepo(config, seed(), () => "all");
    await repo.addComment("Tasks/A.md", "hi");
    const body = repo.files.get("Tasks/A.md")!.body;
    expect(body.match(/## History/g)).toHaveLength(1);
    expect(body.match(/Comment added/g)).toHaveLength(1);
    expect(body).toContain("- [2026-06-13 12:00] hi"); // the comment itself, byte-stable
  });

  it("scope 'moves' (default): addComment appends NO history", async () => {
    const repo = new FakeRepo(config, seed()); // default getter
    await repo.addComment("Tasks/A.md", "hi");
    expect(repo.files.get("Tasks/A.md")!.body).not.toContain("## History");
  });

  it("scope 'structural': a priority change appends a line; 'moves' does not", async () => {
    const structural = new FakeRepo(config, seed(), () => "structural");
    await structural.setFrontmatter("Tasks/A.md", { priority: "high" });
    expect(structural.files.get("Tasks/A.md")!.body).toContain("Priority → high");

    const moves = new FakeRepo(config, seed());
    await moves.setFrontmatter("Tasks/A.md", { priority: "high" });
    expect(moves.files.get("Tasks/A.md")!.body).not.toContain("## History");
  });

  it("a move emits exactly one composed line even under scope 'all' — never per-key Status lines", async () => {
    // Pins the contract that moves are scope-independent: applyMove writes one "Moved …" line and
    // does NOT route its status/order through the gated setFrontmatter (which would add "Status →").
    const repo = new FakeRepo(
      config,
      {
        "Tasks/A.md": { fm: { type: "task", status: "todo" }, body: "\n# A\n" },
        "Tasks/C.md": { fm: { type: "task", status: "doing" }, body: "\n# C\n" },
      },
      () => "all",
    );
    const board = await repo.loadBoard();
    const drop = resolveDrop(board, "Tasks/A.md", "Tasks/C.md")!;
    await repo.applyMove(moveCard(board, "Tasks/A.md", drop.columnId, drop.index)!);
    const body = repo.files.get("Tasks/A.md")!.body;
    expect(body.match(/## History/g)).toHaveLength(1);
    expect(body).toContain("Moved from Todo to Doing");
    expect(body).not.toContain("Status →");
  });
});
