import { describe, it, expect, vi } from "vitest";
import { moveCardOver, moveCardTo, setCardPriority, setSubtaskDone } from "../src/model/boardOps";
import { columnOf, makeTodoPath, moveSubtask } from "../src/model/board";
import type { SubItem } from "../src/model/types";
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

/** A checklist line as a caller read it: what the panel, the tool and the board all pass in. */
function todoLine(index: number, text: string, status?: string, done = false): SubItem {
  return status === undefined
    ? { kind: "todo", text, done, index }
    : { kind: "todo", text, done, status, index };
}

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
      line: todoLine(0, "Draft it", "doing"),
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
      line: todoLine(0, "Draft it", "doing"),
      done: true,
    });
    expect((await repo.readBody("Tasks/A.md")).subtasks[0]?.status).toBe("done");
  });
});

describe("setSubtaskDone when the note has moved on", () => {
  const claimedLine = () =>
    new FakeRepo(
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

  // Ticking a claimed line is two writes, and they must stand or fall together: a box written while
  // the claim is refused leaves the note saying the work is finished and still in Doing.
  it("writes both halves when board, caller and note read the same line", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Draft it", "doing"),
      done: true,
    });

    const line = (await repo.readBody("Tasks/A.md")).subtasks[0];
    expect(line).toMatchObject({ text: "Draft it", done: true, status: "done" });
  });

  // A board one reload behind is not a reason to refuse a write the note itself accepts, nor to
  // decide it: both halves are read off the line the caller is looking at.
  it("writes both halves from the caller's reading when the board is behind", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();
    // Reworded from elsewhere after the board was read; the caller names the current wording.
    repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it now [status:: doing]\n";

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Draft it now", "doing"),
      done: true,
    });

    expect((await repo.readBody("Tasks/A.md")).subtasks[0]).toMatchObject({
      text: "Draft it now",
      done: true,
      status: "done",
    });
  });

  // The shape that matters most, because it is the one a person sees: unticking a line that claims
  // Done has to drop the claim, or the todo goes on standing in the Done column after the untick.
  it("drops a Done claim on an untick even when the board never read that line", async () => {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/A.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [x] Alpha [status:: done]\n- [x] Beta [status:: done]\n",
        },
      },
      () => "all",
      () => "",
    );
    const board = await repo.loadBoard();
    // The panel removed Alpha a moment ago; the board has not caught up, the note has.
    await repo.removeSubtask("Tasks/A.md", { index: 0, text: "Alpha" });

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Beta", "done", true),
      done: false,
    });

    // Unticked AND unclaimed: it goes back to living with its card instead of standing in Done.
    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [ ] Beta\n");
    expect((await repo.readBody("Tasks/A.md")).subtasks[0]?.status).toBeUndefined();
  });

  // The fourth case, and the one a board built from the same store cannot show by itself: a line
  // added since the board was drawn, named from a fresh read of the note, claiming nothing.
  it("ticks a line the board has never seen at all", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();
    await repo.addTodo("Tasks/A.md", "Two");

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(1, "Two"),
      done: true,
    });

    expect((await repo.readBody("Tasks/A.md")).subtasks.map((s) => s.done)).toEqual([false, true]);
  });

  it("writes neither half when the caller names a line the note no longer holds", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();
    repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it now [status:: doing]\n";
    const before = repo.files.get("Tasks/A.md")!.body;

    await expect(
      setSubtaskDone(repo, board, {
        path: "Tasks/A.md",
        line: todoLine(0, "Draft it", "doing"),
        done: true,
      }),
    ).rejects.toThrow(/no longer reads "Draft it"/);

    expect(repo.files.get("Tasks/A.md")!.body).toBe(before);
  });

  // The claim half is not decided from the caller's reading at all: it is worked out from the claim
  // the note carries when the write lands. So a line somebody moved to another column is still sent
  // to Done by a tick, from wherever it is now.
  it("ticks a line somebody moved to another column, and sends it to Done from there", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();
    // Another pane, another app, or a sync pull, after the board drew the line.
    repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it [status:: review]\n";

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Draft it", "doing"),
      done: true,
    });

    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [x] Draft it [status:: done]");
  });

  // The case a decision taken from the caller's reading gets wrong, and the reason this one is not:
  // read as claiming Doing, this untick has nothing to keep in step and would leave an unticked
  // line standing in Done for good. Read from the note, it is a line claiming Done being reopened.
  it("clears a claim that reached Done after the board read the line", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();
    repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [x] Draft it [status:: done]\n";

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Draft it", "doing", true),
      done: false,
    });

    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [ ] Draft it\n");
    expect((await repo.readBody("Tasks/A.md")).subtasks[0]?.status).toBeUndefined();
  });

  // The mirror of it: a line that has stopped claiming anything is not placed work, and a tick must
  // not hand it a column nobody chose. The box is written and the claim left absent.
  it("ticks a line that has come home since it was read, without placing it anywhere", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();
    repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it\n";

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Draft it", "doing"),
      done: true,
    });

    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [x] Draft it\n");
    expect(repo.files.get("Tasks/A.md")!.body).not.toContain("[status::");
  });

  // And a line that has GAINED a claim is kept in step by the same rule, though the reading behind
  // the click knew of no claim to keep: a finished line goes to Done from wherever it now stands.
  it("keeps a claim added since the board read the line in step with the box", async () => {
    const repo = claimedLine();
    const board = await repo.loadBoard();
    await repo.addTodo("Tasks/A.md", "Two");
    repo.files.get("Tasks/A.md")!.body = repo.files
      .get("Tasks/A.md")!
      .body.replace("- [ ] Two", "- [ ] Two [status:: doing]");

    await setSubtaskDone(repo, board, { path: "Tasks/A.md", line: todoLine(1, "Two"), done: true });

    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [x] Two [status:: done]");
  });

  // Both halves of the rule come from the note, not one from the note and one from the click: a box
  // somebody has flipped back in the moment between the two writes decides the claim, so a tick
  // whose box no longer stands cannot file the line under Done on its way past.
  it("follows the box the note has now, not the one the click asked for", async () => {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/A.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] Draft it\n",
        },
      },
      () => "all",
      () => "",
    );
    const board = await repo.loadBoard();
    const toggle = repo.toggleSubtask.bind(repo);
    vi.spyOn(repo, "toggleSubtask").mockImplementation(async (path, at, done) => {
      await toggle(path, at, done);
      // Somebody places the todo in Doing — and reopens it — right after the box is written.
      repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it [status:: doing]\n";
    });

    await setSubtaskDone(repo, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Draft it"),
      done: true,
    });

    // The claim stays where that move put it; a rule half-read from the click would say Done.
    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [ ] Draft it [status:: doing]");
  });

  it("writes no claim at all on a board with no done column", async () => {
    const noDone = new FakeRepo(
      { ...config, columns: config.columns.filter((c) => c.id !== "done") },
      {
        "Tasks/A.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] Draft it [status:: doing]\n",
        },
      },
      () => "all",
      () => "",
    );
    const board = await noDone.loadBoard();
    noDone.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it [status:: review]\n";

    await setSubtaskDone(noDone, board, {
      path: "Tasks/A.md",
      line: todoLine(0, "Draft it", "doing"),
      done: true,
    });

    // "Finished work belongs in the done column" names nowhere here, so the claim is left as it is.
    expect(noDone.files.get("Tasks/A.md")!.body).toContain("- [x] Draft it [status:: review]");
  });

  // A line naming a child note keeps its column in the child's own frontmatter, so a field typed
  // onto such a line is not a claim anybody decided from — and must not refuse the tick.
  it("ticks a line naming a child note whatever field somebody typed onto it", async () => {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/A.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] [[B]] [status:: doing]\n",
        },
        "Tasks/B.md": { fm: { status: "todo", order: 1 }, body: "" },
      },
      () => "all",
      () => "",
    );
    const board = await repo.loadBoard();
    const line = board.cards["Tasks/A.md"]?.subItems?.[0];

    await setSubtaskDone(repo, board, { path: "Tasks/A.md", line: line!, done: true });

    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [x] [[B]] [status:: doing]");
    expect((await repo.loadBoard()).cards["Tasks/B.md"]?.frontmatter.status).toBe("done");
  });
});

// The other two ways a placed todo changes column: dragging its tile, and picking a column from the
// detail panel's dropdown. Here the column is chosen by hand rather than worked out from the line,
// so the value it replaces IS what the person chose against: both name the claim they were shown
// and refuse rather than write over a value somebody else set in the meantime.
describe("moving a placed todo whose claim has moved underneath", () => {
  const placedTodo = () =>
    new FakeRepo(
      config,
      {
        "Tasks/A.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] Draft it [status:: doing]\n",
        },
      },
      () => "all",
      () => "",
    );

  it("refuses the drag, and leaves the line exactly as the note has it", async () => {
    const repo = placedTodo();
    const board = await repo.loadBoard();
    repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it [status:: review]\n";
    const before = repo.files.get("Tasks/A.md")!.body;

    // Released over the Done column, the way a finished drag arrives from the board view.
    await expect(
      moveCardOver(repo, board, { activeId: makeTodoPath("Tasks/A.md", 0), overId: "done" }),
    ).rejects.toThrow(/now claims "review" where this write replaces "doing"/);

    expect(repo.files.get("Tasks/A.md")!.body).toBe(before);
  });

  it("refuses the panel's column dropdown the same way", async () => {
    const repo = placedTodo();
    const board = await repo.loadBoard();
    repo.files.get("Tasks/A.md")!.body = "\n## Subtasks\n\n- [ ] Draft it [status:: review]\n";
    const before = repo.files.get("Tasks/A.md")!.body;

    // What the dropdown does: the same reducer, applied straight to the repository.
    const mutation = moveSubtask(board, "Tasks/A.md", { index: 0 }, "done");
    await expect(repo.applyMove(mutation!)).rejects.toThrow(
      /now claims "review" where this write replaces "doing"/,
    );

    expect(repo.files.get("Tasks/A.md")!.body).toBe(before);
  });

  it("still writes when the note claims what the board read there", async () => {
    const repo = placedTodo();
    const board = await repo.loadBoard();

    expect(
      await moveCardTo(repo, board, { path: makeTodoPath("Tasks/A.md", 0), columnId: "done" }),
    ).toBe(true);

    expect(repo.files.get("Tasks/A.md")!.body).toContain("- [x] Draft it [status:: done]");
  });
});

describe("setSubtaskDone when the note changes between its two writes", () => {
  // The halves name one line, which is not the same as being one write: a note edited in the gap
  // can have the claim refused after the box has landed, and the caller is told exactly that.
  it("names the half that landed when the other is refused", async () => {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/A.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] Draft it [status:: doing]\n",
        },
      },
      () => "all",
      () => "",
    );
    const board = await repo.loadBoard();
    const toggle = repo.toggleSubtask.bind(repo);
    vi.spyOn(repo, "toggleSubtask").mockImplementation(async (path, at, done) => {
      await toggle(path, at, done);
      const e = repo.files.get("Tasks/A.md")!;
      // Someone adds a line above it in the moment after the box is written.
      e.body = e.body.replace("## Subtasks\n\n", "## Subtasks\n\n- [ ] Snuck in\n");
    });

    await expect(
      setSubtaskDone(repo, board, {
        path: "Tasks/A.md",
        line: todoLine(0, "Draft it", "doing"),
        done: true,
      }),
    ).rejects.toThrow(/The checkbox was written; keeping the line's own column claim in step/);
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
    await setCardPriority(repo, { path: "Tasks/A.md", value: "urgent" });
    expect((await repo.loadBoard()).cards["Tasks/A.md"]?.frontmatter.priority).toBe("urgent");
    expect(repo.config.priorities).toEqual(["high", "urgent"]);
  });

  // Clearing a priority removes the key outright rather than writing an empty one, so the card
  // reads as having no priority and its history gets no `Priority → ` line about nothing.
  it("clears the key on an empty value, and teaches the board nothing", async () => {
    const repo = repoWithOneCard();
    await setCardPriority(repo, { path: "Tasks/A.md", value: "urgent" });
    await setCardPriority(repo, { path: "Tasks/A.md", value: "" });
    expect((await repo.loadBoard()).cards["Tasks/A.md"]?.frontmatter.priority).toBeUndefined();
    expect(repo.config.priorities).toEqual(["high", "urgent"]);
  });

  it("does not lose a value the note already remembered", async () => {
    const repo = repoWithOneCard();
    await setCardPriority(repo, { path: "Tasks/A.md", value: "later" });
    expect(repo.config.priorities).toEqual(["high", "later"]);
  });

  // The deliberate cost of the rule above, pinned so it is a choice and not a surprise: a word
  // that was only ever hand-written into a card is not written into the note by the edit that
  // takes it off that card. Remembering it there would mean ranking it against the word that just
  // replaced it, which is a scale nobody authored — and the user has just removed the word from
  // the board. Anything ever set through the UI is already in the note and is untouched by this.
  it("does not write down a hand-written word the edit is taking off the card", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { status: "todo", order: 1, priority: "blocker" }, body: "" },
    });
    await setCardPriority(repo, { path: "Tasks/A.md", value: "urgent" });
    expect(repo.config.priorities).toEqual(["urgent"]);
  });

  // The point of the whole change: the note's order is a ranking, so one edit may only ever add
  // the word that was chosen. The values the other cards happen to carry stay suggestions until
  // someone picks them — writing them in would rank `later` above `soon` on spelling alone.
  it("learns only the value being set, never what the other cards happen to carry", async () => {
    const repo = new FakeRepo(config, {
      "Tasks/A.md": { fm: { status: "todo", order: 1, priority: "later" }, body: "" },
      "Tasks/B.md": { fm: { status: "todo", order: 2, priority: "soon" }, body: "" },
    });
    await setCardPriority(repo, { path: "Tasks/B.md", value: "now" });
    expect(repo.config.priorities).toEqual(["now"]);
  });
});
