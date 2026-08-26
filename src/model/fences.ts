// Fenced code blocks, CommonMark shape (what Obsidian renders): the marker is three or more
// backticks or tildes, indented by up to three spaces. Every heading and bullet lookup in the card
// model goes through here so that quoting the plugin's own format inside a note stays inert.

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Fence state after `line`, given the currently open fence marker (null = not in a fence). Returns
 * `false` when the line is not a fence delimiter at all.
 */
function fenceAfter(line: string, open: string | null): string | null | false {
  const m = FENCE_RE.exec(line);
  if (m === null) return false;
  const marker = m[1] ?? "";
  if (open === null) return marker;
  // A fence closes only on its own marker, at least as long, with nothing but space after it —
  // so neither `~~~` nor ```` ```still code ```` ends a ``` block.
  const closes =
    marker[0] === open[0] && marker.length >= open.length && (m[2] ?? "").trim() === "";
  return closes ? null : open;
}

/**
 * For each line, whether it belongs to a fenced block — the delimiters included. A fence that is
 * never closed runs to the end, as it does when rendered.
 */
export function fencedLines(lines: readonly string[]): boolean[] {
  let open: string | null = null;
  return lines.map((line) => {
    const next = fenceAfter(line, open);
    if (next === false) return open !== null;
    open = next;
    return true;
  });
}

/** The marker of a fence still open at the end of the text, or null when every fence is closed. */
export function unclosedFence(lines: readonly string[]): string | null {
  let open: string | null = null;
  for (const line of lines) {
    const next = fenceAfter(line, open);
    if (next !== false) open = next;
  }
  return open;
}
