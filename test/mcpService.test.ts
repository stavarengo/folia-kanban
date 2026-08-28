// The plugin's side of the MCP server: which notes it will admit are boards, what a repository it
// hands out is configured with, and the start/stop lifecycle the settings toggle drives.

import type { App } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";
import { McpService, newMcpToken, vaultBoardHost } from "../src/obsidian/mcpService";
import { VaultRepository } from "../src/obsidian/vaultRepo";
import { DEFAULT_SETTINGS, type KanbanSettings } from "../src/settings";
import type { ServerInfo } from "../src/mcp/protocol";
import { MCP_HOST, MCP_PATH } from "../src/obsidian/mcpHttpServer";
import { FakeApp } from "./obsidianFake";

const INFO: ServerInfo = { name: "folia-kanban", title: "Folia Kanban", version: "0.0.0" };

const BOARD = "---\nfolia-board: true\ncard-folder: Tasks\ncolumns:\n  - todo\n---\n";
const PLAIN = "---\ntitle: Not a board\n---\n";

function setup(settings: Partial<KanbanSettings> = {}) {
  const app = new FakeApp();
  app.vault.addFile("Work/Board.md", BOARD);
  app.vault.addFile("Notes/Plain.md", PLAIN);
  let current: KanbanSettings = { ...DEFAULT_SETTINGS, ...settings };
  const states: string[] = [];
  const service = new McpService({
    app: app as unknown as App,
    getSettings: () => current,
    info: INFO,
    onState: (s) => states.push(s.kind === "running" ? "running" : s.kind),
  });
  return {
    service,
    states,
    settings: () => current,
    set: (patch: Partial<KanbanSettings>) => {
      current = { ...current, ...patch };
      return service.sync(current);
    },
  };
}

let live: McpService | null = null;

afterEach(async () => {
  await live?.stop();
  live = null;
});

describe("the MCP token", () => {
  it("is long, hex, and different every time", () => {
    const a = newMcpToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newMcpToken()).not.toBe(a);
  });
});

describe("the board host the plugin builds", () => {
  it("offers only the notes carrying the board flag", async () => {
    const s = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: 0 });
    live = s.service;
    await s.service.sync(s.settings());
    const res = await fetch(`http://${MCP_HOST}:${s.service.port ?? 0}${MCP_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${s.settings().mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_boards", arguments: {} },
      }),
    });
    const reply = (await res.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(reply.result.content[0]?.text ?? "")).toEqual({
      boards: [{ path: "Work/Board.md", name: "Board" }],
    });
  });
});

describe("the server's lifetime", () => {
  it("stays off while the setting is off, and off without a token", async () => {
    const s = setup();
    live = s.service;
    await s.service.sync(s.settings());
    expect(s.service.port).toBeNull();
    await s.set({ mcpEnabled: true });
    expect(s.service.port).toBeNull();
  });

  it("starts when switched on and stops when switched off", async () => {
    const s = setup({ mcpToken: newMcpToken(), mcpPort: 0 });
    live = s.service;
    await s.set({ mcpEnabled: true });
    expect(s.service.port).toBeGreaterThan(0);
    await s.set({ mcpEnabled: false });
    expect(s.service.port).toBeNull();
    expect(s.states).toEqual(["running", "off"]);
  });

  it("leaves a running server alone when an unrelated setting changes", async () => {
    const s = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: 0 });
    live = s.service;
    await s.service.sync(s.settings());
    const port = s.service.port;
    await s.set({ userName: "alex" });
    expect(s.service.port).toBe(port);
    expect(s.states).toEqual(["running"]);
  });

  it("reports a port it cannot have rather than leaving the toggle on a dead server", async () => {
    const first = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: 0 });
    live = first.service;
    await first.service.sync(first.settings());
    const taken = first.service.port ?? 0;

    const second = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: taken });
    await second.service.sync(second.settings());
    expect(second.service.port).toBeNull();
    expect(second.states).toEqual(["failed"]);
  });

  // Every settings write reaches `sync`, and collapsing a card is a settings write. Retrying a bind
  // that is going to fail again would pop the same ten-second error banner on every such click.
  it("does not retry a bind it already knows fails, or repeat the complaint", async () => {
    const first = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: 0 });
    live = first.service;
    await first.service.sync(first.settings());

    const second = setup({
      mcpEnabled: true,
      mcpToken: newMcpToken(),
      mcpPort: first.service.port ?? 0,
    });
    await second.service.sync(second.settings());
    await second.set({ userName: "alex" });
    await second.set({ userName: "sam" });
    expect(second.states).toEqual(["failed"]);
  });

  it("tries again once the user changes the port", async () => {
    const first = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: 0 });
    live = first.service;
    await first.service.sync(first.settings());

    const second = setup({
      mcpEnabled: true,
      mcpToken: newMcpToken(),
      mcpPort: first.service.port ?? 0,
    });
    await second.service.sync(second.settings());
    await second.set({ mcpPort: 0 });
    expect(second.service.port).toBeGreaterThan(0);
    expect(second.states).toEqual(["failed", "running"]);
    await second.service.stop();
  });

  // Replacing the token is a security control, so the claim that matters is not that the setting
  // changed but that the old bearer stops opening the door. Nothing asserted that until now.
  it("stops accepting the old token once it is replaced", async () => {
    const old = newMcpToken();
    const s = setup({ mcpEnabled: true, mcpToken: old, mcpPort: 0 });
    live = s.service;
    await s.service.sync(s.settings());
    const call = (token: string) =>
      fetch(`http://${MCP_HOST}:${s.service.port ?? 0}${MCP_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    expect((await call(old)).status).toBe(200);

    const fresh = newMcpToken();
    await s.set({ mcpToken: fresh });
    expect((await call(old)).status).toBe(401);
    expect((await call(fresh)).status).toBe(200);
  });

  // The lifecycle tests all assert what the service believes about itself. Whether the socket was
  // actually given back is a different claim, and the one that matters: a stop that only forgot
  // the server would leave the port held until Obsidian restarted, and the next start would fail
  // for a reason nothing in this suite would explain.
  it("gives the port back, so the same one can be bound again", async () => {
    const first = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: 0 });
    await first.service.sync(first.settings());
    const port = first.service.port;
    expect(port).toBeGreaterThan(0);
    await first.service.stop();

    const second = setup({ mcpEnabled: true, mcpToken: newMcpToken(), mcpPort: port ?? 0 });
    live = second.service;
    await second.service.sync(second.settings());
    expect(second.service.port).toBe(port);
    expect(second.states).toEqual(["running"]);
  });
});

describe("the repository an agent writes through", () => {
  function host(settings: Partial<KanbanSettings>) {
    const app = new FakeApp();
    app.vault.addFile("Work/Board.md", BOARD);
    app.vault.addFile("Notes/Plain.md", PLAIN);
    let current: KanbanSettings = { ...DEFAULT_SETTINGS, ...settings };
    return {
      host: vaultBoardHost({ app: app as unknown as App, getSettings: () => current, info: INFO }),
      set: (patch: Partial<KanbanSettings>) => {
        current = { ...current, ...patch };
      },
    };
  }

  it("is refused for a note that is not a board", () => {
    expect(host({}).host.repoFor("Notes/Plain.md")).toBeNull();
    expect(host({}).host.repoFor("Nothing/Here.md")).toBeNull();
  });

  // Built with the VaultRepository constructor's own defaults, an agent's writes would record no
  // history at all and sign no comment — the very defect agent access exists to fix. These getters
  // are what makes an agent's write indistinguishable from one made in the board view.
  it("reads the same live history scope and comment signature the board view reads", () => {
    const h = host({ historyScope: "moves", userName: "alex" });
    const repo = h.host.repoFor("Work/Board.md");
    expect(repo).toBeInstanceOf(VaultRepository);
    const vaultRepo = repo as VaultRepository;
    expect(vaultRepo.getHistoryScope()).toBe("moves");
    expect(vaultRepo.getUserName()).toBe("alex");
    h.set({ historyScope: "all", userName: "sam" });
    expect(vaultRepo.getHistoryScope()).toBe("all");
    expect(vaultRepo.getUserName()).toBe("sam");
  });
});
