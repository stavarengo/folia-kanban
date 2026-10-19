import type { App } from "obsidian";
import type { SubItem } from "../model/types";
import type { CardMutation } from "../model/board";
import { claimInStep } from "../model/board";
import {
  appendHistory,
  parseSubtasks,
  pendingSubcardLinks,
  setSubcardDone,
  setSubtaskDone,
  setSubtaskStatus,
} from "../model/card";
import { stamp } from "../model/dates";
import { subtaskDoneLine, subtaskReopenedLine, type HistoryEventKind } from "../model/history";
import type { NoteWriter } from "./noteWriter";

/** Append a history line for a kind of change, when the history scope in force allows it. */
export type RecordHistory = (path: string, kind: HistoryEventKind, line: string) => Promise<void>;

/** What the frontmatter half of a move changed: the keys set, the keys removed, and the
 *  frontmatter as the first of those writes found it. */
export interface Placement {
  changed: string[];
  removed: string[];
  before: Record<string, unknown>;
}

/** What `applyMove` calls back into: the history policy, and who hears where the note landed. */
export interface MoveHooks {
  recordHistory: RecordHistory;
  /** Called as soon as the moved note's frontmatter is written, before anything that can throw. */
  onPlaced?: (placement: Placement) => void;
}

/** The repository's `applyMove`: the moved note first, its history line, then its parents. */
export async function applyMove(
  app: App,
  writer: NoteWriter,
  mutation: CardMutation,
  hooks: MoveHooks,
): Promise<void> {
  const placement = await writePlacement(writer, mutation);
  if (placement) hooks.onPlaced?.(placement);
  // Whether the moved note itself changed, which is what its history line describes: a move that
  // leaves it as it was (dropped back on its own slot, sent to the column it already stands in)
  // records nothing. The parent notes below keep their own count.
  let changed = placement !== null && placement.changed.length + placement.removed.length > 0;
  if (await writeSubtaskStatus(writer, mutation)) changed = true;
  if (await syncClaim(app, writer, mutation)) changed = true;
  if (changed && mutation.history) {
    const historyLine = mutation.history;
    await writer.editBody(mutation.path, (t) => appendHistory(t, historyLine, stamp()));
  }
  await tickParents(writer, mutation.parentLines ?? [], hooks.recordHistory);
}

/** The frontmatter writes of a move, or `null` for a move that has none (a checklist line's). */
async function writePlacement(
  writer: NoteWriter,
  mutation: CardMutation,
): Promise<Placement | null> {
  const unset = mutation.unsetFrontmatter ?? [];
  if (!mutation.setFrontmatter && unset.length === 0) return null;
  let placement: Placement | null = null;
  if (mutation.setFrontmatter) {
    const { changed, before } = await writer.writeFrontmatter(
      mutation.path,
      mutation.setFrontmatter,
    );
    placement = { changed, removed: [], before };
  }
  for (const key of unset) {
    const { removed, before } = await writer.unsetKey(mutation.path, key);
    placement ??= { changed: [], removed: [], before };
    if (removed) placement.removed.push(key);
  }
  return placement;
}

async function writeSubtaskStatus(writer: NoteWriter, mutation: CardMutation): Promise<boolean> {
  if (!mutation.setSubtaskStatus) return false;
  // One edit for the whole line: the checkbox and the `[status:: …]` field are two halves of
  // where a subitem sits, so writing them separately would leave a moment where the board
  // reloads on a line that says two different things.
  const { status, done, ...at } = mutation.setSubtaskStatus;
  const { index } = at;
  return writer.editLine(mutation.path, { kind: "subtask", at }, (t) =>
    setSubtaskStatus(done === undefined ? t : setSubtaskDone(t, index, done), index, status),
  );
}

async function syncClaim(app: App, writer: NoteWriter, mutation: CardMutation): Promise<boolean> {
  if (!mutation.syncClaim) return false;
  // Where the claim belongs is worked out HERE, from the claim AND the box the note carries as
  // the write is made, rather than carried in from a reading taken when the box was clicked:
  // those can be minutes apart, and either half moving changes the answer. Read once first so a
  // line the rule moves nowhere is not rewritten at all (the same two looks `parentLines` takes
  // below), then decided again inside the write, which is the text that actually changes.
  const { doneColumn, ...at } = mutation.syncClaim;
  const { index, text } = at;
  const nextFor = (item: SubItem | undefined): string | null | undefined =>
    item && claimInStep(item.status ?? null, item.done, doneColumn);
  // `read`, not `cachedRead`: this look decides whether a write happens, and the display cache
  // is allowed to lag the file — not least behind the checkbox this very call just wrote.
  const seen = parseSubtasks(await app.vault.read(writer.file(mutation.path)))[index];
  // Skipped only when this IS the caller's line and the rule leaves its claim where it is. A
  // position that has become somebody else's line goes on into the write, which refuses it —
  // the tick that was already written is on a line whose claim nobody has kept in step, and
  // that is the caller's to hear rather than ours to pass over as "nothing to do".
  //
  // This look is the same read-then-write `parentLines` takes below, and carries the same
  // window: a claim that changes between it and the write is answered by the write, but one
  // that changes after a "nothing to do" read is not seen at all, and the line keeps a claim
  // the tick would have moved. The alternative is a `process` pass on every tick of every
  // claimless todo — a write of identical bytes, and the mtime and sync churn that goes with
  // it — for a window of one await.
  const settled =
    seen !== undefined &&
    seen.text === text &&
    seen.occurrence === at.occurrence &&
    nextFor(seen) === (seen.status ?? null);
  if (settled) return false;
  return writer.editLine(mutation.path, { kind: "subtask", at }, (t) => {
    const item = parseSubtasks(t)[index];
    const was = item?.status ?? null;
    const next = nextFor(item);
    return next === undefined || next === was ? t : setSubtaskStatus(t, index, next);
  });
}

/**
 * Last, and after the moved note's own record, so a parent that has gone missing since the board
 * loaded cannot stop the move itself from being recorded — nor the other parents from being
 * written; the first failure is raised once every note has had its turn. Each parent is read first
 * and left alone when it no longer needs the write. The box is the same edit a click on it would
 * make, so it leaves the same (scope-gated) trace, naming only the links that actually changed.
 */
async function tickParents(
  writer: NoteWriter,
  parentLines: NonNullable<CardMutation["parentLines"]>,
  recordHistory: RecordHistory,
): Promise<void> {
  let failure: Error | undefined;
  for (const { path, links, done } of parentLines) {
    try {
      // `editBody` skips a note that needs nothing, deciding on a fresh read; the lines named
      // below are the ones found inside the atomic write, which is the text the history describes.
      let pending: { link: string; text: string }[] = [];
      const edited = await writer.editBody(path, (t) => {
        pending = pendingSubcardLinks(t, links, done);
        return setSubcardDone(
          t,
          pending.map((p) => p.link),
          done,
        );
      });
      for (const { text } of edited ? pending : []) {
        await recordHistory(
          path,
          "subtask",
          done ? subtaskDoneLine(text) : subtaskReopenedLine(text),
        );
      }
    } catch (e) {
      failure ??= e instanceof Error ? e : new Error(String(e));
    }
  }
  if (failure !== undefined) throw failure;
}
