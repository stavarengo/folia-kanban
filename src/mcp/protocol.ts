// The MCP methods this server answers, over JSON-RPC 2.0, with no transport in sight: a message
// goes in, a response (or `null`, for a notification, which gets no reply) comes out. The Node
// HTTP adapter in httpServer.ts is what turns that into requests and responses on a socket.
//
// The surface is deliberately the small half of the Model Context Protocol a board needs: tools,
// no resources, no prompts, no server-initiated messages. That is why the official SDK is not a
// dependency here — it would have added ~300 KB to a 780 KB plugin bundle, and its own HTTP
// server, to implement `initialize` + `tools/list` + `tools/call`.

import { z } from "zod";
import type { BoardHost } from "./host";
import { ToolError, type ToolDefinition } from "./tool";
import { TOOLS } from "./tools";

/** The protocol revision this server implements and reports from `initialize`. */
export const PROTOCOL_VERSION = "2025-06-18";

/** JSON-RPC error codes, as the spec names them. */
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const MessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).nullish(),
  method: z.string(),
  params: z.unknown().optional(),
});

const CallSchema = z.object({ name: z.string(), arguments: z.unknown().optional() });

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolListing(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    // A write tool here really can destroy something a person cares about: update_card clears
    // frontmatter keys and move_card rewrites status and order. Saying otherwise is not a
    // harmless nicety — a client that auto-approves non-destructive tools reads this and stops
    // asking. `destructiveHint` is only meaningful for a tool that writes at all.
    annotations: {
      readOnlyHint: tool.readOnly,
      destructiveHint: !tool.readOnly,
      openWorldHint: false,
    },
  };
}

/** A tool result as MCP carries it: one text block holding the JSON the tool returned. */
function toolResult(value: unknown, isError = false): Record<string, unknown> {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
}

async function callTool(host: BoardHost, params: unknown): Promise<Record<string, unknown>> {
  const call = CallSchema.safeParse(params);
  if (!call.success) throw new ProtocolError(INVALID_PARAMS, z.prettifyError(call.error));
  const tool = TOOLS.find((t) => t.name === call.data.name);
  if (!tool) {
    throw new ProtocolError(
      INVALID_PARAMS,
      `Unknown tool "${call.data.name}". This server offers: ${TOOLS.map((t) => t.name).join(", ")}.`,
    );
  }
  try {
    return toolResult(await tool.invoke(host, call.data.arguments));
  } catch (e) {
    // A tool failure is reported to the model, not to the transport: it is usually something the
    // caller can fix on the next attempt (a card that moved, a column that does not exist).
    if (e instanceof ToolError) return toolResult(e.message, true);
    return toolResult(`${tool.name} failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

/** A failure that belongs in the JSON-RPC `error` field rather than in a tool result. */
class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function initialize(info: ServerInfo): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: info,
    instructions:
      "Drives Folia Kanban boards in this Obsidian vault. Call list_boards first, then get_board for a board's columns and cards. Every write goes through the plugin, so cards get the same history lines they get when a person edits them by hand — do not edit the card files directly.",
  };
}

async function dispatch(
  host: BoardHost,
  info: ServerInfo,
  method: string,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "initialize":
      return initialize(info);
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(toolListing) };
    case "tools/call":
      return await callTool(host, params);
    default:
      throw new ProtocolError(METHOD_NOT_FOUND, `Unsupported method "${method}".`);
  }
}

/**
 * Answer one JSON-RPC message. `null` means "nothing to send back": a notification, or a response
 * the client sent us (this server never asks the client anything, so one can only be stray).
 */
export async function handleMessage(
  host: BoardHost,
  info: ServerInfo,
  message: unknown,
): Promise<JsonRpcResponse | null> {
  const parsed = MessageSchema.safeParse(message);
  if (!parsed.success) {
    if (message && typeof message === "object" && "result" in message) return null;
    return jsonRpcError(null, INVALID_REQUEST, z.prettifyError(parsed.error));
  }
  const { method, params } = parsed.data;
  const id = parsed.data.id ?? null;
  // A message without an id is a notification: it is acted on, and nothing is sent back — not even
  // when it names a method we do not have. JSON-RPC means *absent*, not null: `"id": null` is a
  // request, and a buggy client that sends one would otherwise have its write carried out and be
  // told nothing about it.
  const isNotification = parsed.data.id === undefined;
  try {
    const result = await dispatch(host, info, method, params);
    return isNotification ? null : ok(id, result);
  } catch (e) {
    return isNotification ? null : failureOf(id, e);
  }
}

function failureOf(id: string | number | null, e: unknown): JsonRpcResponse {
  if (e instanceof ProtocolError) return jsonRpcError(id, e.code, e.message);
  return jsonRpcError(id, INTERNAL_ERROR, e instanceof Error ? e.message : String(e));
}
