// Naming a card's file after its title: where a new card goes, and what a retitle writes. Every
// step is ordered so that a failure halfway never costs the title that was typed.

import type { App, TFile } from "obsidian";
import { FileSystemAdapter, normalizePath } from "obsidian";
import {
  TITLE_KEY,
  cardFileName,
  resolveTitle,
  retargetTitleLinks,
  retitleHeading,
  sameTitle,
  type HeadingRetitle,
} from "../model/cardTitle";
import { dateOnly } from "../model/dates";
import { baseName } from "../model/pathOps";
import { PartlyWritten } from "../model/repo";
import type { TitleMode } from "../model/types";
import { ambiguousCaseMessage, type ResolvedBoardConfig } from "./boardConfig";
import { failure, unwritten } from "./failures";
import { parseFrontmatter } from "./frontmatter";
import type { NoteWriter } from "./noteWriter";
import { pathTaken } from "./pathTaken";
import { linkTextTo, resolveLink } from "./vaultLinks";

// Windows refuses a whole path over 260 characters, counted in UTF-16 units. A card's whole path,
// `.md` and the number that tells two notes apart included, stays within this.
const PATH_CHARS = 240;
/** The least room a folder must leave for a card's name, before its extension. */
const SHORTEST_NAME = 20;
const EXTENSION = ".md";

/** What these writes go through: the vault, and the writer that marks them as the board's own. */
export interface CardFiles {
  app: App;
  writer: NoteWriter;
}

/** Whether the note at `path` is named with exactly `title`, so nothing else has to hold it. */
function namedExactly(path: string, title: string): boolean {
  return sameTitle(baseName(path).replace(/\.md$/i, ""), title);
}

/**
 * Where a card titled `title` goes in `folder`: a file named after the title, cut to what a path
 * can hold on this computer, and numbered past a name already taken. `except` is the card's own
 * path when it is the one being renamed.
 */
function cardPath(app: App, folder: string, title: string, except?: string): string {
  const adapter = app.vault.adapter;
  const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  const room =
    PATH_CHARS - (vaultPath ? vaultPath.length + 1 : 0) - (folder ? folder.length + 1 : 0);
  if (room < SHORTEST_NAME + EXTENSION.length) {
    throw new Error(
      `The folder "${folder || vaultPath}" has too long a path to hold a card: a note's whole path can have ${PATH_CHARS} characters here, and this folder leaves ${Math.max(room, 0)} for the file name. Move the folder somewhere with a shorter path.`,
    );
  }
  const taken = pathTaken(app.vault, except);
  for (let n = 0; ; n++) {
    const path = normalizePath(`${folder}/${cardFileName(title, n, room)}`);
    if (!taken(path)) return path;
  }
}

/**
 * Write a new card's note into the board's card folder and answer with its path. `title` is
 * already normalized. Either the card is made whole or nothing is left behind.
 */
export async function createCardNote(
  { app, writer }: CardFiles,
  config: ResolvedBoardConfig,
  card: { title: string; status: string },
): Promise<string> {
  if (!card.title) throw new Error("A card needs a title.");
  // Creating the folder as written would only add one more spelling beside the ones already there.
  if (config.cardFolderCaseMatches.length > 1) throw new Error(ambiguousCaseMessage(config));
  if (!app.vault.getAbstractFileByPath(config.cardFolder))
    await app.vault.createFolder(config.cardFolder).catch(() => {});
  const path = cardPath(app, config.cardFolder, card.title);
  writer.markWrite(path);
  // Create the note first, then let Obsidian serialize the frontmatter — never hand-build
  // YAML (an odd column id / title could otherwise produce malformed frontmatter).
  const file = await app.vault.create(path, "").catch((e: unknown) => {
    throw unwritten(app, e);
  });
  try {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm["type"] = "task";
      fm["status"] = card.status;
      fm["created"] = dateOnly();
      if (!namedExactly(path, card.title)) fm[TITLE_KEY] = card.title;
    });
  } catch (e) {
    // A note without its fields is not the card that was asked for, and one without its `title`
    // has lost whatever the file name could not hold. It is taken back, so nothing half-made
    // stays behind and the caller's next try starts clean.
    const left = await app.fileManager.trashFile(file).then(
      () => "",
      () => ` An unfinished note was left at ${path}.`,
    );
    throw new Error(`The card could not be written: ${failure(app, e)}.${left}`, { cause: e });
  }
  return path;
}

/** Move the note to `dest`, link-aware. `keyed` says the new title is already in its `title` key. */
async function moveNote(
  { app, writer }: CardFiles,
  file: TFile,
  dest: string,
  keyed: boolean,
): Promise<void> {
  if (dest === file.path) return;
  const name = file.name;
  writer.markWrite(file.path);
  writer.markWrite(dest);
  try {
    // fileManager.renameFile rewrites inbound [[links]] (the parent's ## Subtasks link survives).
    await app.fileManager.renameFile(file, dest);
  } catch (e) {
    if (!keyed) throw unwritten(app, e);
    throw new PartlyWritten(
      `The title was saved, but the file could not be renamed to match: ${failure(app, e)}. It is still called ${name}. Try again to rename it.`,
      { cause: e },
    );
  }
}

/**
 * Take away the `title` key that held `was`, now that the file name holds the new title. Only
 * that very title is removed: one another writer put there since is theirs, and is kept.
 */
async function dropTitleKey({ app, writer }: CardFiles, path: string, was: string): Promise<void> {
  const holdsOld = (value: unknown) => typeof value === "string" && sameTitle(value.trim(), was);
  const name = baseName(path);
  let outcome: { changed: boolean; before: unknown };
  try {
    outcome = await writer.editKey(path, TITLE_KEY, (value) =>
      holdsOld(value) ? undefined : value,
    );
  } catch (e) {
    throw new PartlyWritten(
      `The file is now called ${name}, but the note's old \`title\` property could not be removed, so the card still shows it: ${failure(app, e)}. Try again.`,
      { cause: e },
    );
  }
  if (outcome.changed || outcome.before === undefined) return;
  const now = typeof outcome.before === "string" ? outcome.before : JSON.stringify(outcome.before);
  throw new PartlyWritten(
    `The file is now called ${name}, but the note's \`title\` property was changed to "${now}" while the title was being saved. It was kept, so the card shows it. Save the title again to replace it.`,
  );
}

/** Why a heading could not take a title, in the words the field shows. */
function headingRefusal(outcome: Exclude<HeadingRetitle, { text: string }>, title: string): string {
  if (outcome.refused === "unreadable") {
    const read =
      outcome.readsAs === null
        ? "the board would not read it as the title"
        : `the board would read it as "${outcome.readsAs}"`;
    return `This board reads a card's title from the first heading of its note, and a heading cannot hold "${title}": ${read}. Nothing was written.`;
  }
  return outcome.found === null
    ? "The note's heading was removed while the title was being saved, so nothing was written. Save the title again and the file will be named after it."
    : `The note's heading was changed to "${outcome.found}" while the title was being saved, so nothing was written. Save the title again to replace it.`;
}

/** Write `title` over the heading the title `was` is read from, or refuse and write nothing. */
async function retitleInHeading(
  writer: NoteWriter,
  path: string,
  was: string,
  title: string,
): Promise<void> {
  // The heading is judged inside the write, on the text the write is made on: a heading another
  // writer changed or removed since the title was read is refused there, not written over.
  const seen: { outcome: HeadingRetitle | null } = { outcome: null };
  await writer.editBody(path, (text) => {
    seen.outcome = retitleHeading(text, was, title);
    return "text" in seen.outcome ? seen.outcome.text : text;
  });
  if (seen.outcome === null || "text" in seen.outcome) return;
  // Nothing was written, so a change arriving now is somebody else's and must reload the board.
  writer.forgetWrite(path);
  throw new Error(headingRefusal(seen.outcome, title));
}

/**
 * The other cards whose `title` holds a `[[link]]` to `file`, each with the linkpaths that reach
 * it. Read before the file moves: afterwards those links name nothing. Obsidian's own link-aware
 * rename does not look inside a property's text, so these are the board's to keep.
 */
async function titleLinksTo(
  app: App,
  file: TFile,
  cards: readonly TFile[],
): Promise<Map<TFile, Set<string>>> {
  const found = new Map<TFile, Set<string>>();
  for (const card of cards) {
    if (card === file) continue;
    const text = await app.vault.cachedRead(card);
    if (!text.includes("[[")) continue;
    let title: unknown;
    try {
      title = parseFrontmatter(text)[TITLE_KEY];
    } catch {
      // A note whose frontmatter cannot be read has no title to hold a link.
      continue;
    }
    if (typeof title !== "string") continue;
    const linkpaths = new Set<string>();
    retargetTitleLinks(
      title,
      (linkpath) => {
        if (resolveLink(app, linkpath, card.path) === file.path) linkpaths.add(linkpath);
        return false;
      },
      "",
    );
    if (linkpaths.size > 0) found.set(card, linkpaths);
  }
  return found;
}

/** Point the title links collected by {@link titleLinksTo} at the file's new path. */
async function retargetTitleLinksTo(
  { app, writer }: CardFiles,
  dest: string,
  links: ReadonlyMap<TFile, ReadonlySet<string>>,
): Promise<void> {
  const stale: string[] = [];
  let why = "";
  for (const [card, linkpaths] of links) {
    try {
      await writer.editKey(card.path, TITLE_KEY, (value) =>
        typeof value === "string"
          ? retargetTitleLinks(
              value,
              (linkpath) => linkpaths.has(linkpath),
              linkTextTo(app, dest, card.path),
            )
          : value,
      );
    } catch (e) {
      stale.push(card.name);
      why = failure(app, e);
    }
  }
  if (stale.length === 0) return;
  throw new PartlyWritten(
    `The card was retitled, but the link to it in the title of ${stale.join(", ")} could not be updated: ${why}. Edit ${stale.length === 1 ? "that title" : "those titles"} by hand.`,
  );
}

/** What a retitle is told beyond the card and its new title. */
export interface RetitleOptions {
  titleMode: TitleMode;
  /** See `CardRepository.renameCard`: carry the retitle out even when the title reads as unchanged. */
  retry: boolean;
  /** The board's cards, whose titles may link to the one being renamed. */
  cards: () => readonly TFile[];
}

/** The vault path of the folder a note sits in; `""` for the vault's own folder. */
function folderOf(file: TFile): string {
  const folder = file.parent === null ? "" : file.parent.path;
  return folder === "/" ? "" : folder;
}

/**
 * Name the file after `title`, keeping in the `title` key what the file name cannot hold. `was`
 * is the title that key holds now, when the card's title is read from it.
 */
async function renameAfterTitle(
  files: CardFiles,
  file: TFile,
  title: string,
  { text, was, titleMode, cards }: { text: string; was: string | null } & RetitleOptions,
): Promise<string> {
  const { app, writer } = files;
  // On a `card-title: heading` board a note's first heading is read as its title once the `title`
  // key is gone, so there the key stays for as long as the note has a heading.
  const shadowed = resolveTitle(file.basename, {}, text, titleMode).source === "heading";
  const dest = cardPath(app, folderOf(file), title, file.path);
  // The file follows the title. The `title` key exists only while the file name cannot spell the
  // title: a link, a character a file name refuses, or a name another note already has.
  const keyed = shadowed || !namedExactly(dest, title);
  const links = await titleLinksTo(app, file, dest === file.path ? [] : cards());
  // Each order is the one a failure halfway leaves readable. A title the key holds is written
  // before the file moves, so the note never shows a title cut down to its file name; a key no
  // longer needed goes after the move, so the note keeps its old title until the new one is in.
  if (keyed) {
    await writer.writeFrontmatter(file.path, { [TITLE_KEY]: title }).catch((e: unknown) => {
      throw unwritten(app, e);
    });
  }
  await moveNote(files, file, dest, keyed);
  // The links are tried before the old key goes and reported after it: neither step's failure
  // may keep the other from being made.
  const linked = await retargetTitleLinksTo(files, dest, links).catch((e: unknown) => e);
  if (!keyed && was !== null) await dropTitleKey(files, dest, was);
  if (linked instanceof Error) throw linked;
  return dest;
}

/**
 * Give the card in `file` the title `title` (already normalized, not blank) and answer with its
 * path afterwards. Writes nothing when that is the title it has, unless this is a retry.
 */
export async function retitleCard(
  files: CardFiles,
  file: TFile,
  title: string,
  options: RetitleOptions,
): Promise<string> {
  const text = await files.app.vault.cachedRead(file);
  const { title: current, source } = resolveTitle(
    file.basename,
    parseFrontmatter(text),
    text,
    options.titleMode,
  );
  // A heading holds its title whole, so there a save that failed left nothing half done.
  const retried = options.retry && source !== "heading";
  if (sameTitle(title, current) && !retried) return file.path;
  if (source === "heading") {
    await retitleInHeading(files.writer, file.path, current, title);
    return file.path;
  }
  const was = source === "frontmatter" ? current : null;
  return renameAfterTitle(files, file, title, { ...options, text, was });
}
