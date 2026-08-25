import type { FrontMatterCache } from "obsidian";

/** Frontmatter key that marks a note as a Folia Kanban board. */
const BOARD_FLAG = "folia-board";

/** Per-note override for the "open board notes as" setting. */
const VIEW_OVERRIDE_KEY = "folia-view";

/** The two ways a board note can be shown. */
export type BoardViewMode = "board" | "markdown";

/** A board is any note carrying `folia-board: true`. Nothing else is ever a board. */
export function isBoardFrontmatter(frontmatter: FrontMatterCache | undefined): boolean {
  return frontmatter?.[BOARD_FLAG] === true;
}

/**
 * Which view a note should open in.
 *
 * Returns `null` for every note that is not a board — callers must leave those completely
 * alone, so a vault full of ordinary notes never notices this plugin. For a board, the note's
 * own `folia-view` property wins when it names a mode we understand; anything else (missing,
 * misspelt, wrong type) falls back to `fallback`, the vault-wide setting, rather than failing.
 */
export function resolveBoardViewMode(
  frontmatter: FrontMatterCache | undefined,
  fallback: BoardViewMode,
): BoardViewMode | null {
  if (!isBoardFrontmatter(frontmatter)) return null;
  if (frontmatter?.[VIEW_OVERRIDE_KEY] === "board") return "board";
  if (frontmatter?.[VIEW_OVERRIDE_KEY] === "markdown") return "markdown";
  return fallback;
}
