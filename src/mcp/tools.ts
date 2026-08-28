// The published tool surface, in the order a client sees it. This list and the Zod schemas behind
// it are a contract: `test/mcpContract.test.ts` snapshots both, so a rename or a schema change
// that would silently break somebody's agent fails the build instead.

import { BOARD_TOOLS } from "./boardTools";
import { CARD_TOOLS } from "./cardTools";
import type { ToolDefinition } from "./tool";

export const TOOLS: ToolDefinition[] = [...BOARD_TOOLS, ...CARD_TOOLS];
