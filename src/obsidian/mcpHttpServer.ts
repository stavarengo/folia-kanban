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
import {
  PROTOCOL_VERSION,
  handleMessage,
  idOf,
  jsonRpcError,
  type ServerInfo,
} from "../mcp/protocol";

type IncomingMessage = import("http").IncomingMessage;
type ServerResponse = import("http").ServerResponse;
type Server = import("http").Server;

/** The path clients post to, appended to `http://127.0.0.1:<port>`. */
export const MCP_PATH = "/mcp";

/** Loopback is the only interface the server is ever bound to. */
export const MCP_HOST = "127.0.0.1";

/** A request body larger than this is refused unread: no board call needs a megabyte of JSON. */
const MAX_BODY_BYTES = 1_000_000;

/** How long a client gets to finish sending its headers, and then its whole request. */
const HEADERS_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How long one call may run before the client is told it is still waiting. Node's own timeouts bound how
 * long a client may take to *send* a request; nothing bounds how long answering one takes, and
 * because calls are answered strictly one at a time, a read that never settles would stop the
 * server answering anything again until the plugin is reloaded.
 */
const HANDLING_TIMEOUT_MS = 60_000;

const PARSE_ERROR = -32700;
const INTERNAL_ERROR = -32603;

export interface McpServerOptions {
  host: BoardHost;
  info: ServerInfo;
  port: number;
  /** The bearer token every request must carry. Never empty — the server refuses to start. */
  token: string;
  /** How long one call may take before the client is told it is still waiting. Tests set it low;
   *  everything else takes {@link HANDLING_TIMEOUT_MS}. */
  handlingTimeoutMs?: number;
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
  // A call answered by the handling timeout may still be running; when it finishes it must not
  // write a second time over a response that is already gone.
  if (res.writableEnded) return;
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
      // Stop collecting, but leave the socket alive: the 413 still has to reach the client, and a
      // destroyed connection would reach it as a reset with nothing to learn from. The rest of the
      // body is drained rather than left unread, so what the client is still sending cannot be
      // taken for the start of its next request on a kept-alive connection.
      if (size > MAX_BODY_BYTES) {
        req.resume();
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

/**
 * Everything that can be decided about a request without touching the board: auth, path, method,
 * and the body. Returns the parsed message wrapped, or `null` when the request has already been
 * answered — wrapped because a parsed body may legitimately be any value at all, `null` included.
 *
 * Deliberately outside the one-at-a-time queue. None of it reads or writes a card, so none of it
 * needs the lock — and a client that dribbles its body in would otherwise hold every other call up
 * while it did.
 */
async function prepare(
  req: IncomingMessage,
  res: ServerResponse,
  options: McpServerOptions,
): Promise<{ message: unknown } | null> {
  // Set before anything can go wrong, so a refusal identifies the protocol it is refusing under
  // too. A client deciding whether it is talking to a server it understands should not have to
  // guess from a 401.
  res.setHeader("mcp-protocol-version", PROTOCOL_VERSION);
  const refusal = reject(req, options);
  if (refusal) {
    if (refusal.status === 401) res.setHeader("www-authenticate", "Bearer");
    if (refusal.status === 405) res.setHeader("allow", "POST");
    send(res, refusal.status, refusal.body);
    return null;
  }
  let message: unknown;
  try {
    message = JSON.parse(await readBody(req));
  } catch (e) {
    if (e instanceof BodyTooLarge) {
      send(res, 413, { error: e.message });
      return null;
    }
    send(res, 400, jsonRpcError(null, PARSE_ERROR, e instanceof Error ? e.message : String(e)));
    return null;
  }
  if (Array.isArray(message)) {
    send(res, 400, jsonRpcError(null, PARSE_ERROR, "Batched requests are not supported."));
    return null;
  }
  return { message };
}

/** Answer one prepared message. This is the part that reads and writes the board. */
async function dispatch(
  res: ServerResponse,
  options: McpServerOptions,
  message: unknown,
): Promise<void> {
  const reply = await handleMessage(options.host, options.info, message);
  // A notification is acknowledged and nothing more, which is what 202 is for.
  send(res, reply ? 200 : 202, reply);
}

/**
 * Tell the client we have stopped waiting, once a call has taken too long.
 *
 * It does NOT release the queue. The call is still running and still holds its turn, because the
 * queue exists so that no two writes ever compute against the same snapshot of the board — trading
 * that away to unblock a stuck call would swap a stall for silently interleaved writes, which is
 * the bug the queue was built to prevent and a far worse one to have. So this frees the client to
 * stop waiting; the board stays consistent, and a call that truly never returns still needs the
 * plugin reloaded.
 *
 * `settled` cancels the timer, so a request that finishes normally leaves nothing behind.
 */
function answerLate(
  res: ServerResponse,
  settled: Promise<unknown>,
  ms: number,
  id: string | number | null,
): Promise<void> {
  const finished = new AbortController();
  void settled.then(
    () => finished.abort(),
    () => finished.abort(),
  );
  return new Promise((resolve) => {
    AbortSignal.timeout(ms).addEventListener(
      "abort",
      () => {
        // A JSON-RPC error rather than a bare object, so the client can match it to the call it
        // sent. It says the call may still be running because it is: retrying a create_card whose
        // 504 arrived early is how a board ends up with the card twice.
        send(
          res,
          504,
          jsonRpcError(
            id,
            INTERNAL_ERROR,
            "The board plugin has not answered this call yet. It is still running and may still complete — check the board before sending it again.",
          ),
        );
        resolve();
      },
      { once: true, signal: finished.signal },
    );
  });
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
  const deadline = options.handlingTimeoutMs ?? HANDLING_TIMEOUT_MS;
  const server: Server = createServer((req, res) => {
    void (async () => {
      const prepared = await prepare(req, res, options);
      if (prepared === null) return;
      const { message } = prepared;
      const work = () => dispatch(res, options, message);
      // `turn` is chained on the work itself and never on the deadline: the queue's whole purpose
      // is that two board calls never overlap, and letting it advance on a timeout would give that
      // up exactly when the board is slow enough for it to matter.
      const done = turn.then(work, work);
      turn = done;
      await Promise.race([done, answerLate(res, done, deadline, idOf(message))]);
    })().catch(() => {
      if (!res.headersSent) send(res, 500, { error: "The board plugin failed to answer." });
      else res.end();
    });
  });
  // Because calls are answered one at a time, a request that stalls is not its own problem: it is
  // everyone's, for as long as it lasts. Node's defaults would hold the queue for five minutes on
  // a client that sends headers announcing a body and then goes quiet. These are generous for
  // local file work measured in milliseconds and short enough that a dead client cannot wedge the
  // server behind it.
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
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
