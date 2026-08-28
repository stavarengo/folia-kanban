// @vitest-environment node
// The transport, over a real socket: a server is started on a free loopback port and talked to
// with real HTTP requests, so the auth, the origin check and the JSON-RPC round trip are exercised
// the way an MCP client exercises them.

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  MCP_HOST,
  MCP_PATH,
  startMcpServer,
  type RunningMcpServer,
} from "../src/obsidian/mcpHttpServer";
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
  return `http://${MCP_HOST}:${server.port}${path}`;
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
  });
  const host: BoardHost = {
    listBoards: () => [{ path: "Board.md", name: "Board" }],
    repoFor: (path) => (path === "Board.md" ? repo : null),
  };
  server = await startMcpServer({
    host,
    info: { name: "folia-kanban", title: "Folia Kanban", version: "0.0.0" },
    port: 0,
    token: TOKEN,
  });
});

afterEach(async () => {
  await server.close();
});

describe("the MCP endpoint", () => {
  it("binds loopback only", () => {
    expect(server.port).toBeGreaterThan(0);
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
        token: "",
      }),
    ).rejects.toThrow(/token/);
  });
});
