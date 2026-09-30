/**
 * The note a rendered link points at, read from the anchor's `href` attribute, or `null` when the
 * link is not one to follow into the vault: a URL scheme (`https:`, `mailto:`, `obsidian:`, …) is
 * the browser's and Obsidian's to handle, and a leading `#` (a tag, a footnote, a same-note
 * heading) points inside the note itself.
 *
 * The attribute is the linktext as Obsidian recorded it, not a URL, so it is returned as it is.
 * Decoding it would turn a note named `A%20B` into `A B`, a note that does not exist.
 */
export function vaultLinktext(href: string | null): string | null {
  if (!href || href.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  return href;
}

/**
 * The note a link's text names, with its `|alias` and its `#heading` or `#^block` dropped. The
 * `#` split is Obsidian's `parseLinktext`, which the model cannot import; the alias is split off
 * first because that helper leaves it in. Why this is not a port: docs/decisions.md, "Link text is
 * split in the model".
 */
export function linkpath(linktext: string): string {
  const target = linktext.split("|")[0] ?? "";
  const hash = target.indexOf("#");
  return (hash === -1 ? target : target.slice(0, hash)).trim();
}
