// Naming a card's file after its title: where a new card goes, and what a retitle writes. Every
// step is ordered so that a failure halfway never costs the title that was typed.

import type { App, TFile } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import {
  FILE_NAME_CHARS,
  TITLE_KEY,
  fitFileName,
  resolveTitle,
  sameTitle,
  setHeadingTitle,
  titleFileName,
} from "../model/cardTitle";
import { dateOnly } from "../model/dates";
import { baseName } from "../model/pathOps";
import type { TitleMode } from "../model/types";
import { ambiguousCaseMessage, type ResolvedBoardConfig } from "./boardConfig";
import { uniqueNotePath } from "./boardNote";
import { parseFrontmatter } from "./frontmatter";
import type { NoteWriter } from "./noteWriter";
import { pathTaken } from "./pathTaken";

// Windows refuses a whole path over 260 characters; 240 leaves room for `.md` and the number that
// tells two notes of one name apart.
const PATH_CHARS = 240;
/** The least room a folder must leave for a card's file name. */
const SHORTEST_NAME = 20;

/** What these writes go through: the vault, and the writer that marks them as the board's own. */
export interface CardFiles {
  app: App;
  writer: NoteWriter;
}

/** Why a write failed, as a clause another sentence can carry. */
export const failure = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\.$/, "");

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
  if (room < SHORTEST_NAME) {
    throw new Error(
      `The folder "${folder || vaultPath}" has too long a path to hold a card: a note's whole path can have ${PATH_CHARS} characters here, and this folder leaves ${Math.max(room, 0)} for the file name. Move the folder somewhere with a shorter path.`,
    );
  }
  const name = fitFileName(titleFileName(title), Math.min(FILE_NAME_CHARS, room));
  return uniqueNotePath(folder, name, pathTaken(app.vault, except));
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
  const file = await app.vault.create(path, "");
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
    throw new Error(`The card could not be written: ${failure(e)}.${left}`, { cause: e });
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
    if (!keyed) throw e;
    throw new Error(
      `The title was saved, but the file could not be renamed to match: ${failure(e)}. It is still called ${name}.`,
      { cause: e },
    );
  }
}

/** Take away a `title` key the file name has made redundant. */
async function dropTitleKey(writer: NoteWriter, path: string): Promise<void> {
  try {
    await writer.unsetKey(path, TITLE_KEY);
  } catch (e) {
    throw new Error(
      `The file is now called ${baseName(path)}, but the note's old \`title\` property could not be removed, so the card still shows it: ${failure(e)}. Try again.`,
      { cause: e },
    );
  }
}

/**
 * Give the card in `file` the title `title` (already normalized, not blank) and answer with its
 * path afterwards. Writes nothing when that is the title it has.
 */
export async function retitleCard(
  files: CardFiles,
  file: TFile,
  title: string,
  titleMode: TitleMode,
): Promise<string> {
  const { app, writer } = files;
  const text = await app.vault.cachedRead(file);
  const { title: current, source } = resolveTitle(
    file.basename,
    parseFrontmatter(text),
    text,
    titleMode,
  );
  if (sameTitle(title, current)) return file.path;
  if (source === "heading") {
    await writer.editBody(file.path, (t) => setHeadingTitle(t, title));
    return file.path;
  }
  // On a `card-title: heading` board a note's first heading is read as its title once the `title`
  // key is gone, so there the key stays for as long as the note has a heading.
  const shadowed = resolveTitle(file.basename, {}, text, titleMode).source === "heading";
  const folder = file.parent?.path ?? "";
  const dest = cardPath(app, folder === "/" ? "" : folder, title, file.path);
  // The file follows the title. The `title` key exists only while the file name cannot spell the
  // title: a link, a character a file name refuses, or a name another note already has.
  const keyed = shadowed || !namedExactly(dest, title);
  // Each order is the one a failure halfway leaves readable. A title the key holds is written
  // before the file moves, so the note never shows a title cut down to its file name; a key no
  // longer needed goes after the move, so the note keeps its old title until the new one is in.
  if (keyed) await writer.writeFrontmatter(file.path, { [TITLE_KEY]: title });
  await moveNote(files, file, dest, keyed);
  if (!keyed && source === "frontmatter") await dropTitleKey(writer, dest);
  return dest;
}
