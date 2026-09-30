import type { Board, BoardConfig, ColumnDef } from "./types";

const DONE_RE = /\b(done|complete|completed|finished|shipped|closed)\b/i;

/**
 * The column that means "finished": the one whose id is literally `done`, else the first whose id
 * or title reads as done, else none. Lives here rather than in the UI because the board graph needs
 * it too — a checked inline todo is done whatever its `[status:: …]` line says.
 */
export function findDoneColumn(columns: readonly ColumnDef[]): string | null {
  const exact = columns.find((c) => c.id.toLowerCase() === "done");
  if (exact) return exact.id;
  const fuzzy = columns.find((c) => DONE_RE.test(c.id) || DONE_RE.test(c.title));
  return fuzzy?.id ?? null;
}

export function columnTitle(config: BoardConfig, id: string): string {
  return config.columns.find((c) => c.id === id)?.title ?? id;
}

/** Column id that currently contains `path`, or null. */
export function columnOf(board: Board, path: string): string | null {
  for (const col of board.config.columns) {
    if (board.columns[col.id]?.includes(path)) return col.id;
  }
  return null;
}
