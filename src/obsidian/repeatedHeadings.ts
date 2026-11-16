// The one-off cleanup for notes made before a card had one title. Those cards were given a top
// `# heading` repeating the title; the heading is ordinary description now, so on such a card the
// title shows twice. This removes the heading where it says nothing the title does not.

import { FileView, type App, type Plugin, type TFile } from "obsidian";
import { resolveTitle, withoutRepeatedHeading } from "../model/cardTitle";
import type { ConfirmRequest } from "../model/repo";
import type { TitleMode } from "../model/types";
import { inspectCardFolder, readBoardConfig } from "./boardConfig";
import type { BoardTabs } from "./boardTabs";
import { cardFilesIn } from "./cardNotes";
import { boardNotice, confirmAction } from "./dialogs";
import { parseFrontmatter } from "./frontmatter";

export const REMOVE_REPEATED_HEADINGS_COMMAND_NAME = "Remove headings that repeat the card title";

/** How the cleanup asks and tells: the app's own dialog and notice, or a test's stand-ins. */
export interface CleanupHost {
  confirm(request: ConfirmRequest): Promise<boolean>;
  notify(message: string, tone: "success" | "error"): void;
}

/**
 * The note without the heading that repeats its title, or `null` when it has none to remove. The
 * title is read from the text given, the way the board reads it, so the scan and the write judge
 * the same note the same way however long the question between them stayed open. A card that
 * reads its title from its heading (`card-title: heading`) keeps it: there the heading is the
 * title.
 */
function cleaned(text: string, basename: string, titleMode: TitleMode): string | null {
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(text);
  } catch {
    // A note whose frontmatter cannot be read has no title to compare its heading with.
    return null;
  }
  const { title, source } = resolveTitle(basename, frontmatter, text, titleMode);
  return source === "heading" ? null : withoutRepeatedHeading(text, title);
}

const notes = (n: number) => (n === 1 ? "1 note" : `${n} notes`);

/** The board's card notes that open with a heading only repeating the card's title. */
async function notesWithRepeatedHeading(
  app: App,
  boardPath: string,
): Promise<{ found: TFile[]; titleMode: TitleMode }> {
  const boardFile = app.vault.getFileByPath(boardPath);
  if (boardFile === null) throw new Error(`Not a file: ${boardPath}`);
  const config = await readBoardConfig(app, boardFile, boardPath);
  const { folder } = inspectCardFolder(app, config, boardPath);
  const found: TFile[] = [];
  for (const file of folder === null ? [] : cardFilesIn(folder, boardPath)) {
    if (cleaned(await app.vault.read(file), file.basename, config.titleMode) !== null)
      found.push(file);
  }
  return { found, titleMode: config.titleMode };
}

/** Remove the heading from each of `files`, answering with how many changed and which failed. */
async function removeFrom(
  app: App,
  files: readonly TFile[],
  titleMode: TitleMode,
): Promise<{ changed: number; failed: string[] }> {
  let changed = 0;
  const failed: string[] = [];
  for (const file of files) {
    try {
      let removed = false;
      await app.vault.process(file, (text) => {
        const next = cleaned(text, file.basename, titleMode);
        removed = next !== null;
        return next ?? text;
      });
      if (removed) changed++;
    } catch {
      failed.push(file.path);
    }
  }
  return { changed, failed };
}

/**
 * Find the cards of the board at `boardPath` whose note opens with a heading that only repeats
 * the card's title, say how many notes that is, and on a yes remove those headings.
 */
export async function removeRepeatedHeadings(
  app: App,
  boardPath: string,
  host: CleanupHost,
): Promise<void> {
  const { found, titleMode } = await notesWithRepeatedHeading(app, boardPath);
  if (found.length === 0) {
    host.notify("No card on this board opens with a heading that repeats its title.", "success");
    return;
  }
  const confirmed = await host.confirm({
    title: REMOVE_REPEATED_HEADINGS_COMMAND_NAME,
    message: `${notes(found.length)} will change. Each opens with a heading that only repeats the card's title, and that heading is removed. Nothing else in the note is touched, and a heading that says more than the title is kept.`,
    cta: "Remove headings",
  });
  if (!confirmed) return;
  const { changed, failed } = await removeFrom(app, found, titleMode);
  if (failed.length === 0) {
    host.notify(`Removed the heading from ${notes(changed)}.`, "success");
    return;
  }
  host.notify(
    `Removed the heading from ${notes(changed)}. ${notes(failed.length)} could not be written: ${failed.join(", ")}.`,
    "error",
  );
}

/**
 * The note the tab in front shows. Asked of the view rather than through `getActiveFile`, which
 * answers only for a view Obsidian may navigate away from: the board's own view is not one, so
 * with a board open it reports no file at all.
 */
function noteInFront(app: App): TFile | null {
  return app.workspace.getActiveViewOfType(FileView)?.file ?? app.workspace.getActiveFile();
}

/** Offer the cleanup as a command, on whichever board is in front: open as a board, or as Markdown. */
export function registerRepeatedHeadingsCommand(plugin: Plugin, app: App, tabs: BoardTabs): void {
  plugin.addCommand({
    id: "remove-repeated-title-headings",
    name: REMOVE_REPEATED_HEADINGS_COMMAND_NAME,
    checkCallback: (checking) => {
      const file = noteInFront(app);
      if (file === null || !tabs.isBoard(file)) return false;
      if (!checking) {
        void removeRepeatedHeadings(app, file.path, {
          confirm: (request) => confirmAction(app, request),
          notify: boardNotice,
        }).catch((e: unknown) =>
          boardNotice(
            `Could not remove the headings: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          ),
        );
      }
      return true;
    },
  });
}
