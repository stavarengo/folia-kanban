// What happens to path-keyed state when a file operation happens outside the plugin's own actions
// (the file explorer, another plugin, a direct edit on disk). Pure: no vault, no settings type —
// the adapter turns a vault event into a `FileOp`, and the settings layer decides which maps to run
// through here.
//
// A folder counts as its own path plus everything under it: Obsidian fires ONE rename/delete event
// for a renamed or deleted folder, never one per child, so a move of the card folder has to be
// matched by prefix or every key under it is stranded.

/** A rename (a move is a rename) or a delete, of a file or a folder. Paths are vault-relative. */
export type FileOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "delete"; path: string };

/** Is `path` the operated-on file/folder itself, or something inside it? */
function covers(target: string, path: string): boolean {
  return path === target || path.startsWith(target + "/");
}

/**
 * Where `path` ends up after `op`: its new path, the same string when the op did not touch it, or
 * `null` when the op took it away.
 */
export function remapPath(path: string, op: FileOp): string | null {
  if (op.kind === "delete") return covers(op.path, path) ? null : path;
  if (!covers(op.from, path)) return path;
  return op.to + path.slice(op.from.length);
}

/**
 * Re-key a path-keyed map through `op`, returning `null` when nothing in it was affected so the
 * caller can skip the write entirely.
 *
 * A rename onto a path the map already holds lets the moving entry win: it is the one the person
 * just acted on, and the stationary entry belonged to a file that no longer lives there.
 */
export function remapPathKeys<T>(map: Record<string, T>, op: FileOp): Record<string, T> | null {
  const moved: [string, T][] = [];
  const kept: Record<string, T> = {};
  let changed = false;
  for (const [key, value] of Object.entries(map)) {
    const next = remapPath(key, op);
    if (next === key) {
      kept[key] = value;
      continue;
    }
    changed = true;
    if (next !== null) moved.push([next, value]);
  }
  if (!changed) return null;
  for (const [key, value] of moved) kept[key] = value;
  return kept;
}

/** The folder a vault path lives in — `""` for a note at the vault root. */
export function parentFolder(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** A vault path's file name, extension included. */
export function baseName(path: string): string {
  return path.slice(parentFolder(path).length).replace(/^\//, "");
}

/**
 * `path` expressed relative to `folder`, climbing with `../` when it has to. A board note living
 * below the vault root sees its cards at a different place than the vault does, and `card-folder`
 * may point outside the board's own folder (`../shared/Cards`), so this is not a prefix strip.
 */
export function relativeToFolder(folder: string, path: string): string {
  const from = folder === "" ? [] : folder.split("/");
  const to = path.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const up = Array<string>(from.length - common).fill("..");
  return [...up, ...to.slice(common)].join("/");
}
