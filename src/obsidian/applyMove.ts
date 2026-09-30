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

/** The repository's `applyMove`: the moved note first, its history line, then its parents. */
export async function applyMove(
  app: App,
  writer: NoteWriter,
  mutation: CardMutation,
  recordHistory: RecordHistory,
): Promise<void> {
  // Whether the moved note itself changed, which is what its history line describes: a move that
  // leaves it as it was (dropped back on its own slot, sent to the column it already stands in)
  // records nothing. The parent notes below keep their own count.
  let changed = await writePlacement(writer, mutation);
  if (await writeSubtaskStatus(writer, mutation)) changed = true;
  if (await syncClaim(app, writer, mutation)) changed = true;
  if (changed && mutation.history) {
    const historyLine = mutation.history;
    await writer.editBody(mutation.path, (t) => appendHistory(t, historyLine, stamp()));
  }
  await tickParents(writer, mutation.parentLines ?? [], recordHistory);
}

async function writePlacement(writer: NoteWriter, mutation: CardMutation): Promise<boolean> {
  let changed = false;
  if (mutation.setFrontmatter)
    changed = (await writer.writeFrontmatter(mutation.path, mutation.setFrontmatter)).length > 0;
  for (const key of mutation.unsetFrontmatter ?? []) {
    if (await writer.unsetKey(mutation.path, key)) changed = true;
  }
  return changed;
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
