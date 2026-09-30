import type { App, TFile } from "obsidian";
import type { LineDrift, LineRef, RelationType, SubtaskRef } from "../model/types";
import { staleLine } from "../model/repo";
import { commentDrift, subtaskDrift } from "../model/card";
import { DataCorruptionError } from "../model/schemas";
import { parseFrontmatter, sameValue } from "./frontmatter";

/** How long a vault event on a path this writer just wrote is taken for the echo of that write. */
const ECHO_WINDOW_MS = 2500;

/**
 * Every write the repository makes to a note, and the record of which paths it wrote a moment ago.
 * That record is what lets `onChange` drop the vault's echo of our own writes: Obsidian's events
 * carry the file and nothing about who changed it, so time is the only signal there is.
 */
export class NoteWriter {
  private recentWrites = new Map<string, number>();

  constructor(private app: App) {}

  file(path: string): TFile {
    const f = this.app.vault.getFileByPath(path);
    if (f === null) throw new Error(`Not a file: ${path}`);
    return f;
  }

  markWrite(path: string): void {
    this.recentWrites.set(path, Date.now());
  }

  /** Stop treating a path as ours: the write it was marked for did not happen. */
  forgetWrite(path: string): void {
    this.recentWrites.delete(path);
  }

  wroteRecently(path: string): boolean {
    return this.recentWrites.has(path);
  }

  /** Whether a vault event on `path` is the echo of our own write, pruning an entry that expired. */
  isEcho(path: string): boolean {
    const last = this.recentWrites.get(path);
    if (last === undefined) return false;
    if (Date.now() - last < ECHO_WINDOW_MS) return true; // our own write — we reload explicitly
    this.recentWrites.delete(path); // prune the stale echo-guard entry
    return false;
  }

  /**
   * The note's frontmatter as the file holds it right now, or null when it cannot be read as YAML.
   *
   * Every frontmatter write asks this first, because `processFrontMatter` re-serializes the whole
   * block whether or not anything in it changes: a flow list like `tags: [a, b]` comes back as a
   * block list, quotes come and go. So a write that would store what is already there must not be
   * made at all. `read`, not `cachedRead`, since this decides whether a write happens. The look and
   * the write are two steps, so a change landing between them is written over by the value the
   * caller asked for — which is the value it would have written anyway.
   */
  async currentFrontmatter(path: string): Promise<Record<string, unknown> | null> {
    try {
      return parseFrontmatter(await this.app.vault.read(this.file(path)));
    } catch (e) {
      // Unparseable YAML is the frontmatter write's to report, exactly as it was before this look.
      if (e instanceof DataCorruptionError) return null;
      throw e;
    }
  }

  /**
   * Raw frontmatter write — NO history. The move path (applyMove) uses this so it never
   * double-emits a structural line on top of its own "Moved …" entry. Returns the keys whose stored
   * value actually changed; when none would, the note is not touched.
   */
  async writeFrontmatter(path: string, patch: Record<string, unknown>): Promise<string[]> {
    const fm = await this.currentFrontmatter(path);
    const changed = Object.keys(patch).filter(
      (k) => fm === null || !(k in fm) || !sameValue(fm[k], patch[k]),
    );
    if (changed.length === 0) return [];
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(
      this.file(path),
      (fm: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(patch)) fm[k] = v;
      },
    );
    return changed;
  }

  /** Remove one key; false, with the note untouched, when it does not carry that key. */
  async unsetKey(path: string, key: string): Promise<boolean> {
    const fm = await this.currentFrontmatter(path);
    if (fm !== null && !(key in fm)) return false;
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(
      this.file(path),
      (fm: Record<string, unknown>) => {
        delete fm[key];
      },
    );
    return true;
  }

  /**
   * Rewrite a note's text through `fn`. Returns whether it changed; when `fn` would hand the text
   * back as it is, nothing is written. `fn` is run once on a fresh read to decide that, and again
   * inside `process`, on the text the write is actually made on — so it must be a pure function of
   * the text it is given.
   */
  async editBody(path: string, fn: (text: string) => string): Promise<boolean> {
    const file = this.file(path);
    const now = await this.app.vault.read(file);
    if (fn(now) === now) return false;
    let changed = false;
    this.markWrite(path);
    await this.app.vault.process(file, (t) => {
      const next = fn(t);
      changed = next !== t;
      return next;
    });
    return changed;
  }

  /**
   * Edit one line of a note, but only while the note still reads the way the caller described it.
   * `vault.process` is what makes a read-modify-write see the current bytes, so the check belongs
   * INSIDE its callback — against the very text the edit is about to be made on, not against a
   * snapshot read before it. A note that has moved on since is handed straight back, byte for byte,
   * and the refusal is raised after the write returns rather than thrown out of the callback: what
   * `process` does with a throw from inside is not ours to promise.
   */
  async editLine(
    path: string,
    line: { kind: "subtask"; at: SubtaskRef } | { kind: "comment"; at: LineRef },
    write: (text: string) => string,
  ): Promise<boolean> {
    let drift: LineDrift | null = null;
    const changed = await this.editBody(path, (t) => {
      drift = line.kind === "subtask" ? subtaskDrift(t, line.at) : commentDrift(t, line.at);
      return drift ? t : write(t);
    });
    if (drift === null) return changed;
    // Nothing was written, so the echo guard this call set on the way in is guarding nothing:
    // dropping it keeps the next change from elsewhere — the very change that made this one
    // refuse — from being swallowed as ours. At worst it costs one extra reload, when an earlier
    // write of ours really did land on this note moments ago.
    this.forgetWrite(path);
    throw staleLine(line.kind, path, line.at, drift);
  }

  /**
   * Rewrite a card's stored list for one relationship type, INSIDE the frontmatter write.
   *
   * The read-modify-write happens in the `processFrontMatter` callback rather than against a
   * `cachedRead` snapshot taken before it, so two edits landing back to back add up instead of
   * clobbering each other (the same reason `rememberPriorities` merges inside its write). Returns
   * whether anything actually changed, so an already-declared link writes no history line.
   */
  async editRelations(
    path: string,
    type: RelationType,
    rewrite: (fm: Record<string, unknown>) => string[] | null,
  ): Promise<boolean> {
    // Asked of the note as it is first: a callback that bails out still has the whole block
    // re-serialized (see `currentFrontmatter`), so a list that stays as it is must not be written.
    const fm = await this.currentFrontmatter(path);
    if (fm !== null && rewrite(fm) === null) return false;
    let changed = false;
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(
      this.file(path),
      (fm: Record<string, unknown>) => {
        const next = rewrite(fm);
        if (next === null) return;
        // An empty list means the card declares no such relationship any more, so the key goes
        // with it — the note is left as if it had never had one, not carrying a `blocks: []`.
        if (next.length === 0) delete fm[type];
        else fm[type] = next;
        changed = true;
      },
    );
    return changed;
  }
}
