// Unread comments (pure): who wrote a comment, and which ones the reader has not seen yet.
//
// Authorship lives in the note (`- _2026-08-21 11:49 @rafa:_ text`) because it is a fact about the
// comment; read-state does NOT — "has Rafa seen this" is personal to one install, so it lives in
// plugin data (`KanbanSettings.commentsSeen`) keyed by card path, holding the timestamp of the
// newest comment already seen on that card.

/** A comment reduced to what read-state needs: when it was written and by whom. */
export interface CommentMark {
  timestamp: string;
  /** `null` when the line carries no `@author` (every comment written before this feature). */
  author: string | null;
}

/**
 * How loudly a card's comments should call for attention.
 * - `none` — nothing new.
 * - `unread` — at least one comment by someone else that is newer than the seen marker.
 * - `reply` — one of those unread comments comes AFTER a comment of the reader's own, which is the
 *   closest a flat, unthreaded list can get to "someone replied to me".
 */
// Only referenced by UnreadState below, so kept module-private.
type UnreadKind = "none" | "unread" | "reply";

export interface UnreadState {
  kind: UnreadKind;
  /**
   * Positions of the unread comments in the array that was passed in, ascending. The panel marks
   * exactly these, so what it highlights can never drift from what the tile counts.
   */
  indices: number[];
}

const NOTHING_UNREAD: UnreadState = { kind: "none", indices: [] };

/**
 * Normalize a name into something the comment line grammar can carry: no leading `@`, and none of
 * the characters that delimit the prefix (whitespace, `:`, `_`) — those become `-`.
 */
export function normalizeAuthor(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .replace(/[\s:_]+/g, "-");
}

/** Case-insensitive "did I write this?", false whenever either side is unknown/unset. */
export function isMine(author: string | null, userName: string): boolean {
  const me = normalizeAuthor(userName);
  if (!me || !author) return false;
  return author.toLowerCase() === me.toLowerCase();
}

/** The newest comment timestamp on a card — what "I have seen everything" is recorded as. */
export function latestCommentTimestamp(comments: readonly CommentMark[]): string {
  let max = "";
  for (const c of comments) if (c.timestamp > max) max = c.timestamp;
  return max;
}

/**
 * Which of a card's comments the reader has not seen.
 *
 * A comment counts as unread when it is not the reader's own AND its timestamp sorts after `seen`
 * (the stored marker; `undefined` = this card was never opened, so everything counts). Timestamps
 * are the fixed-width `YYYY-MM-DD HH:mm` `stamp()` writes, so a plain string compare orders them.
 * A bullet with no parsable timestamp can never be ordered against the marker and is therefore
 * never reported as unread — deliberate: hand-written bare bullets would otherwise stay lit forever.
 */
export function unreadComments(
  comments: readonly CommentMark[],
  seen: string | undefined,
  userName: string,
): UnreadState {
  const indices: number[] = [];
  let mineBefore = false;
  let reply = false;
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    if (!c) continue;
    if (isMine(c.author, userName)) {
      mineBefore = true;
      continue;
    }
    if (!c.timestamp) continue;
    if (seen !== undefined && c.timestamp <= seen) continue;
    indices.push(i);
    if (mineBefore) reply = true;
  }
  if (indices.length === 0) return NOTHING_UNREAD;
  return { kind: reply ? "reply" : "unread", indices };
}
