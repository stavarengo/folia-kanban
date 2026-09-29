import type { CachedMetadata } from "obsidian";
import type { BoardViewMode } from "../settings";
import { resolveBoardViewMode } from "./viewMode";

/** What a Markdown tab that has just come to show a note should do about it. `retry` means the
 *  metadata cache has not read the note yet, so the question has to be asked again once it has. */
export type MarkdownTabOutcome = "board" | "stay" | "retry";

export interface MarkdownTabFacts {
  /** The note's cached metadata, or `null` while the cache has not read it. */
  cache: CachedMetadata | null;
  /** The `boardNoteDefaultView` setting. */
  fallback: BoardViewMode;
  /** The user sent this tab to the editor for this very note. */
  keptAsMarkdown: boolean;
  /** This tab was already decided about for this note, so coming back to it is not an open. */
  alreadyDecided: boolean;
  /** A tab in the main area or a popout, rather than a sidebar with no room for a board. */
  editingSurface: boolean;
}

export function markdownTabOutcome(facts: MarkdownTabFacts): MarkdownTabOutcome {
  if (facts.alreadyDecided || facts.keptAsMarkdown || !facts.editingSurface) return "stay";
  if (facts.cache === null) return "retry";
  return resolveBoardViewMode(facts.cache.frontmatter, facts.fallback) === "board"
    ? "board"
    : "stay";
}
