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

  it("answers ping", async () => {
    const reply = await send({ jsonrpc: "2.0", id: 7, method: "ping" });
    expect(reply?.result).toEqual({});
  });

  it("refuses a message that is not JSON-RPC", async () => {
    const reply = await send({ hello: "there" });
    expect(reply?.error?.code).toBe(-32600);
  });
});
