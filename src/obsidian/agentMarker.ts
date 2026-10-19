// The two writes a launch makes to its card's `agent-run`: the claim, and the clear. Both decide
// inside `processFrontMatter`, on the very block they write, so a hand edit or a sync landing
// between the look and the write is never written over. Both look first and skip a write that would
// change nothing, since `processFrontMatter` re-serializes the whole block on every call.

import type { App, TFile } from "obsidian";
import { AGENT_RUN_KEY, agentRunOf, sameMarker, statusOf } from "../model/agent";
import { stamp } from "../model/dates";
import { parseFrontmatter } from "./frontmatter";
import type { NoteWriter } from "./noteWriter";

/** A card's frontmatter as the file holds it now. Throws on a file that is gone or unreadable. */
export async function freshFrontmatter(app: App, file: TFile): Promise<Record<string, unknown>> {
  return parseFrontmatter(await app.vault.read(file));
}

/**
 * Write `agent-run: {id, started, column}`, but only while the card stands in `column` and carries
 * no marker at all, whoever wrote it. True when it wrote.
 */
export async function claimMarker(
  app: App,
  writer: NoteWriter,
  file: TFile,
  claim: { id: string; column: string },
): Promise<boolean> {
  const may = (fm: Record<string, unknown>): boolean =>
    statusOf(fm) === claim.column && !agentRunOf(fm).present;
  if (!may(await freshFrontmatter(app, file))) return false;
  let wrote = false;
  writer.markWrite(file.path);
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (!may(fm)) return;
    fm[AGENT_RUN_KEY] = { id: claim.id, started: stamp(), column: claim.column };
    wrote = true;
  });
  return wrote;
}

/**
 * Which marker to take off, and when it is stale: `marker` is matched by id, or by content when it
 * has none, and `stale` is asked of the card's status at the moment of the write.
 */
export interface MarkerClear {
  marker: unknown;
  stale: (status: string | null) => boolean;
}

/** The clear for a marker this launch wrote: matched by its run id, whatever the card's status. */
export function byRunId(id: string): MarkerClear {
  return { marker: { id }, stale: () => true };
}

/** Take a marker off the card, only while it is still that marker and still stale. True when it did. */
export async function clearMarker(
  app: App,
  writer: NoteWriter,
  file: TFile,
  clear: MarkerClear,
): Promise<boolean> {
  const holds = (fm: Record<string, unknown>): boolean =>
    sameMarker(fm[AGENT_RUN_KEY], clear.marker) && clear.stale(statusOf(fm));
  if (!holds(await freshFrontmatter(app, file))) return false;
  let cleared = false;
  writer.markWrite(file.path);
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (!holds(fm)) return;
    delete fm[AGENT_RUN_KEY];
    cleared = true;
  });
  return cleared;
}
