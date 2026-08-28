import { describe, it, expect } from "vitest";
import { TOOLS } from "../src/mcp/tools";
import { handleMessage, type ServerInfo } from "../src/mcp/protocol";
import type { BoardHost } from "../src/mcp/host";
import type { BoardConfig, HistoryScope } from "../src/model/types";
import { FakeRepo } from "./fakeRepo";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto",
  priorities: ["high"],
  relations: [],
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
    { id: "done", title: "Done" },
  ],
};

const INFO: ServerInfo = { name: "folia-kanban", title: "Folia Kanban", version: "0.0.0" };

interface Fixture {
  host: BoardHost;
  repo: FakeRepo;
}

function fixture(options: { scope?: HistoryScope; userName?: string } = {}): Fixture {
  const repo = new FakeRepo(
    config,
    {
      "Tasks/Write docs.md": { fm: { status: "todo", order: 1 }, body: "The docs.\n" },
      "Tasks/Ship it.md": { fm: { status: "todo", order: 2 }, body: "" },
      "Tasks/Old thing.md": { fm: { status: "done", order: 1 }, body: "" },
    },
    () => options.scope ?? "all",
    () => options.userName ?? "",
  );
  const host: BoardHost = {
    listBoards: () => [{ path: "Board.md", name: "Board" }],
    repoFor: (path) => (path === "Board.md" ? repo : null),
  };
  return { host, repo };
}

async function call(host: BoardHost, name: string, args: unknown): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return await tool.invoke(host, args);
}

describe("the tool surface", () => {
  it("publishes a JSON Schema for every tool", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema["type"], tool.name).toBe("object");
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
    }
  });

  it("lists the vault's boards", async () => {
    const { host } = fixture();
    expect(await call(host, "list_boards", {})).toEqual({
      boards: [{ path: "Board.md", name: "Board" }],
    });
  });

  it("reads a board's columns in the order the board shows them", async () => {
    const { host } = fixture();
    const result = (await call(host, "get_board", { board: "Board.md" })) as {
      columns: { id: string; cards: { path: string }[] }[];
    };
    expect(result.columns.map((c) => c.id)).toEqual(["todo", "doing", "done"]);
    expect(result.columns[0]?.cards.map((c) => c.path)).toEqual([
      "Tasks/Write docs.md",
      "Tasks/Ship it.md",
    ]);
  });

  it("reads one card in full", async () => {
    const { host } = fixture();
    const card = (await call(host, "get_card", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
    })) as { column: string; description: string };
    expect(card.column).toBe("todo");
    expect(card.description).toBe("The docs.");
  });

  it("accepts a card's title where a path is expected", async () => {
    const { host } = fixture();
    const card = (await call(host, "get_card", { board: "Board.md", card: "Ship it" })) as {
      path: string;
    };
    expect(card.path).toBe("Tasks/Ship it.md");
  });

  it("names the boards it knows when asked for one it does not", async () => {
    const { host } = fixture();
    await expect(call(host, "get_board", { board: "Nope.md" })).rejects.toThrow(/Board\.md/);
  });

  it("refuses arguments that do not match the schema", async () => {
    const { host } = fixture();
    await expect(call(host, "move_card", { board: "Board.md", card: "x" })).rejects.toThrow(
      /column/,
    );
  });
});

describe("writing through the tools", () => {
  it("creates a card in a column, with its optional fields", async () => {
    const { host, repo } = fixture();
    const created = (await call(host, "create_card", {
      board: "Board.md",
      title: "New work",
      column: "doing",
      description: "Some detail.",
      due: "2026-09-01",
      priority: "urgent",
    })) as { path: string };
    const board = await repo.loadBoard();
    expect(board.columns["doing"]).toEqual([created.path]);
    expect(board.cards[created.path]?.frontmatter).toMatchObject({
      status: "doing",
      due: "2026-09-01",
      priority: "urgent",
    });
    expect((await repo.readBody(created.path)).description).toBe("Some detail.");
    // The board learns the value, exactly as setting a priority in the panel does.
    expect(repo.config.priorities).toContain("urgent");
  });

  it("refuses a column the board does not have, and names the ones it does", async () => {
    const { host } = fixture();
    await expect(
      call(host, "create_card", { board: "Board.md", title: "x", column: "nope" }),
    ).rejects.toThrow(/todo, doing, done/);
  });

  it("moves a card and records the move in its history, the way a drag does", async () => {
    const { host, repo } = fixture();
    const moved = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      column: "done",
      position: 0,
    })) as { column: string; position: number };
    expect(moved).toEqual({
      path: "Tasks/Ship it.md",
      column: "done",
      position: 0,
    });
    expect((await repo.readBody("Tasks/Ship it.md")).history.map((h) => h.text)).toEqual([
      "Moved from Todo to Done",
    ]);
  });

  it("updates fields and writes the same history lines the panel writes", async () => {
    const { host, repo } = fixture();
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
      priority: "high",
      due: "2026-09-09",
      properties: { area: "docs" },
    });
    const card = (await repo.loadBoard()).cards["Tasks/Write docs.md"];
    expect(card?.frontmatter).toMatchObject({ priority: "high", due: "2026-09-09", area: "docs" });
    expect((await repo.readBody("Tasks/Write docs.md")).history.map((h) => h.text)).toEqual([
      "Priority → high",
      "Due → 2026-09-09",
    ]);
  });

  it("clears a field asked to be null", async () => {
    const { host, repo } = fixture();
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
      priority: "high",
    });
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
      priority: null,
    });
    expect((await repo.loadBoard()).cards["Tasks/Write docs.md"]?.frontmatter.priority).toBe(
      undefined,
    );
  });

  it("sends a column change to move_card instead of writing status by hand", async () => {
    const { host } = fixture();
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Write docs.md",
        properties: { status: "done" },
      }),
    ).rejects.toThrow(/move_card/);
  });

  it("refuses an update that changes nothing", async () => {
    const { host } = fixture();
    await expect(
      call(host, "update_card", { board: "Board.md", card: "Tasks/Write docs.md" }),
    ).rejects.toThrow(/at least one field/);
  });

  it("signs a comment with the name the plugin's settings hold", async () => {
    const { host, repo } = fixture({ userName: "rafa" });
    await call(host, "add_comment", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
      text: "On it.",
    });
    const comments = (await repo.readBody("Tasks/Write docs.md")).comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]?.author).toBe("rafa");
  });

  it("writes no comment history when the history scope does not cover comments", async () => {
    const { host, repo } = fixture({ scope: "moves" });
    await call(host, "add_comment", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
      text: "Quiet.",
    });
    expect((await repo.readBody("Tasks/Write docs.md")).history).toEqual([]);
  });

  it("adds a subtask and ticks it, history line and all", async () => {
    const { host, repo } = fixture();
    const added = (await call(host, "add_subtask", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
      text: "Draft it",
    })) as { index: number };
    await call(host, "set_subtask_done", {
      board: "Board.md",
      card: "Tasks/Write docs.md",
      index: added.index,
      done: true,
    });
    const body = await repo.readBody("Tasks/Write docs.md");
    expect(body.subtasks[0]).toMatchObject({ text: "Draft it", done: true });
    expect(body.history.map((h) => h.text)).toEqual([
      "Subtask added: Draft it",
      "Subtask done: Draft it",
    ]);
  });

  it("says how many subtasks there are when asked for one that is not there", async () => {
    const { host } = fixture();
    await expect(
      call(host, "set_subtask_done", {
        board: "Board.md",
        card: "Tasks/Write docs.md",
        index: 4,
        done: true,
      }),
    ).rejects.toThrow(/no subtask 4/);
  });
});

describe("the JSON-RPC layer", () => {
  const send = async (message: unknown) => {
    const { host } = fixture();
    return await handleMessage(host, INFO, message);
  };

  it("answers initialize with the protocol version and the tool capability", async () => {
    const reply = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(reply).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: INFO },
    });
  });

  it("lists every tool with its schema", async () => {
    const reply = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (reply?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });

  it("returns a tool's result as one text block", async () => {
    const reply = await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_boards", arguments: {} },
    });
    const result = reply?.result as { content: { type: string; text: string }[]; isError: boolean };
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      boards: [{ path: "Board.md", name: "Board" }],
    });
  });

  it("hands a tool failure back to the model rather than to the transport", async () => {
    const reply = await send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_board", arguments: { board: "Missing.md" } },
    });
    expect(reply?.error).toBeUndefined();
    expect(reply?.result).toMatchObject({ isError: true });
  });

  it("refuses an unknown tool as a protocol error", async () => {
    const reply = await send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "delete_everything" },
    });
    expect(reply?.error?.code).toBe(-32602);
  });

  it("refuses an unknown method", async () => {
    const reply = await send({ jsonrpc: "2.0", id: 6, method: "resources/list" });
    expect(reply?.error?.code).toBe(-32601);
  });

  it("answers a notification with nothing at all", async () => {
    expect(await send({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  // JSON-RPC calls a message a notification when it carries no `id` member at all. `"id": null` is
  // a request — a malformed one, and one some client libraries send by accident. Treating it as a
  // notification carried the write out and then said nothing, so the board changed under an agent
  // that was never told it had.
  it("answers a request whose id is null, rather than writing in silence", async () => {
    const { host, repo } = fixture();
    const reply = await handleMessage(host, INFO, {
      jsonrpc: "2.0",
      id: null,
      method: "tools/call",
      params: {
        name: "move_card",
        arguments: { board: "Board.md", card: "Tasks/Ship it.md", column: "done" },
      },
    });
    expect(reply).not.toBeNull();
    expect(reply?.id).toBeNull();
    expect((await repo.loadBoard()).cards["Tasks/Ship it.md"]?.frontmatter.status).toBe("done");
  });

  // A client matches a reply to its call by id. Answering `null` to a malformed request hands it
  // an error it cannot attribute to anything it sent — the one failure it most needs to place.
  it("keeps the id of a malformed request, so the client can place the error", async () => {
    const reply = await send({ jsonrpc: "2.0", id: 7, method: 123 });
    expect(reply?.id).toBe(7);
    expect(reply?.error?.code).toBe(-32600);
  });

  it("still answers with a null id when the request carries none it can use", async () => {
    const reply = await send({ hello: "there" });
    expect(reply?.id).toBeNull();
  });

  it("answers ping", async () => {
    const reply = await send({ jsonrpc: "2.0", id: 7, method: "ping" });
    expect(reply?.result).toEqual({});
  });

  it("refuses a message that is not JSON-RPC", async () => {
    const reply = await send({ hello: "there" });
    expect(reply?.error?.code).toBe(-32600);
  });
});

// Everything below was found by an unprimed review of the first version of this server: each one
// is a way an agent was handed a board that did not match the board.
describe("the shapes a board can take that a column listing hides", () => {
  /** A parent whose child sits in the same column: the board draws the child inside the parent, so
   *  the child is in no column of its own. */
  function nested(): Fixture {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/Parent.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] [[Child]]\n",
        },
        "Tasks/Child.md": { fm: { status: "todo", order: 1 }, body: "" },
      },
      () => "all",
      () => "",
    );
    return {
      repo,
      host: {
        listBoards: () => [{ path: "Board.md", name: "Board" }],
        repoFor: (path) => (path === "Board.md" ? repo : null),
      },
    };
  }

  it("reports a nested subcard under its parent, so no card is missing from the board", async () => {
    const { host } = nested();
    const result = (await call(host, "get_board", { board: "Board.md" })) as {
      columns: { id: string; cards: { path: string; children?: { path: string }[] }[] }[];
    };
    const todo = result.columns.find((c) => c.id === "todo");
    expect(todo?.cards.map((c) => c.path)).toEqual(["Tasks/Parent.md"]);
    expect(todo?.cards[0]?.children?.map((c) => c.path)).toEqual(["Tasks/Child.md"]);
  });

  // What the client actually receives is the JSON, where an undefined field is simply absent —
  // which is the difference between "this card has no children" and "this card has an empty list".
  it("leaves `children` out of the JSON for a card that has none", async () => {
    const { host } = fixture();
    const result = await call(host, "get_board", { board: "Board.md" });
    const wire = JSON.parse(JSON.stringify(result)) as {
      columns: { cards: Record<string, unknown>[] }[];
    };
    expect(wire.columns[0]?.cards[0]).not.toHaveProperty("children");
  });
});

describe("a checklist line standing in a column of its own", () => {
  /** One note whose checklist line claims a column, so the board shows two cards for one file. */
  function claimed(claim = "doing"): Fixture {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/Write docs.md": {
          fm: { status: "todo", order: 1 },
          body: `\n## Subtasks\n\n- [ ] Draft it [status:: ${claim}]\n`,
        },
      },
      () => "all",
      () => "",
    );
    return {
      repo,
      host: {
        listBoards: () => [{ path: "Board.md", name: "Board" }],
        repoFor: (path) => (path === "Board.md" ? repo : null),
      },
    };
  }

  // The synthetic card carries its parent's file name, so matching on that made every claimed line
  // a rival of the note it lives in — and a board with one card became too ambiguous to address.
  it("does not answer to its parent's file name", async () => {
    const { host } = claimed();
    const card = (await call(host, "get_card", {
      board: "Board.md",
      card: "Write docs",
    })) as { path: string };
    expect(card.path).toBe("Tasks/Write docs.md");
  });

  it("is refused a position rather than being given one that is ignored", async () => {
    const { host } = claimed();
    await expect(
      call(host, "move_card", {
        board: "Board.md",
        card: "Tasks/Write docs.md#todo:0",
        column: "done",
        position: 0,
      }),
    ).rejects.toThrow(/ordered by its place in its parent's list/);
  });

  // Moving it where it already is writes nothing, which used to be reported as "not a card on this
  // board" — a denial of the card `get_board` had listed one call earlier.
  it("is reported as where it is when it is already there", async () => {
    const { host } = claimed();
    const result = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/Write docs.md#todo:0",
      column: "doing",
    })) as { column: string };
    expect(result.column).toBe("doing");
  });

  it("still refuses a card that really is not on the board", async () => {
    const { host } = fixture();
    await expect(
      call(host, "move_card", { board: "Board.md", card: "Tasks/Ghost.md", column: "done" }),
    ).rejects.toThrow(/No card "Tasks\/Ghost\.md"/);
  });

  // Moved home to its parent's column, the line stops being a card of its own: the board draws it
  // back inside the note and mints no tile. The write still happened, so reporting `null` would
  // tell the agent its move failed and invite it to do the whole thing again.
  it("is reported as in its parent's column when it is moved back home", async () => {
    const { host, repo } = claimed();
    const result = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/Write docs.md#todo:0",
      column: "todo",
    })) as { column: string | null; position?: number };
    expect(result.column).toBe("todo");
    // No tile of its own, so no slot to report — rather than the -1 an indexOf miss would give.
    expect(result.position).toBeUndefined();
    expect((await repo.readBody("Tasks/Write docs.md")).subtasks[0]?.status ?? "").toBe("");
  });
});

describe("a subcard moved into the column its parent is in", () => {
  /** A parent in `todo` with a genuinely-nested child, which the board draws inside it. */
  function nested(childStatus = "doing"): Fixture {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/Parent.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] [[Child]]\n",
        },
        "Tasks/Child.md": { fm: { status: childStatus, order: 1 }, body: "" },
      },
      () => "all",
      () => "",
    );
    return {
      repo,
      host: {
        listBoards: () => [{ path: "Board.md", name: "Board" }],
        repoFor: (path) => (path === "Board.md" ? repo : null),
      },
    };
  }

  // `get_board` hands an agent this card's path under its parent's `children`, so asking to move
  // it is an ordinary next step — and landing it in the parent's column is the ordinary answer.
  it("is reported where it landed, not as a card that vanished", async () => {
    const { host, repo } = nested();
    const result = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/Child.md",
      column: "todo",
    })) as { column: string | null };
    expect(result.column).toBe("todo");
    const board = await repo.loadBoard();
    expect(board.cards["Tasks/Child.md"]?.frontmatter.status).toBe("todo");
    // The premise of the test: it really is drawn inside its parent rather than as its own tile.
    expect(board.columns["todo"]).not.toContain("Tasks/Child.md");
    expect(board.childrenOf["Tasks/Parent.md"]).toContain("Tasks/Child.md");
  });

  it("still reports a column of its own when it has one", async () => {
    const { host } = nested();
    const result = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/Child.md",
      column: "done",
    })) as { column: string | null; position?: number };
    expect(result.column).toBe("done");
    expect(result.position).toBe(0);
  });
});

describe("the frontmatter keys update_card will not write by hand", () => {
  it("refuses a title, which belongs to the rename that also fixes the links", async () => {
    const { host, repo } = fixture();
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        properties: { title: "Renamed by hand" },
      }),
    ).rejects.toThrow(/renames the note and its inbound links/);
    const board = await repo.loadBoard();
    expect(board.cards["Tasks/Ship it.md"]?.frontmatter).not.toHaveProperty("title");
  });

  it("refuses the board flag, which would make a card answer as a board of its own", async () => {
    const { host } = fixture();
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        properties: { "folia-board": true },
      }),
    ).rejects.toThrow(/makes a note a board/);
  });
});

describe("the values a card's own fields will and will not take", () => {
  it("keeps an empty string as an empty value instead of deleting the key", async () => {
    const { host, repo } = fixture();
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      properties: { area: "docs" },
    });
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      properties: { area: "" },
    });
    const board = await repo.loadBoard();
    // `null` is how the documented contract clears a key; `""` asked for an empty value, and
    // quietly removing the property instead is a deletion the agent never requested.
    expect(board.cards["Tasks/Ship it.md"]?.frontmatter.area).toBe("");
  });

  it("still clears a key on null", async () => {
    const { host, repo } = fixture();
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      properties: { area: "docs" },
    });
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      properties: { area: null },
    });
    const board = await repo.loadBoard();
    expect(board.cards["Tasks/Ship it.md"]?.frontmatter).not.toHaveProperty("area");
  });

  it("refuses a due date it cannot read, rather than writing prose into the frontmatter", async () => {
    const { host, repo } = fixture();
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        due: "next Friday",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    const board = await repo.loadBoard();
    expect(board.cards["Tasks/Ship it.md"]?.frontmatter).not.toHaveProperty("due");
  });

  it("takes a due date in the one format the board reads, and clears it on null", async () => {
    const { host, repo } = fixture();
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      due: "2026-03-14",
    });
    expect((await repo.loadBoard()).cards["Tasks/Ship it.md"]?.frontmatter.due).toBe("2026-03-14");
    await call(host, "update_card", { board: "Board.md", card: "Tasks/Ship it.md", due: null });
    expect((await repo.loadBoard()).cards["Tasks/Ship it.md"]?.frontmatter).not.toHaveProperty(
      "due",
    );
  });
});

describe("names that belong to every object, not to any card", () => {
  // `board.cards` is a plain object, so a lookup that only asks whether the key is truthy finds
  // `toString` on the prototype and hands a function to code expecting a card.
  it("says no card answers to a prototype method name", async () => {
    const { host } = fixture();
    await expect(call(host, "get_card", { board: "Board.md", card: "toString" })).rejects.toThrow(
      /No card "toString"/,
    );
  });

  it("treats a property named like a prototype method as an ordinary property", async () => {
    const { host, repo } = fixture();
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      properties: { toString: "mine" },
    });
    expect((await repo.loadBoard()).cards["Tasks/Ship it.md"]?.frontmatter.toString).toBe("mine");
  });
});

describe("a create_card that gets the note written but not its fields", () => {
  // Reported as a plain failure, this is how a board ends up with two of the same card: the agent
  // hears "create_card failed" about a card that is already there, and creates it again.
  it("names the card it did create rather than reporting nothing happened", async () => {
    const { host, repo } = fixture();
    repo.setDescription = () => Promise.reject(new Error("disk full"));
    await expect(
      call(host, "create_card", {
        board: "Board.md",
        title: "Half made",
        column: "todo",
        description: "Some detail.",
      }),
    ).rejects.toThrow(/was created in "todo".*finish it with update_card/s);
    expect((await repo.loadBoard()).columns["todo"]).toContain("Tasks/Half made.md");
  });
});

describe("two cards that each claim the other as their parent", () => {
  // The board refuses to nest a cycle — its members are surfaced as top-level cards instead of
  // vanishing into each other — so each one has a tile of its own and the walk that reports where
  // a move landed stops on the first look. This pins that: without a tile, the walk would follow
  // `parentOf` into the cycle and could answer with the partner's column instead of the card's.
  it("are reported by their own column, not by their partner's", async () => {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/A.md": { fm: { status: "todo", order: 1 }, body: "\n## Subtasks\n\n- [ ] [[B]]\n" },
        "Tasks/B.md": { fm: { status: "todo", order: 2 }, body: "\n## Subtasks\n\n- [ ] [[A]]\n" },
      },
      () => "all",
      () => "",
    );
    const host: BoardHost = {
      listBoards: () => [{ path: "Board.md", name: "Board" }],
      repoFor: (path) => (path === "Board.md" ? repo : null),
    };
    const moved = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/A.md",
      column: "done",
    })) as { column: string | null };
    expect(moved.column).toBe("done");
    const board = await repo.loadBoard();
    expect(board.columns["done"]).toContain("Tasks/A.md");
    expect(board.columns["todo"]).toContain("Tasks/B.md");
  });
});

describe("ticking a checklist line that names a child note", () => {
  /** A parent whose subtask list links a child card, which is what `kind: "card"` means. */
  function withChild(childStatus = "doing"): Fixture {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/Parent.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] [[Child]]\n",
        },
        "Tasks/Child.md": { fm: { status: childStatus, order: 1 }, body: "" },
      },
      () => "all",
      () => "",
    );
    return {
      repo,
      host: {
        listBoards: () => [{ path: "Board.md", name: "Board" }],
        repoFor: (path) => (path === "Board.md" ? repo : null),
      },
    };
  }

  // The promise the whole server rests on is that an agent's write is what a person's click
  // produces. The detail panel passes the line's `[[link]]` when it ticks one, and without it the
  // move that should follow is refused — leaving the box ticked and the child where it was.
  it("moves the child to Done, the way the detail panel does", async () => {
    const { host, repo } = withChild();
    await call(host, "set_subtask_done", {
      board: "Board.md",
      card: "Tasks/Parent.md",
      index: 0,
      done: true,
    });
    const board = await repo.loadBoard();
    expect(board.cards["Tasks/Child.md"]?.frontmatter.status).toBe("done");
    expect((await repo.readBody("Tasks/Child.md")).history.map((h) => h.text)).toEqual([
      "Moved from Doing to Done",
    ]);
  });

  it("brings the child back out of Done when the box is unticked", async () => {
    const { host, repo } = withChild("done");
    await call(host, "set_subtask_done", {
      board: "Board.md",
      card: "Tasks/Parent.md",
      index: 0,
      done: false,
    });
    expect((await repo.loadBoard()).cards["Tasks/Child.md"]?.frontmatter.status).not.toBe("done");
  });
});

describe("a board whose relationship keys an agent might write by hand", () => {
  // The board really would draw the link, which is what makes this worth refusing: it looks like
  // it worked, while skipping the history line the board records and the self-relation check.
  it("refuses a relation key through properties and says why", async () => {
    const { host, repo } = fixture();
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        properties: { blocks: "[[Write docs]]" },
      }),
    ).rejects.toThrow(/relationship key/);
    expect((await repo.loadBoard()).cards["Tasks/Ship it.md"]?.frontmatter).not.toHaveProperty(
      "blocks",
    );
  });
});

describe("a column filled by a rule rather than by status", () => {
  /** A board whose `research` column is an auto-populated lane. */
  function laned(): Fixture {
    const repo = new FakeRepo(
      {
        ...config,
        columns: [
          { id: "todo", title: "Todo" },
          { id: "research", title: "Research", filter: "priority:high" },
          { id: "done", title: "Done" },
        ],
      },
      {
        "Tasks/A.md": { fm: { status: "todo", order: 1, priority: "high" }, body: "" },
        "Tasks/B.md": { fm: { status: "todo", order: 2 }, body: "" },
      },
      () => "all",
      () => "",
    );
    return {
      repo,
      host: {
        listBoards: () => [{ path: "Board.md", name: "Board" }],
        repoFor: (path) => (path === "Board.md" ? repo : null),
      },
    };
  }

  // The board draws `A` in Research because it matches the rule, but that matching lives in the
  // board view, above the port these tools read through. The listing here is the status bucket,
  // which for a lane is a different set — so it says so rather than letting an agent read an empty
  // `cards` as an empty lane.
  it("says the listing is the status bucket, not the lane the board draws", async () => {
    const { host } = laned();
    const result = (await call(host, "get_board", { board: "Board.md" })) as {
      columns: { id: string; filter?: string; lane?: string; cards: unknown[] }[];
    };
    const research = result.columns.find((c) => c.id === "research");
    expect(research?.filter).toBe("priority:high");
    expect(research?.lane).toMatch(/filter rule/);
    expect(research?.cards).toEqual([]);
    // A plain column says nothing of the sort, because for it the two sets are the same.
    expect(result.columns.find((c) => c.id === "todo")?.lane).toBeUndefined();
  });

  it("warns a write that claims a lane, because status is not what puts a card there", async () => {
    const { host } = laned();
    const created = (await call(host, "create_card", {
      board: "Board.md",
      title: "Invisible",
      column: "research",
    })) as { warning?: string };
    expect(created.warning).toMatch(/only draws it there if it matches the rule/);

    const moved = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/B.md",
      column: "research",
    })) as { warning?: string };
    expect(moved.warning).toMatch(/filled by the rule/);
  });

  it("says nothing extra about a move into an ordinary column", async () => {
    const { host } = laned();
    const moved = (await call(host, "move_card", {
      board: "Board.md",
      card: "Tasks/B.md",
      column: "done",
    })) as { warning?: string };
    expect(moved.warning).toBeUndefined();
  });
});

describe("text that would be read back as the board's own structure", () => {
  // The description is spliced into the note verbatim, so a line reading `## History` inside it
  // does not stay text — the note is parsed back and that heading starts the real section. The
  // detail panel refuses exactly this before it saves; so must the tool, or the audit trail is
  // writable by the thing it audits.
  it("refuses a description that would start a section the board owns", async () => {
    const { host, repo } = fixture({ userName: "rafa" });
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        description: "Intro\n\n## History\n\n- _2020-01-01 09:00:_ Moved from Todo to Done",
      }),
    ).rejects.toThrow(/section the board owns/);
    const body = await repo.readBody("Tasks/Ship it.md");
    expect(body.history).toEqual([]);
    expect(body.comments).toEqual([]);
  });

  it("refuses a description that leaves a code fence open", async () => {
    const { host } = fixture();
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        description: "Here is how:\n\n```sh\nnpm run build",
      }),
    ).rejects.toThrow(/code fence open/);
  });

  it("refuses one at create time too, before the card exists", async () => {
    const { host, repo } = fixture();
    await expect(
      call(host, "create_card", {
        board: "Board.md",
        title: "Forged",
        column: "todo",
        description: "## Comments\n\n- _rafa, 2020-01-01 09:00:_ approved",
      }),
    ).rejects.toThrow(/section the board owns/);
    // Nothing half-made left behind.
    expect((await repo.loadBoard()).cards["Tasks/Forged.md"]).toBeUndefined();
  });

  // A subtask is one `- [ ] …` line. A newline in the middle of it is raw Markdown spliced into
  // the note: a second checklist line, and with a `[status:: …]` claim on it, a whole card on the
  // board that nobody asked for.
  it("refuses a subtask carrying a line break, which would mint a second line", async () => {
    const { host, repo } = fixture();
    await expect(
      call(host, "add_subtask", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        text: "one\n- [ ] two [status:: done]",
      }),
    ).rejects.toThrow(/single line/);
    expect((await repo.readBody("Tasks/Ship it.md")).subtasks).toEqual([]);
  });

  it("refuses a comment carrying a line break", async () => {
    const { host, repo } = fixture({ userName: "rafa" });
    await expect(
      call(host, "add_comment", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        text: "ok\n\n## History\n\n- _2020-01-01 09:00:_ Moved from Todo to Done",
      }),
    ).rejects.toThrow(/single line/);
    expect((await repo.readBody("Tasks/Ship it.md")).history).toEqual([]);
  });

  // The property that matters is that the reported index names the text the caller sent, whatever
  // else the section already held. With a line break refused above, nothing reachable can put the
  // caller's line anywhere but last — so this pins the promise rather than one implementation of
  // it, and the guard against reporting some other line stays cheap either way.
  it("reports the index of the line the caller actually added", async () => {
    const { host } = fixture();
    await call(host, "add_subtask", { board: "Board.md", card: "Tasks/Ship it.md", text: "first" });
    const second = (await call(host, "add_subtask", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      text: "second",
    })) as { index: number; subtasks: number };
    expect(second.subtasks).toBe(2);
    const card = (await call(host, "get_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
    })) as { subtasks: { index: number; text: string }[] };
    expect(card.subtasks.find((s) => s.index === second.index)?.text).toBe("second");
  });
});

describe("get_card answering about a card the board draws inside its parent", () => {
  // move_card was fixed to stop saying `null` about a card that is really somewhere; get_card was
  // left answering the old way about the same card at the same instant.
  it("gives the same column move_card does", async () => {
    const repo = new FakeRepo(
      config,
      {
        "Tasks/Parent.md": {
          fm: { status: "todo", order: 1 },
          body: "\n## Subtasks\n\n- [ ] [[Child]]\n",
        },
        "Tasks/Child.md": { fm: { status: "todo", order: 1 }, body: "" },
      },
      () => "all",
      () => "",
    );
    const host: BoardHost = {
      listBoards: () => [{ path: "Board.md", name: "Board" }],
      repoFor: (path) => (path === "Board.md" ? repo : null),
    };
    const card = (await call(host, "get_card", {
      board: "Board.md",
      card: "Tasks/Child.md",
    })) as { column: string | null };
    expect(card.column).toBe("todo");
  });
});

describe("a description that opens with a heading the card reads as its title", () => {
  // Saved, the line is not description at all: it is where the title comes from, so it is eaten
  // and never comes back. The call reported success over text that was already gone.
  it("is refused rather than silently swallowed", async () => {
    const { host, repo } = fixture();
    await expect(
      call(host, "update_card", {
        board: "Board.md",
        card: "Tasks/Ship it.md",
        description: "# Injected\n\nreal body",
      }),
    ).rejects.toThrow(/reads its title/);
    expect((await repo.readBody("Tasks/Ship it.md")).description).not.toBe("real body");
  });

  it("still allows a smaller heading, which survives the round trip", async () => {
    const { host, repo } = fixture();
    await call(host, "update_card", {
      board: "Board.md",
      card: "Tasks/Ship it.md",
      description: "## Question\n\nwhy?",
    });
    expect((await repo.readBody("Tasks/Ship it.md")).description).toBe("## Question\n\nwhy?");
  });
});
