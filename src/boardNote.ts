/** Name the card folder of a guided board starts from. */
const CARD_FOLDER_BASE = "Cards";

/** The columns a guided board starts with — the same three the README and `examples/basic/` use. */
const DEFAULT_COLUMNS = ["todo", "doing", "done"];

/** File name a new board note gets before de-duplication. */
export const NEW_BOARD_BASENAME = "Board";

/** A `columns` value the board could work from. An empty list says nothing, so it counts as absent
 *  and gets filled in; anything else the note carries is the user's and is left alone, even when the
 *  board will end up complaining about it. */
function needsColumns(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * Add the properties that make a note a board, leaving every value the note already carries — so
 * converting an existing note keeps its own `card-folder`, its own `columns`, and everything else in
 * its frontmatter. Written to be run through `FileManager.processFrontMatter`, which is what
 * guarantees the block lands at the very top of the note even when the note has none: frontmatter
 * that is *not* on the first lines is the one mistake this whole feature exists to make impossible.
 *
 * Returns whether `cardFolder` was actually written, which is the caller's cue to create it. A note
 * that already names its own folder is pointing somewhere the caller knows nothing about.
 */
export function applyBoardFrontmatter(
  frontmatter: Record<string, unknown>,
  cardFolder: string,
): boolean {
  frontmatter["folia-board"] = true;
  // `card_folder` is the underscore spelling the board loader also accepts; a note using it already
  // names its folder, so adding the dashed key would give the note two answers to one question.
  const named = frontmatter["card-folder"] ?? frontmatter["card_folder"];
  const ownFolder = typeof named === "string" && named.trim() !== "";
  if (!ownFolder) frontmatter["card-folder"] = cardFolder;
  if (needsColumns(frontmatter["columns"])) frontmatter["columns"] = [...DEFAULT_COLUMNS];
  return !ownFolder;
}

/** The heading a brand-new board note opens with. The properties are not written here: Obsidian's
 *  own frontmatter API adds those, so no YAML is ever hand-built. */
export function boardNoteBody(title: string): string {
  return `# ${title}\n`;
}

/** A folder path and the `card-folder` property that names it. */
export interface CardFolder {
  /** What goes in the note: note-relative, so the property survives the folder being moved. */
  property: string;
  /** Where it is in the vault, for the caller to create. */
  path: string;
}

/**
 * The card folder a guided board gets: `Cards` beside the note, or `Cards 1`, `Cards 2`… when that
 * name is taken. Two boards made in the same folder would otherwise both be handed `./Cards` and
 * each would show the other's cards, with nothing on either board saying why.
 */
export function cardFolderFor(parentPath: string, exists: (path: string) => boolean): CardFolder {
  const dir = parentPath === "" || parentPath === "/" ? "" : `${parentPath}/`;
  for (let n = 0; ; n++) {
    const name = n === 0 ? CARD_FOLDER_BASE : `${CARD_FOLDER_BASE} ${n}`;
    if (!exists(`${dir}${name}`)) return { property: `./${name}`, path: `${dir}${name}` };
  }
}

/**
 * A note path in `folderPath` that nothing occupies yet: `Board.md`, then `Board 1.md`, and so on —
 * the same shape the card repository uses when a card name is taken.
 */
export function uniqueNotePath(
  folderPath: string,
  base: string,
  exists: (path: string) => boolean,
): string {
  const dir = folderPath === "" || folderPath === "/" ? "" : `${folderPath}/`;
  let candidate = `${dir}${base}.md`;
  for (let n = 1; exists(candidate); n++) candidate = `${dir}${base} ${n}.md`;
  return candidate;
}
