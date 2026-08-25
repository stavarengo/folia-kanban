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
  /**
   * The one unread comment that actually follows a comment of the reader's own — what earns the
   * card its `reply` verdict — or `null` when nothing did. NOT always `indices[0]`: an older unread
   * comment can sit before the reply.
   */
  replyIndex: number | null;
}

const NOTHING_UNREAD: UnreadState = { kind: "none", indices: [], replyIndex: null };

/**
 * Normalize a name into something the comment line grammar can carry: no leading `@`, and neither
 * of the two characters that delimit the prefix (whitespace and `:`) — those become `-`.
 * Underscores survive: `alex_smith` is a name people actually have, and the grammar can hold it.
 */
export function normalizeAuthor(raw: string): string {
  return (
    raw
      .trim()
      .replace(/^@+/, "")
      // Characters that would reopen markdown inside the italic prefix, or start a second author.
      .replace(/[*`[\]@]/g, "")
      .replace(/[\s:]+/g, "-")
  );
}

/** Case-insensitive "did I write this?", false whenever either side is unknown/unset. */
export function isMine(author: string | null, userName: string): boolean {
  const me = normalizeAuthor(userName);
  if (!me || !author) return false;
  return author.toLowerCase() === me.toLowerCase();
}

/**
 * A timestamp turned into something that string-compares chronologically: every run of digits is
 * zero-padded to a common width, so a hand-typed `2026-12-1 9:00` orders next to the
 * `2026-12-02 09:00` that `stamp()` writes instead of after it. Two spellings of the same instant
 * therefore also compare equal, which is what "the same minute" has to mean.
 */
function sortKey(timestamp: string): string {
  return timestamp.replace(/\d+/g, (n) => n.padStart(4, "0"));
}

/**
 * The marker recording "I have seen every comment on this card right now", as one string:
 * `"<newest timestamp>#<how many comments carry it>"`.
 *
 * The count is the part that earns its keep. `stamp()` writes minutes, not seconds, so two comments
 * can share a timestamp — and a bare newest-timestamp marker would swallow every later arrival
 * inside that same minute, permanently. Reading three comments stamped 10:00 records `10:00#3`, so
 * a fourth one stamped 10:00 still counts as unread.
 *
 * Your own comments are left out of it. They are never unread, so they have nothing to mark — and
 * counting them would drag the watermark past comments by other people that a later sync has yet to
 * deliver, hiding them for good.
 *
 * Empty when nothing on the card carries a timestamp; callers store nothing in that case.
 */
export function seenMarker(comments: readonly CommentMark[], userName = ""): string {
  let max = "";
  let maxKey = "";
  let count = 0;
  for (const c of comments) {
    if (!c.timestamp || isMine(c.author, userName)) continue;
    const key = sortKey(c.timestamp);
    if (key > maxKey) {
      max = c.timestamp;
      maxKey = key;
      count = 1;
    } else if (key === maxKey) count++;
  }
  return max ? `${max}#${count}` : "";
}

interface Marker {
  ts: string;
  /** How many comments carried `ts` when the marker was written; `Infinity` for a legacy marker. */
  count: number;
}

/** Split a stored marker. A bare timestamp (no `#`) is read as "all of that minute was seen". */
function parseMarker(marker: string | undefined): Marker | null {
  if (marker === undefined) return null;
  const hash = marker.lastIndexOf("#");
  if (hash === -1) return { ts: marker, count: Number.POSITIVE_INFINITY };
  const count = Number(marker.slice(hash + 1));
  return {
    ts: marker.slice(0, hash),
    count: Number.isFinite(count) ? count : Number.POSITIVE_INFINITY,
  };
}

/**
 * Which of a card's comments the reader has not seen.
 *
 * A comment counts as unread when it is not the reader's own AND it sorts after `seen` (the stored
 * marker from `seenMarker`; `undefined` = this card was never opened, so everything counts).
 * Ordering runs through `sortKey`, so the fixed-width `YYYY-MM-DD HH:mm` that `stamp()` writes and
 * a hand-typed `2026-12-1 9:00` sort by their dates rather than by their characters.
 *
 * A bullet with no timestamp at all cannot be ordered against the marker and is therefore never
 * reported as unread. Deliberate: it has nothing to compare, so it would either stay lit forever or
 * go dark forever, and staying lit forever is the worse of the two.
 */
export function unreadComments(
  comments: readonly CommentMark[],
  seen: string | undefined,
  userName: string,
): UnreadState {
  const indices = unreadIndices(comments, parseMarker(seen), userName);
  if (indices.length === 0) return NOTHING_UNREAD;
  // "After one of yours" is measured in time, like everything else here — not in line order, which
  // an externally merged note can put out of sequence with the timestamps it carries.
  const mineLatest = latestOfMine(comments, userName);
  const replyIndex =
    mineLatest === null
      ? null
      : (indices.find((i) => sortKey(comments[i]?.timestamp ?? "") > mineLatest) ?? null);
  return { kind: replyIndex === null ? "unread" : "reply", indices, replyIndex };
}

/** Sort key of the reader's newest own comment, or `null` when they have written none here. */
function latestOfMine(comments: readonly CommentMark[], userName: string): string | null {
  let max: string | null = null;
  for (const c of comments) {
    if (!c.timestamp || !isMine(c.author, userName)) continue;
    const key = sortKey(c.timestamp);
    if (max === null || key > max) max = key;
  }
  return max;
}

/** Is this comment past the marker? `ordinal` = how many comments of its own minute came up to it. */
function isAfterMarker(key: string, marker: Marker | null, ordinal: number): boolean {
  if (marker === null) return true;
  const markerKey = sortKey(marker.ts);
  if (key !== markerKey) return key > markerKey;
  return ordinal > marker.count;
}

function unreadIndices(
  comments: readonly CommentMark[],
  marker: Marker | null,
  userName: string,
): number[] {
  const out: number[] = [];
  // How many comments stamped at the marker's own minute have gone by, so the ones past the count
  // recorded when it was written still read as new. Counted over the same comments `seenMarker`
  // counted — the reader's own left out — or the two would disagree and the tally would drift.
  let atMarker = 0;
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    if (!c?.timestamp || isMine(c.author, userName)) continue;
    const key = sortKey(c.timestamp);
    if (marker !== null && key === sortKey(marker.ts)) atMarker++;
    if (isAfterMarker(key, marker, atMarker)) out.push(i);
  }
  return out;
}
