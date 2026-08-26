import { stringify } from "yaml";

/**
 * The card folder a guided board starts on. Note-relative on purpose: a bare `Cards` is read from
 * the vault root for a folder that does not exist yet, which is almost never what someone creating
 * a board inside a project folder means. `./Cards` travels with the note when the folder is moved.
 */
const DEFAULT_CARD_FOLDER = "./Cards";

/** The columns a guided board starts with — the same three the README and `examples/basic/` use. */
const DEFAULT_COLUMNS = ["todo", "doing", "done"];

/** File name a new board note gets before de-duplication. */
export const NEW_BOARD_BASENAME = "Board";

/** A `columns` value only counts as one the board can use; anything else is treated as missing. */
function hasUsableColumns(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Add the properties that make a note a board, leaving every value the note already carries — so
 * converting an existing note keeps its own `card-folder`, its own `columns`, and everything else
 * in its frontmatter. Written to be run through `FileManager.processFrontMatter`, which is what
 * guarantees the block lands at the very top of the note even when the note has none: hand-written
 * frontmatter that is *not* on the first lines is the one mistake this whole feature exists to make
 * impossible.
 *
 * Returns whether the note ends up on the note-relative default card folder, which is the only case
 * where the caller knows exactly which folder to create for it.
 */
export function applyBoardFrontmatter(frontmatter: Record<string, unknown>): boolean {
  frontmatter["folia-board"] = true;
  // `card_folder` is the underscore spelling the board loader also accepts; a note using it already
  // names its folder, so adding the dashed key would give the note two answers to one question.
  const named = frontmatter["card-folder"] ?? frontmatter["card_folder"];
  const ownFolder = typeof named === "string" && named.trim() !== "";
  if (!ownFolder) frontmatter["card-folder"] = DEFAULT_CARD_FOLDER;
  if (!hasUsableColumns(frontmatter["columns"])) frontmatter["columns"] = [...DEFAULT_COLUMNS];
  return !ownFolder || named === DEFAULT_CARD_FOLDER;
}

/**
 * The full text of a brand-new board note. Built from the same defaults `applyBoardFrontmatter`
 * writes, so the two cannot drift, and with the frontmatter block at offset 0 by construction.
 */
export function boardNoteContent(title: string): string {
  const frontmatter: Record<string, unknown> = {};
  applyBoardFrontmatter(frontmatter);
  return `---\n${stringify(frontmatter)}---\n\n# ${title}\n`;
}

/** The card folder a board note in `parentPath` gets, for the default `./Cards` reading of it. */
export function cardFolderPathFor(parentPath: string): string {
  const folder = DEFAULT_CARD_FOLDER.replace(/^\.\//, "");
  return parentPath === "" || parentPath === "/" ? folder : `${parentPath}/${folder}`;
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
