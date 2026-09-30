import type { App } from "obsidian";
import type { PropertyNamesInUse } from "../model/repo";
import { isBoardFrontmatter } from "./viewMode";
import { CONTEXT_NOTE } from "./cardNotes";

/**
 * Every frontmatter key the vault's notes already carry, from the metadata index — Obsidian has
 * parsed every note once already, so parsing them again here would be both slower and a second
 * reading of the same bytes. Split at the board's card folder, as the board config resolved it.
 *
 * Only notes that could be cards are read. EVERY board note is skipped, not only this board's,
 * and so is every `_context.md`: their keys (`folia-board`, `columns`, `context-name`, …)
 * configure a board or a folder and mean nothing on a card, so offering them on a card is
 * offering a mistake — and a vault holding several boards would otherwise hand each one's
 * configuration to the others as vault-wide vocabulary. It is the same "this is not a card"
 * rule `loadBoard` applies when it picks the notes to draw.
 */
export function collectPropertyNames(
  app: App,
  boardPath: string,
  cardFolder: string,
): PropertyNamesInUse {
  const prefix = cardFolder + "/";
  const inCardFolder = new Set<string>();
  const elsewhere = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    if (file.path === boardPath || file.name === CONTEXT_NOTE) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || isBoardFrontmatter(fm)) continue;
    const into = file.path.startsWith(prefix) ? inCardFolder : elsewhere;
    for (const key of Object.keys(fm)) into.add(key);
  }
  const sorted = (keys: Set<string>): string[] => [...keys].sort((a, b) => a.localeCompare(b));
  // A key used both inside and outside the folder belongs to the board: it is the nearer answer,
  // and a name must never be offered twice. Matched without regard to case, since `Energy` and
  // `energy` are the same answer to "what do notes here call this".
  const near = new Set([...inCardFolder].map((k) => k.toLowerCase()));
  return {
    inCardFolder: sorted(inCardFolder),
    elsewhere: sorted(elsewhere).filter((k) => !near.has(k.toLowerCase())),
  };
}
