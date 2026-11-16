import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";

// What the file system's error codes mean to the person who was saving something. The raw text
// names the system call and both absolute paths, which is the developer's reading of it.
const REASONS: Readonly<Record<string, string>> = {
  EACCES: "the file or its folder cannot be written to (permission denied)",
  EPERM: "the file or its folder cannot be written to (permission denied)",
  EROFS: "the vault is on a read-only disk",
  ENOSPC: "the disk is full",
  EDQUOT: "the disk is full",
  EBUSY: "the file is in use by another program",
  ETXTBSY: "the file is in use by another program",
  ENAMETOOLONG: "the file name or its path is too long for this disk",
  EEXIST: "a file with that name is already there",
  ENOENT: "the file or its folder is no longer there",
  EIO: "the disk reported an error",
  EMFILE: "too many files are open",
  ENFILE: "too many files are open",
};

/** The file system's code for an error: the one it carries, or the one its message opens with. */
function errorCode(e: unknown, message: string): string | null {
  const carried = typeof e === "object" && e !== null && "code" in e ? e.code : null;
  if (typeof carried === "string") return carried;
  return /^(E[A-Z0-9]{2,}): /.exec(message)?.[1] ?? null;
}

/**
 * Why a write failed, as a clause another sentence can carry: in plain words where the file system
 * gave a code for it, and otherwise in the error's own words with the vault's folder taken out, so
 * no absolute path reaches the board. The raw error goes to the developer console.
 */
export function failure(app: App, e: unknown): string {
  console.error("Folia Kanban: a write failed", e);
  const message = e instanceof Error ? e.message : String(e);
  const known = REASONS[errorCode(e, message) ?? ""];
  if (known !== undefined) return known;
  const adapter = app.vault.adapter;
  const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  const shown = base ? message.split(`${base}/`).join("").split(`${base}\\`).join("") : message;
  return shown.replace(/\.$/, "");
}

/** {@link failure} as an error of its own, for a write that failed with nothing else to say. */
export function unwritten(app: App, e: unknown): Error {
  const why = failure(app, e);
  return new Error(`${why.charAt(0).toUpperCase()}${why.slice(1)}.`, { cause: e });
}
