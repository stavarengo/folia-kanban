// The plugin's side of the MCP server: which boards it can see, a repository per board, and the
// start/stop lifecycle the settings toggle drives.
//
// This is the adapter layer. `src/mcp/` knows nothing about Obsidian; everything below turns the
// vault into the small `BoardHost` shape the tools ask for. The repositories handed out here are
// constructed exactly as `view.tsx` constructs the board view's own — same history scope, same
// comment signature — which is what makes an agent's write indistinguishable from a person's.

import type { App, TFile } from "obsidian";
import { isBoardFrontmatter } from "../viewMode";
import type { BoardHost, BoardRef } from "../mcp/host";
import type { CardRepository } from "../model/repo";
import type { ServerInfo } from "../mcp/protocol";
import { startMcpServer, type RunningMcpServer } from "./mcpHttpServer";
import { VaultRepository } from "./vaultRepo";
import type { KanbanSettings } from "../settings";

/** Bytes of randomness behind a token: 32 of them is well past guessing, and stays short enough
 *  to paste into a config file by hand. */
const TOKEN_BYTES = 32;

/** A fresh bearer token, from the platform's cryptographic randomness — never `Math.random`. */
export function newMcpToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** How the running server is reported back to whoever asked for it. */
export type McpState =
  | { kind: "off" }
  | { kind: "running"; port: number; bindAddress: string }
  /** Carries what was tried, not just why it failed: syncs are serialised, so by the time a
   *  failure is reported the settings may already name an address nobody attempted. */
  | { kind: "failed"; message: string; port: number; bindAddress: string };

/** The pieces of the plugin the service needs, so it can be built without one under test. */
export interface McpServiceOptions {
  app: App;
  /** Read live, never captured: the scope and the signature must follow the settings tab. */
  getSettings: () => KanbanSettings;
  info: ServerInfo;
  /** Told about every state change, so the plugin can surface a failure instead of a dead toggle. */
  onState?: (state: McpState) => void;
}

/** The vault, as the tools see it. Exported so a test can hold it without a running server. */
export function vaultBoardHost(options: McpServiceOptions): BoardHost {
  const { app, getSettings } = options;
  const isBoard = (file: TFile): boolean =>
    isBoardFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter);
  return {
    listBoards(): BoardRef[] {
      return app.vault
        .getMarkdownFiles()
        .filter(isBoard)
        .map((f) => ({ path: f.path, name: f.basename }));
    },
    repoFor(boardPath: string): CardRepository | null {
      const file = app.vault.getMarkdownFiles().find((f) => f.path === boardPath);
      if (!file || !isBoard(file)) return null;
      return new VaultRepository(
        app,
        boardPath,
        () => getSettings().historyScope,
        () => getSettings().userName,
      );
    },
  };
}

/**
 * The server's lifetime, kept in step with the settings.
 *
 * `sync` is the only entry point: call it after every settings change and it starts, stops or
 * restarts to match. Restarting on a port or bind-address change is deliberate — a running server
 * on the old one would leave the settings tab describing an address nothing answers on.
 */
/** What the settings currently ask the server to be. */
interface Target {
  port: number;
  bindAddress: string;
  token: string;
}

function same(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return false;
  return a.port === b.port && a.bindAddress === b.bindAddress && a.token === b.token;
}

export class McpService {
  private running: RunningMcpServer | null = null;
  private wanted: Target | null = null;
  /** The target that would not start. Kept so an unrelated settings write does not retry a bind
   *  that is going to fail again and pop the same notice — the user has already been told. */
  private refused: Target | null = null;
  /** Serialises overlapping syncs, so a fast toggle-off/on cannot leave two servers behind. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: McpServiceOptions) {}

  get port(): number | null {
    return this.running?.port ?? null;
  }

  /** Start, stop or restart so the running server matches `settings`. */
  sync(settings: KanbanSettings): Promise<void> {
    const target =
      settings.mcpEnabled && settings.mcpToken
        ? {
            port: settings.mcpPort,
            bindAddress: settings.mcpBindAddress,
            token: settings.mcpToken,
          }
        : null;
    return this.enqueue(() => this.reconcile(target));
  }

  /** Stop for good; called from the plugin's unload. */
  stop(): Promise<void> {
    return this.enqueue(() => this.reconcile(null));
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work, work);
    return this.queue;
  }

  private async reconcile(target: Target | null): Promise<void> {
    if (this.serving(target)) return;
    if (target && same(this.refused, target)) return;
    await this.shutDown();
    if (target) await this.start(target);
  }

  /** Is a server already up and answering on exactly what `target` asks for? */
  private serving(target: Target | null): boolean {
    return this.running !== null && same(this.wanted, target);
  }

  private async shutDown(): Promise<void> {
    this.refused = null;
    if (!this.running) return;
    await this.running.close();
    this.running = null;
    this.wanted = null;
    this.options.onState?.({ kind: "off" });
  }

  private async start(target: Target): Promise<void> {
    this.wanted = target;
    try {
      this.running = await startMcpServer({
        host: vaultBoardHost(this.options),
        info: this.options.info,
        port: target.port,
        bindAddress: target.bindAddress,
        token: target.token,
      });
      this.options.onState?.({
        kind: "running",
        port: this.running.port,
        bindAddress: target.bindAddress,
      });
    } catch (e) {
      this.wanted = null;
      this.refused = target;
      this.options.onState?.({
        kind: "failed",
        message: e instanceof Error ? e.message : String(e),
        port: target.port,
        bindAddress: target.bindAddress,
      });
    }
  }
}
