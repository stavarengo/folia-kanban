// @vitest-environment node
// The transport, over a real socket: a server is started on a free loopback port and talked to
// with real HTTP requests, so the auth, the origin check and the JSON-RPC round trip are exercised
// the way an MCP client exercises them.

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { MCP_DEFAULT_BIND_ADDRESS } from "../src/mcp/bindAddress";
import { MCP_PATH, startMcpServer, type RunningMcpServer } from "../src/obsidian/mcpHttpServer";
import type { BoardHost } from "../src/mcp/host";
import type { JsonRpcResponse } from "../src/mcp/protocol";
import type { BoardConfig } from "../src/model/types";
import { FakeRepo } from "./fakeRepo";

const TOKEN = "test-token-0123456789";

const config: BoardConfig = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto",
  priorities: [],
  relations: [],
  columns: [
    { id: "todo", title: "Todo" },
    { id: "done", title: "Done" },
  ],
};

let server: RunningMcpServer;
let repo: FakeRepo;

function url(path = MCP_PATH): string {
  return `http://${MCP_DEFAULT_BIND_ADDRESS}:${server.port}${path}`;
}

async function post(body: unknown, init: RequestInit = {}): Promise<Response> {
  const { headers, ...rest } = init;
  return await fetch(url(), {
    method: "POST",
    ...rest,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

async function rpc(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const res = await post({ jsonrpc: "2.0", id: 1, method, params });
  expect(res.status).toBe(200);
  return (await res.json()) as JsonRpcResponse;
}

beforeEach(async () => {
  repo = new FakeRepo(config, {
    "Tasks/A card.md": { fm: { status: "todo", order: 1 }, body: "" },
    "Tasks/B card.md": { fm: { status: "todo", order: 2 }, body: "" },
  });
  const host: BoardHost = {
    listBoards: () => [{ path: "Board.md", name: "Board" }],
    repoFor: (path) => (path === "Board.md" ? repo : null),
  };
  server = await startMcpServer({
    host,
    bindAddress: MCP_DEFAULT_BIND_ADDRESS,
    info: { name: "folia-kanban", title: "Folia Kanban", version: "0.0.0" },
    port: 0,
    token: TOKEN,
  });
});

afterEach(async () => {
  await server.close();
});

describe("the MCP endpoint", () => {
  // Asked of the socket, not of the address it was handed: with the default bind this is the
  // property that keeps the board off the local network, and asserting
  // `MCP_DEFAULT_BIND_ADDRESS === "127.0.0.1"` would prove nothing.
  it("binds the address it was given, which by default is loopback", () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.address).toBe("127.0.0.1");
  });

  it("refuses a request with no token", async () => {
    const res = await fetch(url(), { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("refuses a request with the wrong token", async () => {
    const res = await post({}, { headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("refuses a browser page on another origin", async () => {
    const res = await post({}, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("answers a loopback origin", async () => {
    const res = await post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { headers: { origin: "http://localhost:5173" } },
    );
    expect(res.status).toBe(200);
  });

  it("answers POST only, and only on its own path", async () => {
    const get = await fetch(url(), {
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const elsewhere = await fetch(url("/somewhere"), {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: "{}",
    });
    expect(elsewhere.status).toBe(404);
  });

  it("reports unparseable JSON as a JSON-RPC parse error", async () => {
    const res = await fetch(url(), {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  it("acknowledges a notification with 202 and no body", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("carries a full session: initialize, list the tools, move a card", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect((init.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");

    const list = await rpc("tools/list");
    const names = (list.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain("move_card");

    const call = await rpc("tools/call", {
      name: "move_card",
      arguments: { board: "Board.md", card: "Tasks/A card.md", column: "done" },
    });
    const content = (call.result as { content: { text: string }[] }).content;
    expect(JSON.parse(content[0]?.text ?? "")).toMatchObject({ column: "done" });
    expect((await repo.loadBoard()).columns["done"]).toEqual(["Tasks/A card.md"]);
  });

  it("refuses to start without a token", async () => {
    await expect(
      startMcpServer({
        host: { listBoards: () => [], repoFor: () => null },
        info: { name: "n", title: "t", version: "0" },
        port: 0,
        bindAddress: MCP_DEFAULT_BIND_ADDRESS,
        token: "",
      }),
    ).rejects.toThrow(/token/);
  });

  // The settings tab refuses one, but a hand-edited `data.json` never passes through the settings
  // tab, and `listen` would take a name and go and resolve it.
  it("refuses to start on something that is not an address", async () => {
    await expect(
      startMcpServer({
        host: { listBoards: () => [], repoFor: () => null },
        info: { name: "n", title: "t", version: "0" },
        port: 0,
        bindAddress: "board.example.com",
        token: TOKEN,
      }),
    ).rejects.toThrow(/not an address/);
  });

  // `listen` takes the string literally, so an address that only survives normalisation — what a
  // hand-edited `data.json` carries, since it never passed through the settings tab — would be
  // resolved as a name and fail.
  it("binds an address that needs normalising first", async () => {
    const padded = await startMcpServer({
      host: { listBoards: () => [], repoFor: () => null },
      info: { name: "n", title: "t", version: "0" },
      port: 0,
      bindAddress: "  127.0.0.1  ",
      token: TOKEN,
    });
    expect(padded.address).toBe("127.0.0.1");
    await padded.close();
  });
});

// The bind address the user chose is what the origin check is judged against, so the rule needs a
// server that is not on loopback. `0.0.0.0` is the one non-loopback bind every machine can make.
describe("the origin check under a wildcard bind", () => {
  let wide: RunningMcpServer;

  beforeEach(async () => {
    wide = await startMcpServer({
      host: { listBoards: () => [], repoFor: () => null },
      info: { name: "folia-kanban", title: "Folia Kanban", version: "0.0.0" },
      port: 0,
      bindAddress: "0.0.0.0",
      token: TOKEN,
    });
  });

  afterEach(async () => {
    await wide.close();
  });

  const ping = async (origin: string): Promise<number> => {
    const res = await fetch(`http://127.0.0.1:${wide.port}${MCP_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        origin,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    return res.status;
  };

  it("answers a page served from one of the addresses it is on", async () => {
    expect(await ping("http://192.168.1.5:5173")).toBe(200);
  });

  // The whole of the protection: a rebinding attack arrives carrying the attacker's name, never a
  // literal, and a wildcard bind does not change that.
  it("still refuses a page on a name", async () => {
    expect(await ping("https://evil.example")).toBe(403);
  });
});

describe("what the endpoint refuses before it means anything", () => {
  // A sandboxed iframe and a `file://` page both send this, and both are somebody else's page
  // talking to a server on the user's own machine.
  it("refuses an opaque origin rather than reading it as no origin at all", async () => {
    const res = await post({}, { headers: { origin: "null" } });
    expect(res.status).toBe(403);
  });

  it("still accepts a request that carries no origin, which is every MCP client", async () => {
    const res = await rpc("ping");
    expect(res.result).toEqual({});
  });

  // The body used to be cut off by destroying the socket, so the answer explaining why never
  // arrived — the client saw a connection reset, and, had it seen anything, would have been told
  // its JSON was malformed.
  it("answers an oversized body as one, on a connection still able to hear it", async () => {
    const res = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: "x".repeat(1_100_000),
    });
    expect(res.status).toBe(413);
    expect((await res.json()) as { error: string }).toMatchObject({ error: /larger than/ });
  });

  // The rest of an oversized body is drained rather than left sitting unread. On a kept-alive
  // connection those bytes would otherwise be read as the start of whatever the client sent next,
  // so the call after a 413 is the one that shows whether the socket was left usable.
  it("leaves the connection able to carry the next call", async () => {
    const big = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: "x".repeat(1_100_000),
    });
    expect(big.status).toBe(413);
    const next = await rpc("ping");
    expect(next.result).toEqual({});
  });

  // A client deciding whether it is talking to a protocol it understands should not have to infer
  // it from a refusal.
  it("names the protocol revision even when it refuses the request", async () => {
    const res = await post({}, { headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("mcp-protocol-version")).toBe("2025-06-18");
  });
});

describe("two agents at once", () => {
  // Every write reads the board, works out its change against what it read, and writes it back.
  // Run together, two moves into one column would compute the same slot from the same snapshot.
  it("answers calls one at a time, so concurrent moves do not collide", async () => {
    const moves = ["Tasks/A card.md", "Tasks/B card.md"].map((card) =>
      rpc("tools/call", {
        name: "move_card",
        arguments: { board: "Board.md", card, column: "done" },
      }),
    );
    await Promise.all(moves);
    const board = await repo.loadBoard();
    const orders = (board.columns["done"] ?? []).map((p) => board.cards[p]?.frontmatter.order);
    expect(board.columns["done"]).toHaveLength(2);
    expect(new Set(orders).size).toBe(2);
  });
});

describe("a call that outruns the deadline", () => {
  /** A host whose board reads take `delay` ms, and a log of when each call is inside one. */
  function slowServer(delay: number, deadline: number) {
    const events: string[] = [];
    let seq = 0;
    const slow = new FakeRepo(config, {
      "Tasks/A card.md": { fm: { status: "todo", order: 1 }, body: "" },
    });
    const realLoad = slow.loadBoard.bind(slow);
    slow.loadBoard = async () => {
      const n = seq++;
      events.push(`enter${n}`);
      await new Promise((r) => setTimeout(r, delay));
      events.push(`leave${n}`);
      return await realLoad();
    };
    return {
      events,
      start: () =>
        startMcpServer({
          host: {
            listBoards: () => [{ path: "Board.md", name: "Board" }],
            repoFor: (p) => (p === "Board.md" ? slow : null),
          },
          info: { name: "folia-kanban", title: "Folia Kanban", version: "0.0.0" },
          port: 0,
          bindAddress: MCP_DEFAULT_BIND_ADDRESS,
          token: TOKEN,
          handlingTimeoutMs: deadline,
        }),
    };
  }

  // The queue exists so that two writes never compute against the same snapshot of the board. A
  // timeout that let the queue advance would give that up exactly when the board is slow enough
  // for it to matter — the client is released, the work is not.
  it("still lets no two calls into the board at once", async () => {
    const { events, start } = slowServer(200, 50);
    const slowSrv = await start();
    const call = (id: number) =>
      fetch(`http://${MCP_DEFAULT_BIND_ADDRESS}:${slowSrv.port}${MCP_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "get_board", arguments: { board: "Board.md" } },
        }),
      });
    const [a, b] = await Promise.all([call(1), call(2)]);
    expect([a.status, b.status]).toEqual([504, 504]);
    // Both calls are still running at this point — that is the whole point of the 504. Wait for
    // them to finish before judging the order they went through the board in.
    await new Promise((r) => setTimeout(r, 600));
    // Interleaved would read enter0, enter1, leave0, leave1.
    expect(events).toEqual(["enter0", "leave0", "enter1", "leave1"]);
    await slowSrv.close();
  });

  // A bare `{error}` body would be unattributable: the client could not tell which of its calls
  // had timed out, and nothing would warn it that retrying may double the write.
  it("answers as JSON-RPC, keeping the call's id, and says the call may still be running", async () => {
    const { start } = slowServer(200, 50);
    const slowSrv = await start();
    const res = await fetch(`http://${MCP_DEFAULT_BIND_ADDRESS}:${slowSrv.port}${MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "abc",
        method: "tools/call",
        params: { name: "get_board", arguments: { board: "Board.md" } },
      }),
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as JsonRpcResponse;
    expect(body.id).toBe("abc");
    expect(body.error?.message).toMatch(/still running/);
    await new Promise((r) => setTimeout(r, 300));
    await slowSrv.close();
  });

  it("does not fire for a call that finishes in time", async () => {
    const { start } = slowServer(5, 5_000);
    const slowSrv = await start();
    const res = await fetch(`http://${MCP_DEFAULT_BIND_ADDRESS}:${slowSrv.port}${MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(200);
    await slowSrv.close();
  });
});
