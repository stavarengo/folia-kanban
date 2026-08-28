// The transport: MCP Streamable HTTP over Node's http server, bound to loopback and gated by a
// bearer token.
//
// It lives in the adapter layer rather than beside the tools because Node is a platform detail. The
// bundle marks Node builtins external, so a top-level import would become a `require` that runs
// when the plugin loads, and there is no `http` on mobile — that would throw before the board ever
// rendered. So the module is loaded with a dynamic import inside `startMcpServer`, behind the same
// `Platform.isDesktop` check the plugin makes before it ever builds one, and the types it needs are
// written inline: a type is erased at build time, an import statement is not.
//
// Only POST is answered. The protocol allows a server to open an SSE stream for messages it starts
// itself; this one never starts any, so a GET is refused rather than left hanging.

import { Platform } from "obsidian";
import type { BoardHost } from "../mcp/host";
import { PROTOCOL_VERSION, handleMessage, jsonRpcError, type ServerInfo } from "../mcp/protocol";

type IncomingMessage = import("http").IncomingMessage;
type ServerResponse = import("http").ServerResponse;
type Server = import("http").Server;

/** The path clients post to, appended to `http://127.0.0.1:<port>`. */
export const MCP_PATH = "/mcp";

/** Loopback is the only interface the server is ever bound to. */
export const MCP_HOST = "127.0.0.1";

/** A request body larger than this is refused unread: no board call needs a megabyte of JSON. */
const MAX_BODY_BYTES = 1_000_000;

const PARSE_ERROR = -32700;

export interface McpServerOptions {
  host: BoardHost;
  info: ServerInfo;
  port: number;
  /** The bearer token every request must carry. Never empty — the server refuses to start. */
  token: string;
}

export interface RunningMcpServer {
  /** The port actually bound, which is what a `0` port resolves to. */
  port: number;
  /** The interface actually bound. Always loopback; reported so a test can say so of the socket
   *  rather than of the constant it was asked to use. */
  address: string;
  close(): Promise<void>;
}

/**
 * Compare two secrets without letting the time taken say how much of the guess was right: every
 * character is looked at whether or not an earlier one already differed, and a length mismatch
 * folds into the same accumulator instead of returning early.
 *
 * It does not hide the real token's length — the loop runs as many times as the longer of the two
 * — and it is not trying to. That would need a fixed-width comparison, and the length of a
 * constant-width token is not the secret; its contents are.
 */
function secretsMatch(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const span = Math.max(a.length, b.length);
  for (let i = 0; i < span; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * A browser page on any origin can post to a loopback server, so a request that carries an
 * `Origin` is only accepted when that origin is loopback too. Requests without one — every MCP
 * client — are unaffected. `null` is an origin, not the absence of one: it is what a sandboxed
 * iframe and a `file://` page send, so it is refused rather than waved through.
 */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return true;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (body === null) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** Raised when a request body runs past {@link MAX_BODY_BYTES}, so it is answered as its own thing
 *  rather than as malformed JSON. */
class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Stop reading, but leave the socket alive: the answer still has to reach the client, and a
      // destroyed connection would reach it as a reset with nothing to learn from.
      if (size > MAX_BODY_BYTES) {
        req.pause();
        reject(new BodyTooLarge(`Request body is larger than ${MAX_BODY_BYTES} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Everything a request must satisfy before it is allowed to mean anything. Null = it may proceed. */
function reject(
  req: IncomingMessage,
  options: McpServerOptions,
): { status: number; body: unknown } | null {
  if (!originAllowed(req)) {
    return { status: 403, body: { error: "Only loopback origins may call this server." } };
  }
  if (!secretsMatch(bearerToken(req) ?? "", options.token)) {
    return { status: 401, body: { error: "Missing or wrong bearer token." } };
  }
  const path = (req.url ?? "").split("?")[0];
  if (path !== MCP_PATH) return { status: 404, body: { error: `Post to ${MCP_PATH}.` } };
  if (req.method !== "POST") {
    return { status: 405, body: { error: "This server answers POST only." } };
  }
  return null;
}

async function respond(req: IncomingMessage, res: ServerResponse, options: McpServerOptions) {
  const refusal = reject(req, options);
  if (refusal) {
    if (refusal.status === 401) res.setHeader("www-authenticate", "Bearer");
    if (refusal.status === 405) res.setHeader("allow", "POST");
    send(res, refusal.status, refusal.body);
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(await readBody(req));
  } catch (e) {
    if (e instanceof BodyTooLarge) {
      send(res, 413, { error: e.message });
      return;
    }
    send(res, 400, jsonRpcError(null, PARSE_ERROR, e instanceof Error ? e.message : String(e)));
    return;
  }
  if (Array.isArray(message)) {
    send(res, 400, jsonRpcError(null, PARSE_ERROR, "Batched requests are not supported."));
    return;
  }
  const reply = await handleMessage(options.host, options.info, message);
  res.setHeader("mcp-protocol-version", PROTOCOL_VERSION);
  // A notification is acknowledged and nothing more, which is what 202 is for.
  send(res, reply ? 200 : 202, reply);
}

/**
 * Start the server. Rejects when the platform has no server to give, the port is taken or the token
 * is empty, so a caller can say what went wrong instead of leaving a dead toggle switched on.
 */
export async function startMcpServer(options: McpServerOptions): Promise<RunningMcpServer> {
  if (!Platform.isDesktop) throw new Error("Agent access needs a desktop; mobile has no server.");
  if (!options.token) throw new Error("The MCP server needs a token before it can be started.");
  const { createServer } = await import("http");
  // One request at a time. Every write tool reads the board, computes against what it read, and
  // writes it back; two moves into the same column in flight together would each compute an order
  // from the same snapshot and hand the two cards the same slot. The board view never had this
  // shape — a person does one thing at a time — and an agent making six calls at once does not, so
  // the transport imposes it. A board call is milliseconds of local file work; nothing is waiting
  // long enough for the lost parallelism to matter.
  let turn: Promise<void> = Promise.resolve();
  const server: Server = createServer((req, res) => {
    const answer = () =>
      respond(req, res, options).catch(() => {
        if (!res.headersSent) send(res, 500, { error: "The board plugin failed to answer." });
        else res.end();
      });
    turn = turn.then(answer, answer);
  });
  return await listen(server, options.port);
}

function listen(server: Server, port: number): Promise<RunningMcpServer> {
  return new Promise((resolve, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, MCP_HOST, () => {
      server.removeListener("error", rejectStart);
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : port,
        address: typeof address === "object" && address ? address.address : MCP_HOST,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
