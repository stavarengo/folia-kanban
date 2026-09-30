// How the byte-stable card writers keep a note's own line endings.

/**
 * Whether `s`'s lines are majority `\r\n`-terminated (`"\r"`) or majority bare-`\n` (`""`), or
 * `null` when `s` has no real line separator to judge at all (empty, or a single line with no
 * newline in it). Judged by majority, not "any `\r\n` anywhere": a file that is genuinely uniform
 * but happens to carry one stray CRLF (or one stray bare LF) line must not flip the verdict for
 * the whole file. An exact tie (equally many of each) resolves to CRLF, arbitrarily but
 * deterministically — a real 50/50 split is rare enough that which way it falls matters less than
 * that it always falls the same way.
 */
function lineEndingOf(s: string): "\r" | "" | null {
  const lines = s.split("\n");
  const total = lines.length - 1; // the last element never carries separator info of its own
  if (total === 0) return null;
  let crCount = 0;
  for (let i = 0; i < total; i++) if ((lines[i] ?? "").endsWith("\r")) crCount++;
  return crCount * 2 >= total ? "\r" : "";
}

/**
 * `lines.join("\n")`, but corrected for a case plain `join` cannot represent: if the array's LAST
 * element ends in a bare `\r` with nothing after it, that `\r` was never that line's own — it is
 * the leftover half of a `\r\n` pair whose `\n` belonged to content that has since been deleted
 * (deleting a note's true final line always does this to whatever becomes the new final line, if
 * that line used to sit mid-file and end in `\r\n`). Left alone it would write a lone `\r` as the
 * file's last byte, a line ending no real line of this file ever had on its own. Dropped here
 * rather than fixed up per call site, so every deleting mutation gets this for free.
 */
export function joinLines(lines: readonly string[]): string {
  const out = lines.join("\n");
  return out.endsWith("\r") ? out.slice(0, -1) : out;
}

/**
 * The line ending a brand-new line appended to `body` should carry. The body's own MAJORITY
 * convention wins whenever the body has any real separator to judge — even when the card's
 * frontmatter disagrees, since the body is what is actually being edited. Only falls back to
 * `fullText` (frontmatter included) when the body itself carries no separator evidence at all: an
 * empty body (frontmatter-only card) or a single line with no newline in it.
 */
export function bodyCr(body: string, fullText: string): string {
  return lineEndingOf(body) ?? lineEndingOf(fullText) ?? "";
}
