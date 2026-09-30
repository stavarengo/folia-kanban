import type { App } from "obsidian";
import { Keymap } from "obsidian";
import { vaultLinktext } from "../model/links";

/**
 * Which note a link written in `sourcePath` names, answered by the vault itself — the same
 * answer the editor gives when that link is clicked, shortest-path and same-folder rules
 * included. `link` is a bare linkpath (no `#anchor`, no `|alias`); a `.md` suffix is fine.
 * Null for a link naming no note.
 */
export function resolveLink(app: App, link: string, sourcePath: string): string | null {
  return app.metadataCache.getFirstLinkpathDest(link, sourcePath)?.path ?? null;
}

/**
 * How a link to the note at `targetPath` should be written inside a note at `sourcePath`, per
 * this vault's own link settings — the shortest name that still names one note, a relative or
 * absolute path where the vault is set up that way.
 *
 * Only the text INSIDE the brackets: every link Folia writes is a wikilink, whatever the vault's
 * "use [[Wikilinks]]" setting says, because Folia's own reading of a note (the `## Subtasks`
 * checklist, the relationship keys) only recognizes that form. A vault set to Markdown links
 * therefore gets a wikilink here — the honest shape until reading Markdown links is built too.
 */
export function linkTextTo(app: App, targetPath: string, sourcePath: string): string {
  const file = app.vault.getFileByPath(targetPath);
  const bare = targetPath.replace(/\.md$/i, "");
  return file === null ? bare : app.metadataCache.fileToLinktext(file, sourcePath, true);
}

/**
 * The note a relationship `target` names, read from the card that declares it — or null when it
 * names no note, or carries an `#anchor` / `|alias`. A decorated target said more than "which
 * note", so it is left alone rather than rewritten into a plainer link that loses the rest.
 */
export function relationTargetPath(app: App, target: string, sourcePath: string): string | null {
  const raw = target.trim();
  if (raw === "" || raw.includes("#") || raw.includes("|")) return null;
  return resolveLink(app, raw, sourcePath);
}

/** The repository's `followLink`: open the vault link a click in rendered Markdown landed on. */
export function followLink(
  app: App,
  evt: MouseEvent,
  sourcePath: string,
  beforeOpen?: () => void,
): boolean {
  // `instanceOf`, because a board in a pop-out window renders into that window's DOM, whose
  // elements are not instances of this window's `Element`.
  const target = evt.targetNode;
  if (!target?.instanceOf(Element)) return false;
  const linktext = vaultLinktext(target.closest("a")?.getAttribute("href") ?? null);
  if (linktext === null) return false;
  // A link inside an embedded note is followed by the embed, which claims the click before it
  // gets here. Opening it again would open it twice.
  if (evt.defaultPrevented) {
    beforeOpen?.();
    return true;
  }
  evt.preventDefault();
  // Read before `beforeOpen`, which may take the link out of the document.
  const newLeaf = Keymap.isModEvent(evt);
  beforeOpen?.();
  void app.workspace.openLinkText(linktext, sourcePath, newLeaf);
  return true;
}
