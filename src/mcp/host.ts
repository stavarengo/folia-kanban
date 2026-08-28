// What the MCP tools need from whatever is hosting them. The plugin implements this against the
// vault; the tests implement it over in-memory repositories. Nothing below this line knows about
// Obsidian, HTTP or JSON-RPC.

import type { CardRepository } from "../model/repo";

/** A board the server can address: the vault path of its note, and what to call it. */
export interface BoardRef {
  path: string;
  name: string;
}

export interface BoardHost {
  /** Every board note in the vault, in whatever order the host finds them. */
  listBoards(): BoardRef[];
  /**
   * A repository bound to one board note, or `null` when that path is not a board. It is the same
   * port the board view uses, so a tool that writes through it writes exactly what a person
   * clicking in the UI would — history lines, signed comments and all.
   */
  repoFor(boardPath: string): CardRepository | null;
}
