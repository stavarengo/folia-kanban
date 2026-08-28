// The published contract of the MCP server, snapshotted. This is what `pnpm contracts:check` runs.
//
// Somebody else's agent is configured against these names and these argument schemas. A rename, a
// dropped argument, a field that stops being required — each one silently breaks that agent at run
// time, in their vault, not here. So the surface is frozen in a snapshot: changing it on purpose
// means updating the snapshot (`pnpm test -- -u`) and saying so in the commit, and changing it by
// accident fails the build.

import { describe, it, expect } from "vitest";
import { PROTOCOL_VERSION } from "../src/mcp/protocol";
import { TOOLS } from "../src/mcp/tools";

describe("the MCP contract", () => {
  it("speaks a fixed protocol revision", () => {
    expect(PROTOCOL_VERSION).toMatchSnapshot();
  });

  it("publishes this exact tool surface", () => {
    const surface = TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      readOnly: tool.readOnly,
      inputSchema: tool.inputSchema,
    }));
    expect(surface).toMatchSnapshot();
  });

  it("gives every tool a unique name", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
