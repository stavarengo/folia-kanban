import type { App, TFile } from "obsidian";
import { TFolder, normalizePath, parseFrontMatterEntry } from "obsidian";
import type { BoardConfig } from "../model/types";
import { resolveCardFolder } from "../model/board";
import { normalizeColumns } from "../model/columns";
import { normalizePriorities } from "../model/priorities";
import { normalizeRelationTypes } from "../model/relationships";
import { asTitleMode } from "../model/cardTitle";
import { BoardFrontmatterSchema, decode } from "../model/schemas";
import { parseFrontmatter } from "./frontmatter";

/**
 * `BoardConfig` plus what resolving `card-folder` learned on the way, so `loadBoard` can report a
 * missing or ambiguous folder without repeating the vault lookups. Repo-internal: `BoardConfig`
 * stays the adapter-agnostic shape every consumer shares.
 */
export interface ResolvedBoardConfig extends BoardConfig {
  /** The property text as written, for messages that must name what the person actually typed. */
  cardFolderRaw: string;
  /** Every candidate path that exists as a folder right now, in the order they were preferred. */
  cardFolderExisting: string[];
  /** The real paths of the folders a candidate names in another letter case, when none is exact. */
  cardFolderCaseMatches: string[];
}

/** The board note's frontmatter, checked against the board schema. */
export async function readBoardFrontmatter(
  app: App,
  boardFile: TFile,
  boardPath: string,
): Promise<Record<string, unknown>> {
  return decode(
    BoardFrontmatterSchema,
    parseFrontmatter(await app.vault.cachedRead(boardFile)),
    `board config (${boardPath})`,
  );
}

export async function readBoardConfig(
  app: App,
  boardFile: TFile,
  boardPath: string,
): Promise<ResolvedBoardConfig> {
  // Parse the board config from the (write-fresh) file text rather than metadataCache:
  // the cache lags a processFrontMatter write by a tick, so reading it right after an
  // in-app column edit would return stale columns and the edit wouldn't reflect.
  const fm = await readBoardFrontmatter(app, boardFile, boardPath);
  // Resolved once, here, so every consumer of `config.cardFolder` — card selection, context
  // derivation (`deriveContext`, called deep inside `buildBoard`), `loadContexts`, and
  // `ensureFolder`/`createCard` — agrees on the exact same vault path. A leading slash, doubled
  // slashes, a `..` segment or a board-note-relative reading must not make one of those
  // consumers see the folder (or a card's context) and another not.
  const named: unknown =
    parseFrontMatterEntry(fm, /^card-folder$/) ?? parseFrontMatterEntry(fm, /^card_folder$/);
  const cardFolderRaw = typeof named === "string" ? named : "Tasks";
  const {
    path: cardFolder,
    existing: cardFolderExisting,
    caseMatches: cardFolderCaseMatches,
  } = cardFolderFor(app, boardPath, cardFolderRaw);
  const titleMode = asTitleMode(fm["card-title"] ?? fm["card_title"]);
  return {
    path: boardPath,
    columns: normalizeColumns(fm["columns"]),
    priorities: normalizePriorities(fm["priorities"]),
    relations: normalizeRelationTypes(fm["relations"]),
    cardFolder,
    cardFolderRaw,
    titleMode,
    cardFolderExisting,
    cardFolderCaseMatches,
  };
}

/** Pick the vault path a `card-folder` property names, against the vault as it is right now. */
function cardFolderFor(
  app: App,
  boardPath: string,
  raw: string,
): { path: string; existing: string[]; caseMatches: string[] } {
  // `normalizePath` only tidies separators (it leaves `.` and `..` alone and turns an empty
  // value into "/"), so the `.`/`..` resolution and the two readings live in the pure helper.
  const resolved = resolveCardFolder(
    boardPath,
    normalizePath(raw),
    (p) => entryAt(app, p),
    // Obsidian's own case-insensitive lookup is undocumented and returns the first hit, which
    // cannot tell one match from several; see `pathTaken` for the same rule applied to new names.
    () =>
      app.vault
        .getAllLoadedFiles()
        .filter((f) => f instanceof TFolder)
        .map((f) => f.path),
  );
  if (resolved === null) {
    // Nothing left after dropping the readings that climb out of the vault or land on its root.
    // Unlike a folder that simply isn't there yet, adding a card cannot fix this, so it fails
    // hard rather than rendering a board whose "Add card" would write somewhere nonsensical.
    throw new Error(
      `Card folder "${raw}" names the vault root or a path outside it, neither of which can hold cards. Fix the board's card-folder property.`,
    );
  }
  return resolved;
}

function entryAt(app: App, path: string): "folder" | "file" | null {
  const entry = app.vault.getAbstractFileByPath(path);
  return entry === null ? null : entry instanceof TFolder ? "folder" : "file";
}

/**
 * The card folder as the vault holds it right now, and what the board should say about it.
 *
 * A card folder that isn't there matches zero files, which looks exactly like an empty board. Say
 * so via the warning rather than rendering a healthy-looking board with nothing on it — but keep
 * loading: a board whose folder was never created yet (the `Tasks` default, or a fresh
 * `card-folder`) must still be usable, since adding the first card creates that folder (see
 * `ensureFolder`).
 *
 * A path that resolves to something OTHER than a folder (a file already sits there) has no such
 * self-heal story — `ensureFolder`/`createCard` can't create a folder where a file already is, and
 * would fail with no useful feedback surfaced anywhere in the UI. That case stays a hard failure
 * instead of a soft notice, so the board (and its "Add card" controls) are simply not reachable
 * rather than reachable-but-broken.
 */
export function inspectCardFolder(
  app: App,
  config: ResolvedBoardConfig,
  boardPath: string,
): { folder: TFolder | null; warning: string | undefined } {
  const folder = app.vault.getFolderByPath(config.cardFolder);
  if (folder === null && app.vault.getFileByPath(config.cardFolder) !== null) {
    throw new Error(
      `Card folder ${describeCardFolder(config)} is not a folder. Fix the board's card-folder property.`,
    );
  }
  return { folder, warning: cardFolderWarning(config, folder !== null, boardPath) };
}

/**
 * Both readings existing is the one way the fallback can flip silently: a board using the
 * board-note-relative reading keeps working until someone creates a same-named folder at the vault
 * root, and then loads empty with the folder it wanted still sitting right there. Name the winner
 * rather than let that look like an ordinary empty board.
 *
 * A folder found only by ignoring letter case is used, under its real path, and named too: on
 * Linux a folder spelled exactly as written can still appear beside it and take over.
 */
function cardFolderWarning(
  config: ResolvedBoardConfig,
  found: boolean,
  boardPath: string,
): string | undefined {
  const caseMatches = config.cardFolderCaseMatches;
  if (caseMatches.length > 1) return ambiguousCaseMessage(config);
  if (!found)
    return `Card folder ${describeCardFolder(config)} was not found. It will be created when you add your first card.`;
  if (config.cardFolderExisting.length > 1)
    return `Card folder "${config.cardFolderRaw}" matches both "${config.cardFolderExisting[0]}" and "${config.cardFolderExisting[1]}". Using "${config.cardFolder}" — write the path as "./…" to always mean the one beside this board note.`;
  if (caseMatches.length === 1)
    return `Card folder "${config.cardFolderRaw}" matches "${config.cardFolder}" only when letter case is ignored. Using it — write the path as "${exactSpelling(config, boardPath)}" to match it exactly.`;
  return undefined;
}

/**
 * How to name the card folder in a message: what was written, plus what it resolved to whenever
 * the two differ — a `./Cards` that came out as `basic/Cards` is only actionable with both.
 */
function describeCardFolder(config: ResolvedBoardConfig): string {
  return config.cardFolderRaw === config.cardFolder
    ? `"${config.cardFolderRaw}"`
    : `"${config.cardFolderRaw}" (resolved to "${config.cardFolder}")`;
}

/** The folders an ambiguous-by-case `card-folder` could mean, for the notice and for refusals. */
export function ambiguousCaseMessage(config: ResolvedBoardConfig): string {
  const names = config.cardFolderCaseMatches.map((p) => `"${p}"`).join(", ");
  return `Card folder "${config.cardFolderRaw}" matches ${names} only when letter case is ignored, so it is not clear which one holds the cards. Rename all but one of them, or write the one you mean exactly.`;
}

/**
 * How to write `card-folder` so it names the folder it matched only by case, exactly. A `./` or
 * `../` value stays relative to the board note, and with it keeps the portability it was written
 * for; anything else gets the real path, which the vault-root reading always takes first.
 */
function exactSpelling(config: ResolvedBoardConfig, boardPath: string): string {
  if (!/^\.\.?(\/|$)/.test(config.cardFolderRaw)) return config.cardFolder;
  const home = boardPath.split("/").slice(0, -1);
  const target = config.cardFolder.split("/");
  let shared = 0;
  while (shared < home.length && home[shared] === target[shared]) shared++;
  const up = home.slice(shared).map(() => "..");
  return [...(up.length === 0 ? ["."] : up), ...target.slice(shared)].join("/");
}
