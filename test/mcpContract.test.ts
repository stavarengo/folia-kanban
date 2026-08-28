// The published contract of the MCP server, snapshotted. This is what `pnpm contracts:check` runs.
//
// Somebody else's agent is configured against these names and these argument schemas. A rename, a
// dropped argument, a field that stops being required — each one silently breaks that agent at run
// time, in their vault, not here. So the surface is frozen in a snapshot: changing it on purpose
// means updating the snapshot (`pnpm test -- -u`) and saying so in the commit, and changing it by
// accident fails the build.
//
// The freeze is taken from the `tools/list` reply itself rather than from the `TOOLS` array behind
// it, because the reply is what a client reads. Anything the protocol layer adds on the way out —
// the `annotations` that tell a client whether a tool is destructive, and so whether to ask before
// running it — is part of the contract too, and snapshotting the array would leave it unwatched.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { handleMessage, PROTOCOL_VERSION, type ServerInfo } from "../src/mcp/protocol";
import { TOOLS } from "../src/mcp/tools";
import type { BoardHost } from "../src/mcp/host";

/** Resolved from the project root, which is where vitest runs. */
const SNAPSHOT_FILE = "test/__snapshots__/mcpContract.test.ts.snap";

const INFO: ServerInfo = { name: "folia-kanban", title: "Folia Kanban", version: "0.0.0" };

/** No board is opened by `tools/list`, so the surface does not depend on a vault. */
const host: BoardHost = { listBoards: () => [], repoFor: () => null };

async function toolListing(): Promise<unknown> {
  const reply = await handleMessage(host, INFO, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  return (reply?.result as { tools: unknown }).tools;
}

describe("the MCP contract", () => {
  it("speaks a fixed protocol revision", () => {
    expect(PROTOCOL_VERSION).toMatchSnapshot();
  });

  it("publishes this exact tool surface, annotations and all", async () => {
    expect(await toolListing()).toMatchSnapshot();
  });

  it("tells a client which tools can destroy something, so it knows what to ask about", async () => {
    const tools = (await toolListing()) as {
      name: string;
      annotations: { readOnlyHint: boolean; destructiveHint: boolean };
    }[];
    // Not a restatement of the snapshot: this is the one annotation a client acts on without
    // asking a person, so it is asserted as a rule rather than as a recorded value. Every tool
    // that writes is destructive; a reader never is.
    for (const tool of tools) {
      expect(tool.annotations.destructiveHint).toBe(!tool.annotations.readOnlyHint);
    }
    expect(tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name)).toEqual([
      "create_card",
      "move_card",
      "update_card",
      "add_comment",
      "add_subtask",
      "set_subtask_done",
    ]);
  });

  it("gives every tool a unique name", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // A snapshot only freezes anything while the file is there. Deleted, vitest writes a new one and
  // every assertion above passes against whatever the code happens to do that day — a contract
  // check that agrees with itself. So the committed file is read directly, outside the snapshot
  // machinery: it has to exist, and it has to still name every tool.
  it("keeps the recorded surface on disk, where a fresh run cannot quietly re-agree with itself", () => {
    const recorded = readFileSync(SNAPSHOT_FILE, "utf8");
    for (const tool of TOOLS) expect(recorded).toContain(`"name": "${tool.name}"`);
  });
});
