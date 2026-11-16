import type { App, TFile } from "obsidian";
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

// The same refusal while a note was only being read, where nothing was being written.
const READ_REASONS: Readonly<Record<string, string>> = {
  EACCES: "permission denied",
  EPERM: "permission denied",
};

/** The file system's code for an error: the one it carries, or the one its message opens with. */
function errorCode(e: unknown, message: string): string | null {
  const carried = typeof e === "object" && e !== null && "code" in e ? e.code : null;
  if (typeof carried === "string") return carried;
  return /^(E[A-Z0-9]{2,}): /.exec(message)?.[1] ?? null;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The vault's folder on this computer, as it opens an absolute path; `""` where it has none. */
function vaultFolder(app: App): string {
  const adapter = app.vault.adapter;
  return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
}

/**
 * Why a write failed, as a clause another sentence can carry: in plain words where the file system
 * gave a code for it, and otherwise in the error's own words with the vault's folder taken out, so
 * no absolute path reaches the board. The raw error goes to the developer console. `doing` is
 * `"read"` for a note that was only being read.
 */
export function failure(app: App, e: unknown, doing: "write" | "read" = "write"): string {
  console.error(`Folia Kanban: a ${doing} failed`, e);
  const message = messageOf(e);
  const code = errorCode(e, message) ?? "";
  const known = (doing === "read" ? READ_REASONS[code] : undefined) ?? REASONS[code];
  if (known !== undefined) return known;
  const base = vaultFolder(app);
  const shown = base ? message.split(`${base}/`).join("").split(`${base}\\`).join("") : message;
  return shown.replace(/\.$/, "");
}

/** {@link failure} as an error of its own, for a write that failed with nothing else to say. */
export function unwritten(app: App, e: unknown): Error {
  const why = failure(app, e);
  return new Error(`${why.charAt(0).toUpperCase()}${why.slice(1)}.`, { cause: e });
}

/** Whether a message is the file system's own: it opens with a code, or names an absolute path. */
function isRaw(app: App, e: unknown): boolean {
  const message = messageOf(e);
  const base = vaultFolder(app);
  return (errorCode(e, message) ?? "") in REASONS || (base !== "" && message.includes(base));
}

/**
 * A failure as the person may be shown it. One that already reads in plain words is handed back
 * as it is, so that what it is (a refusal, a `PartlyWritten`) is kept; the file system's own goes
 * through {@link unwritten}.
 */
export function readable(app: App, e: unknown): unknown {
  return isRaw(app, e) ? unwritten(app, e) : e;
}

/** {@link readable} for a message that is all there is left of the failure. */
export function readableMessage(app: App, message: string): string {
  return isRaw(app, message) ? unwritten(app, message).message : message;
}

/**
 * A note's text. When it cannot be read the failure names the note by its vault path and says why
 * as {@link failure} does: the file system's own error names it by its absolute path.
 */
export async function readNote(app: App, file: TFile): Promise<string> {
  try {
    return await app.vault.cachedRead(file);
  } catch (e) {
    throw new Error(`${file.path} cannot be read: ${failure(app, e, "read")}`, { cause: e });
  }
}
