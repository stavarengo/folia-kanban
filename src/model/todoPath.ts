// A placed inline todo is a board item without a file. Its id is its owning note's path plus the
// checklist index — `#` cannot occur in an Obsidian vault path, so this can never collide with a
// real card, and it holds no `::`, so the drag-id namespacing still splits it correctly.
const TODO_PATH_SEP = "#todo:";

/** The synthetic board path for the index-th checklist line of the note at `parentPath`. */
export function makeTodoPath(parentPath: string, index: number): string {
  return parentPath + TODO_PATH_SEP + index;
}

/**
 * Read a synthetic inline-todo path back into the note that owns the line and the line's index,
 * or `null` for an ordinary card path. Every write path uses this to route to a real file.
 */
export function parseTodoPath(path: string): { parentPath: string; index: number } | null {
  const at = path.lastIndexOf(TODO_PATH_SEP);
  if (at < 0) return null;
  const index = Number(path.slice(at + TODO_PATH_SEP.length));
  if (!Number.isInteger(index) || index < 0) return null;
  return { parentPath: path.slice(0, at), index };
}
