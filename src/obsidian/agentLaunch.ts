// One launch, from the moment its countdown ends to the hand-off: read the card and the board
// again, find the server, claim the card, look once more, and start the command. `AgentRuns` owns
// when this runs and what is left to clean up afterwards; this owns what a launch checks and does.

import type { App, TFile } from "obsidian";
import {
  agentEnvironment,
  agentRunOf,
  cardSlug,
  fillCommand,
  fillPrompt,
  resolveAgent,
  resolveCwd,
  statusOf,
  type AgentContext,
} from "../model/agent";
import type { AgentConfig, BoardConfig } from "../model/types";
import { appendHistory } from "../model/card";
import { stamp } from "../model/dates";
import { agentLaunchLine, historyAllows } from "../model/history";
import { isWildcardBindAddress } from "../bindAddress";
import { DEFAULT_AGENT_COMMAND, DEFAULT_AGENT_PROMPT, type KanbanSettings } from "../settings";
import { readBoardConfig, readBoardFrontmatter } from "./boardConfig";
import { isBoardFrontmatter } from "./viewMode";
import { byRunId, claimMarker, clearMarker, freshFrontmatter } from "./agentMarker";
import type { Spawner } from "./agentLauncher";
import { MCP_PATH } from "./mcpHttpServer";
import type { McpEndpoint } from "./mcpService";
import type { NoteWriter } from "./noteWriter";
import { parseFrontmatter } from "./frontmatter";
import { FOLIA_MOD_FOLDER } from "./foliaMod";

/** A launch asked for: the card, the column it must still stand in, and how far it has got. */
export interface LaunchRequest {
  seq: number;
  phase: "waiting" | "preparing";
  cardPath: string;
  boardPath: string;
  column: string;
  firesAt: number;
  timer?: number;
  runId?: string;
  /** The card, held from the claim on: Obsidian keeps a `TFile`'s path current across renames. */
  claimed?: TFile;
  /** Set once the command has been handed over; from then on the marker is the command's. */
  handedOff?: boolean;
}

/** What a launch reaches outside itself. Every one is injected, so a test never spawns. */
export interface LaunchDeps {
  app: App;
  settings: () => KanbanSettings;
  endpoint: () => McpEndpoint | null;
  spawn: Spawner;
  notify: (message: string) => void;
  stat: (path: string) => Promise<{ isDirectory(): boolean }>;
  homedir: () => string;
  /** The vault's folder on disk, or `null` where the vault is not a folder (mobile). */
  vaultPath: () => string | null;
  /** The plugin's folder, as a vault path (`manifest.dir`). */
  pluginDir: string;
  /** Write the Folia Mod into this vault path, leaving files that already say the same alone. */
  installMod: (dir: string) => Promise<void>;
  newRunId: () => string;
}

/** What the launch needs from `AgentRuns` while it runs. */
export interface LaunchHost {
  deps: LaunchDeps;
  writer: NoteWriter;
  /** Whether the request is still the one its card is waiting for. Asked after every `await`. */
  isCurrent: (request: LaunchRequest) => boolean;
  /** The request is over, as far as the tile is concerned. */
  finish: (request: LaunchRequest) => void;
}

/** The notice for a launch that found no server to hand its agent. */
export function noServerNotice(title: string): string {
  return `Folia Kanban: no agent was started for "${title}": agent access (MCP) is off, restarting, or its server is not running. Turn it on under Settings → Folia Kanban → Agent access (MCP), then move the card in again.`;
}

/**
 * The server's address as an agent should dial it: brackets around IPv6, and a wildcard bind turned
 * into the loopback address of its family. `null` for a zoned link-local address, which no URL
 * parser an MCP client uses accepts (see docs/mcp.md).
 */
export function mcpUrl(endpoint: Pick<McpEndpoint, "address" | "port">): string | null {
  const { address, port } = endpoint;
  if (address.includes("%")) return null;
  const v6 = address.includes(":");
  const host = isWildcardBindAddress(address) ? (v6 ? "::1" : "127.0.0.1") : address;
  return `http://${v6 ? `[${host}]` : host}:${port}${MCP_PATH}`;
}

function sameEndpoint(a: McpEndpoint | null, b: McpEndpoint): boolean {
  return a !== null && a.address === b.address && a.port === b.port && a.token === b.token;
}

/** The card and its board as the vault holds them now, and the agent the column asks for. Throws
 *  for a card or board that is gone or unreadable; `null` when the card no longer qualifies. */
async function reresolve(
  host: LaunchHost,
  request: LaunchRequest,
): Promise<{ file: TFile; agent: AgentConfig } | null> {
  const { app } = host.deps;
  const file = app.vault.getFileByPath(request.cardPath);
  if (file === null) throw new Error(`the card "${request.cardPath}" is gone`);
  const fm = await freshFrontmatter(app, file);
  const config = await launchingBoard(app, request, file);
  if (config === null || statusOf(fm) !== request.column) return null;
  const agent = resolveAgent(config, request.column, fm);
  return agent ? { file, agent } : null;
}

/**
 * The board as it stands now, or `null` when it can no longer launch this card: the note is not a
 * board any more (agent access would refuse it), or the card has left its card folder.
 */
async function launchingBoard(
  app: App,
  request: LaunchRequest,
  file: TFile,
): Promise<BoardConfig | null> {
  const board = app.vault.getFileByPath(request.boardPath);
  if (board === null) throw new Error(`the board "${request.boardPath}" is gone`);
  if (!isBoardFrontmatter(await readBoardFrontmatter(app, board, request.boardPath))) return null;
  const config = await readBoardConfig(app, board, request.boardPath);
  return file.path.startsWith(`${config.cardFolder}/`) ? config : null;
}

/**
 * Whether the launch still stands on what it was decided from: the card in the column with this
 * run's marker, the board asking for the same agent (an edit since is a launch to decide again),
 * the request still current, and the same server and token.
 */
function lastLook(
  host: LaunchHost,
  request: LaunchRequest,
  now: {
    ready: { agent: AgentConfig; endpoint: McpEndpoint };
    fm: Record<string, unknown>;
    board: BoardConfig | null;
  },
): boolean {
  const { ready, fm, board } = now;
  if (statusOf(fm) !== request.column || agentRunOf(fm).id !== request.runId) return false;
  if (!board || !sameAgent(resolveAgent(board, request.column, fm), ready.agent)) return false;
  return host.isCurrent(request) && sameEndpoint(host.deps.endpoint(), ready.endpoint);
}

/** Whether two readings of the agent a column asks for say the same thing. */
function sameAgent(a: AgentConfig | null, b: AgentConfig): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

/** The folder the command runs in, checked to exist; `null`, with the user told, when it does not. */
async function workingFolder(
  deps: LaunchDeps,
  agent: AgentConfig,
  title: string,
): Promise<{ vaultPath: string; cwd: string } | null> {
  const vaultPath = deps.vaultPath();
  if (vaultPath === null) return null;
  const cwd = resolveCwd(agent.cwd, vaultPath, deps.homedir());
  const isFolder = await deps.stat(cwd).then(
    (s) => s.isDirectory(),
    (e: unknown) => {
      const code = (e as { code?: unknown } | null)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") return false;
      throw e;
    },
  );
  if (isFolder) return { vaultPath, cwd };
  deps.notify(
    `Folia Kanban: no agent was started for "${title}": its working folder ${cwd} does not exist or is not a folder. Fix \`cwd\` under \`agent:\` in the board note.`,
  );
  return null;
}

/** Everything the command is told, the token aside. */
function contextFor(
  host: LaunchHost,
  request: LaunchRequest,
  parts: { file: TFile; agent: AgentConfig; vaultPath: string; cwd: string; url: string },
): AgentContext {
  const { file, agent, vaultPath, cwd, url } = parts;
  return {
    vaultPath,
    board: request.boardPath,
    card: file.path,
    cardFile: `${vaultPath}/${file.path}`,
    cardSlug: cardSlug(file.path),
    column: request.column,
    cwd,
    model: agent.model ?? "",
    effort: agent.effort ?? "",
    args: agent.args ?? [],
    mcpUrl: url,
    modDir: `${vaultPath}/${host.deps.pluginDir}/${FOLIA_MOD_FOLDER}`,
    runId: request.runId ?? "",
  };
}

/** A blank template means the default: an emptied setting field is a reach for it. */
function template(value: string, fallback: string): string {
  return value.trim() === "" ? fallback : value;
}

/**
 * Run a launch to its hand-off. Returns without starting anything whenever the request stops being
 * current or the card stops qualifying; the caller clears a claimed marker and finishes the request
 * in every case. Throws for what nobody planned for: a card that vanished, YAML that broke.
 */
export async function performLaunch(host: LaunchHost, request: LaunchRequest): Promise<void> {
  const ready = await prepare(host, request);
  if (!ready || !host.isCurrent(request)) return;
  const { deps } = host;
  const { file, endpoint } = ready;
  request.runId = deps.newRunId();
  const claim = { id: request.runId, column: request.column };
  if (!(await claimMarker(deps.app, host.writer, file, claim))) return;
  request.claimed = file;
  if (!host.isCurrent(request)) return;
  // The board first and the card last: the card's status is what a launch is about, so its read
  // is the one nothing else may come after.
  const board = await launchingBoard(deps.app, request, file);
  const text = await deps.app.vault.read(file);
  // Nothing below awaits until the command is handed over: this is the last look.
  if (!lastLook(host, request, { ready, fm: parseFrontmatter(text), board })) return;
  handOff(host, request, {
    ctx: contextFor(host, request, ready),
    token: endpoint.token,
    file,
  });
  host.finish(request);
  await recordLaunch(host, file, request.runId);
}

/** Everything a launch decides before it touches the card, or `null`, the user told why when it
 *  is worth telling, for a launch that will not happen. */
async function prepare(
  host: LaunchHost,
  request: LaunchRequest,
): Promise<{
  file: TFile;
  agent: AgentConfig;
  endpoint: McpEndpoint;
  url: string;
  vaultPath: string;
  cwd: string;
} | null> {
  const { deps } = host;
  const resolved = await reresolve(host, request);
  if (!resolved || !host.isCurrent(request)) return null;
  const { file, agent } = resolved;
  const endpoint = deps.endpoint();
  if (endpoint === null) {
    deps.notify(noServerNotice(file.basename));
    return null;
  }
  const url = mcpUrl(endpoint);
  if (url === null) {
    deps.notify(
      `Folia Kanban: no agent was started for "${file.basename}": agent access listens on a link-local address with an interface (${endpoint.address}), which no MCP client can dial. Bind it to another address.`,
    );
    return null;
  }
  const folder = await workingFolder(deps, agent, file.basename);
  if (!folder || !host.isCurrent(request) || !(await installMod(deps, file.basename))) return null;
  return { file, agent, endpoint, url, ...folder };
}

/** Put the Folia Mod in place for the session, or tell the user why it could not be. */
async function installMod(deps: LaunchDeps, title: string): Promise<boolean> {
  const dir = `${deps.pluginDir}/${FOLIA_MOD_FOLDER}`;
  try {
    await deps.installMod(dir);
    return true;
  } catch (e) {
    deps.notify(
      `Folia Kanban: no agent was started for "${title}": the Folia Mod could not be written to ${dir}. ${String(e)}`,
    );
    return false;
  }
}

/** Fill both templates and start the command, in the same synchronous step as the last look. */
function handOff(
  host: LaunchHost,
  request: LaunchRequest,
  launch: { ctx: AgentContext; token: string; file: TFile },
): void {
  const { deps } = host;
  const settings = deps.settings();
  const prompt = fillPrompt(template(settings.agentPrompt, DEFAULT_AGENT_PROMPT), launch.ctx);
  const command = fillCommand(
    template(settings.agentCommand, DEFAULT_AGENT_COMMAND),
    launch.ctx,
    prompt,
  );
  const runId = launch.ctx.runId;
  deps.spawn(
    { command, cwd: launch.ctx.cwd, env: agentEnvironment(launch.ctx, prompt, launch.token) },
    (why) => {
      afterFailure(host, launch.file, { runId, why }).catch((e: unknown) =>
        deps.notify(
          `Folia Kanban: could not clear the run marker on "${launch.file.basename}". ${String(e)}`,
        ),
      );
    },
  );
  request.handedOff = true;
}

/** The command ended badly before the agent took over: take the marker back and say why. */
async function afterFailure(
  host: LaunchHost,
  file: TFile,
  failure: { runId: string; why: string },
): Promise<void> {
  const { app, notify } = host.deps;
  const hint =
    failure.why === "exited with code 127"
      ? " Is tmux, or claude, installed and on the PATH the command sets?"
      : "";
  try {
    // The `TFile` follows renames; a note recreated at the old path after a delete is not this one.
    if (app.vault.getFileByPath(file.path) === file)
      await clearMarker(app, host.writer, file, byRunId(failure.runId));
  } finally {
    notify(
      `Folia Kanban: the agent command for "${file.basename}" failed (${failure.why}) before the agent started. Check Settings → Folia Kanban → Agents in columns.${hint}`,
    );
  }
}

/** "Agent launch requested", best effort: a history that cannot be written does not undo a launch. */
async function recordLaunch(host: LaunchHost, file: TFile, runId: string): Promise<void> {
  const { settings, notify } = host.deps;
  if (!historyAllows(settings().historyScope, "agent")) return;
  try {
    await host.writer.editBody(file.path, (t) => appendHistory(t, agentLaunchLine(runId), stamp()));
  } catch (e) {
    notify(
      `Folia Kanban: the agent for "${file.basename}" was started, but its history line could not be written. ${String(e)}`,
    );
  }
}
