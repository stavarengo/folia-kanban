import { describe, it, expect } from "vitest";
import { FakeRepo } from "./fakeRepo";
import { makeTodoPath, resolveDrop, moveCard } from "../src/model/board";
import type { BoardConfig } from "../src/model/types";
import { BLOCKS } from "../src/model/relationships";

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
    expect(board.columns["doing"]).toContain("Tasks/A.md");
    expect(board.columns["todo"]).not.toContain("Tasks/A.md");
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
    expect(board.columns["done"]).toEqual(["Tasks/A.md"]);
  });
});

describe("subcards", () => {
  it("addSubcard creates a child card and nests it out of the top level", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/P.md": { fm: { type: "task", status: "todo" }, body: "\n# P\n" },
    });
    const childPath = await repo.addSubcard("Tasks/P.md", "Kid");
    const board = await repo.loadBoard();
    expect(board.columns["todo"]).toEqual(["Tasks/P.md"]); // Kid is nested, not top-level
    expect(board.parentOf[childPath]).toBe("Tasks/P.md");
    // parent's body now links the child
    expect(repo.files.get("Tasks/P.md")!.body).toContain("[[Kid]]");
  });
});

describe("comment edit/delete are byte-stable", () => {
  // Legacy [timestamp] lines, standing in for a note written before the current italic-prefix
  // format — edit/delete must keep working on them without migrating the prefix.
  const bodyWith3 =
    "\n# A\n\n## Comments\n- [2026-06-13 10:00] one\n- [2026-06-13 11:00] two\n- [2026-06-13 12:00] three\n";

  it("updateComment edits comment 2 of 3, keeps timestamp, leaves every other byte identical", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { status: "todo" }, body: bodyWith3 },
    });
    await repo.updateComment("Tasks/A.md", 1, "edited two");
    const expected = bodyWith3.replace(
      "- [2026-06-13 11:00] two",
      "- [2026-06-13 11:00] edited two",
    );
    expect(repo.files.get("Tasks/A.md")!.body).toBe(expected);
  });

  it("removeComment removes only its line", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { status: "todo" }, body: bodyWith3 },
    });
    await repo.removeComment("Tasks/A.md", 0);
    const expected = bodyWith3.replace("- [2026-06-13 10:00] one\n", "");
    expect(repo.files.get("Tasks/A.md")!.body).toBe(expected);
  });
});

describe("unsetFrontmatterKey removes only that key", () => {
  it("drops the key and keeps the other keys", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": {
        fm: { type: "task", status: "todo", area: "docs", priority: "B" },
        body: "\n# A\n",
      },
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
    expect(body).toContain("- _2026-06-13 12:00:_ hi"); // the comment itself, byte-stable
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

describe("contexts (#14)", () => {
  it("derives card.context from the subfolder and excludes _context.md as a card", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Acme/A.md": { fm: { type: "task", status: "todo" }, body: "\n# A\n" },
      "Tasks/Acme/_context.md": {
        fm: { "context-name": "Acme Corp", color: "#5b8def", label: "client" },
        body: "\n# Acme\nThe client home page.\n",
      },
      "Tasks/Loose.md": { fm: { type: "task", status: "todo" }, body: "\n# Loose\n" },
    });
    const board = await repo.loadBoard();
    // _context.md is config, never a phantom card.
    expect(board.cards["Tasks/Acme/_context.md"]).toBeUndefined();
    expect(board.columns["todo"]).not.toContain("Tasks/Acme/_context.md");
    // The real card derives its context from the folder; the loose card has none.
    expect(board.cards["Tasks/Acme/A.md"]?.context).toBe("Acme");
    expect(board.cards["Tasks/Loose.md"]?.context).toBeUndefined();
    expect(board.columns["todo"]).toEqual(
      expect.arrayContaining(["Tasks/Acme/A.md", "Tasks/Loose.md"]),
    );
  });

  it("loadContexts reads the _context.md frontmatter + body", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Acme/_context.md": {
        fm: { "context-name": "Acme Corp", color: "#5b8def", label: "client" },
        body: "\n# Acme\nThe client home page.\n",
      },
      "Tasks/Acme/A.md": { fm: { type: "task", status: "todo" }, body: "\n# A\n" },
    });
    const contexts = await repo.loadContexts();
    expect(contexts["Acme"]).toEqual({
      name: "Acme Corp",
      color: "#5b8def",
      label: "client",
      body: "\n# Acme\nThe client home page.\n",
      folder: "Acme",
    });
  });

  it("a subfolder without a _context.md is still a context (name = folder, no color/label)", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Beta/B.md": { fm: { type: "task", status: "todo" }, body: "\n# B\n" },
    });
    const contexts = await repo.loadContexts();
    expect(contexts["Beta"]).toEqual({ name: "Beta", body: "", folder: "Beta" });
    expect(contexts["Beta"]?.color).toBeUndefined();
    expect(contexts["Beta"]?.label).toBeUndefined();
  });

  it("a board with no subfolders has an empty contexts map (unchanged behavior)", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { type: "task", status: "todo" }, body: "\n# A\n" },
    });
    const board = await repo.loadBoard();
    expect(board.contexts).toEqual({});
  });
});

describe("subitem drag persistence", () => {
  it("drags an inline todo to another column by writing its own checklist line", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Root\n\n## Subtasks\n- [ ] Write the docs\n- [ ] Stay home\n",
      },
    });
    let board = await repo.loadBoard();
    // Nothing is placed yet — the board looks exactly as it did before subitems could move.
    expect(board.columns["doing"]).toEqual([]);

    const todoPath = makeTodoPath("Tasks/Root.md", 0);
    // The tile does not exist until the line claims a column (that first placement comes from the
    // context menu or the detail picker), so stand in for it here and drag from there on.
    const placed =
      "\n# Root\n\n## Subtasks\n- [ ] Write the docs [status:: doing]\n- [ ] Stay home\n";
    repo.files.get("Tasks/Root.md")!.body = placed;
    board = await repo.loadBoard();
    expect(board.columns["doing"]).toEqual([todoPath]);

    // Now drag it on to Done: the checkbox and the field are written together.
    const drop = resolveDrop(board, todoPath, "done")!;
    await repo.applyMove(moveCard(board, todoPath, drop.columnId, drop.index)!);
    board = await repo.loadBoard();
    expect(board.columns["done"]).toEqual([todoPath]);
    expect(repo.files.get("Tasks/Root.md")!.body).toContain("- [x] Write the docs [status:: done]");
    expect(repo.files.get("Tasks/Root.md")!.fm.status).toBe("todo"); // the parent has not moved
    expect(repo.files.get("Tasks/Root.md")!.body).toContain(
      'Moved subtask "Write the docs" from Doing to Done',
    );

    // And back to the parent's own column: the tile disappears, the todo is open again, and the
    // line stops claiming anything — a claim pinning it to its card's column would pop it back out
    // as its own tile the next time the card itself moved.
    const back = moveCard(board, todoPath, "todo", 0)!;
    await repo.applyMove(back);
    board = await repo.loadBoard();
    expect(board.columns["todo"]).toEqual(["Tasks/Root.md"]);
    expect(repo.files.get("Tasks/Root.md")!.body).toContain("- [ ] Write the docs\n");
    expect(repo.files.get("Tasks/Root.md")!.body).not.toContain("[status::");

    // Proof of the point: moving the CARD now takes the todo with it, instead of stranding it.
    await repo.applyMove(moveCard(board, "Tasks/Root.md", "doing", 0)!);
    board = await repo.loadBoard();
    expect(board.columns["doing"]).toEqual(["Tasks/Root.md"]);
    expect(board.columns["todo"]).toEqual([]);
  });

  it("drags a file subcard out of its parent's group into a column of its own", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/Root.md": {
        fm: { type: "task", status: "todo" },
        body: "\n# Root\n\n## Subtasks\n- [ ] [[Child]]\n",
      },
      "Tasks/Child.md": { fm: { type: "task" }, body: "\n# Child\n" },
    });
    let board = await repo.loadBoard();
    expect(board.childrenOf["Tasks/Root.md"]).toEqual(["Tasks/Child.md"]);

    const drop = resolveDrop(board, "Tasks/Child.md", "doing")!;
    await repo.applyMove(moveCard(board, "Tasks/Child.md", drop.columnId, drop.index)!);
    board = await repo.loadBoard();
    expect(board.columns["doing"]).toEqual(["Tasks/Child.md"]);
    expect(board.childrenOf["Tasks/Root.md"]).toBeUndefined();
    expect(board.parentOf["Tasks/Child.md"]).toBe("Tasks/Root.md");
    expect(repo.files.get("Tasks/Child.md")!.fm.status).toBe("doing");
  });
});
