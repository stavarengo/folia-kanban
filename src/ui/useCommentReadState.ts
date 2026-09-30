import { useEffect, useMemo, useRef } from "react";
import type { CardBody } from "../model/types";
import { SELF, isMine, normalizeAuthor, seenMarker, unreadComments } from "../model/unread";
import { seenMarkerFor, type BoardSettings } from "../settings";
import { useBoardActions } from "./context";

type Post = { floor: number; text: string };
type CommentLine = { text: string; author: string | null };

/** Which comment each post owns, as a map from comment index to its position in `posts`. */
function claimedByPosts(
  posts: readonly Post[],
  comments: readonly CommentLine[],
  claimable: (c: CommentLine) => boolean,
): Map<number, number> {
  const claimed = new Map<number, number>();
  for (let n = posts.length - 1; n >= 0; n--) {
    const p = posts[n];
    if (!p) continue;
    for (let i = comments.length - 1; i >= p.floor; i--) {
      const c = comments[i];
      if (c && c.text === p.text && claimable(c) && !claimed.has(i)) {
        claimed.set(i, n);
        break;
      }
    }
  }
  return claimed;
}

/**
 * Comments this panel has posted on the card it is showing: each one's text, and how many
 * comments the card held when it was sent, i.e. the lowest position it can have landed at. A
 * comment you typed here is yours even when there is no name to sign it with, so it is treated as
 * such below — without it the panel hands your own line straight back to you tagged NEW, which is
 * what every reader who has not set a name would see. Text alone is not an identity (answering
 * "ok" to someone's "ok" must not reclassify theirs as yours), so a post can only claim a line
 * that carries no other author, and claims the LAST such line at or past its floor with its text,
 * newest post first: sending two in a row before the first reload lands, or a comment from
 * elsewhere arriving while the panel is open, still leaves each post its own line. Edits and
 * deletions made from this panel keep the list in step (see `edited` / `removed`), and a post is
 * only recorded once its write has succeeded.
 */
function usePostedHere(body: CardBody | null, userName: string) {
  const postedHere = useRef<{ posts: Post[] }>({ posts: [] });
  const claimable = (c: { author: string | null }): boolean =>
    c.author === null || isMine(c.author, userName);
  const claimed = (comments: readonly CommentLine[]) =>
    claimedByPosts(postedHere.current.posts, comments, claimable);
  const edited = (index: number, text: string): void => {
    const n = claimed(body?.comments ?? []).get(index);
    const post = n === undefined ? undefined : postedHere.current.posts[n];
    if (post) post.text = text;
  };
  const removed = (index: number): void => {
    const n = claimed(body?.comments ?? []).get(index);
    postedHere.current.posts = postedHere.current.posts
      .filter((_, i) => i !== n)
      .map((p) => (p.floor > index ? { ...p, floor: p.floor - 1 } : p));
  };
  const posted = (post: Post) => void postedHere.current.posts.push(post);
  return { claimed, edited, removed, posted };
}

/**
 * Unread comments (§ unread). Read-state is plugin data keyed by card path, so it is read from
 * settings rather than from the note. Two things happen here and their order is the whole point:
 * the panel SNAPSHOTS the seen-marker as the card opens and renders "new" against that snapshot,
 * while the effect writes the fresh marker. Reading against the live value instead would clear
 * the markers in the same breath as showing them.
 */
export function useCommentReadState({
  path,
  body,
  bodyPath,
  settings,
}: {
  path: string;
  body: CardBody | null;
  /** Which card `body` was read from — this must not trust a stale one. */
  bodyPath: string | null;
  settings: BoardSettings;
}) {
  const actions = useBoardActions();
  const posts = usePostedHere(body, settings.userName);
  const seenOnOpen = useRef<{ seen: string | undefined } | null>(null);
  seenOnOpen.current ??= { seen: seenMarkerFor(settings, path) };
  const seenAtOpen = seenOnOpen.current.seen;
  /**
   * Who "me" is for this panel. With a name set it is that name as the line grammar writes it
   * (`Ana Maria` signs as `Ana-Maria`, and must recognise itself); with none, a value no author can
   * ever spell, so an unsigned comment by someone else still reads as theirs while the ones typed
   * here read as the reader's own.
   */
  const me = normalizeAuthor(settings.userName) || SELF;
  // `body` outlives the card it was read from: navigating to another card re-renders with the
  // PREVIOUS card's body still in state, and only then does the loader replace it. Pairing it
  // with the path it came from keeps the marker written below from being the old card's.
  const noteMarks = useMemo(
    () =>
      bodyPath === path
        ? (body?.comments ?? []).map((c) => ({ timestamp: c.timestamp, author: c.author }))
        : [],
    [body, bodyPath, path],
  );
  const commentMarks = useMemo(
    () => {
      const own = posts.claimed(body?.comments ?? []);
      return noteMarks.map((m, i) => (own.has(i) ? { ...m, author: me } : m));
    },
    // The posts are a ref, not a dependency: what they hold only changes together with `body`.
    [noteMarks, body, me],
  );
  const unread = useMemo(
    () => unreadComments(commentMarks, seenAtOpen, me),
    [commentMarks, seenAtOpen, me],
  );
  const commentKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return (body?.comments ?? []).map((c) => {
      const id = `${c.timestamp}\u0000${c.author ?? ""}\u0000${c.text}`;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return `${id}\u0000${n}`;
    });
  }, [body]);
  // Opening a card marks everything on it as seen. Keyed on the newest timestamp (a string), not on
  // the comments array, which is a fresh reference after every board reload; the equality guard
  // stops the settings write it triggers from coming straight back round.
  //
  // Built from the note's own authorship and the name in settings — the tile's view of "mine" —
  // not from the panel's. The two must agree on what the marker leaves out: a comment posted here
  // without a name is unsigned in the note, so to the tile it is someone else's, and a marker that
  // skipped it would light the tile for the reader's own words.
  const marker = seenMarker(noteMarks, settings.userName);
  const seenNow = settings.commentsSeen[path];
  // What was last written from here, so StrictMode's double-invoked effect (and any re-render that
  // arrives before the settings write lands) does not save the same marker to disk twice.
  const wrote = useRef("");
  useEffect(() => {
    // Nothing to say until this card's own body has arrived; `commentMarks` is empty both while it
    // loads and when the card genuinely has no trackable comment, and only the second means "forget
    // whatever marker is stored" (its comments may have been rewritten out from under us).
    if (bodyPath !== path) return;
    const stamped = `${path}\u0000${marker}`;
    if ((seenNow ?? "") === marker || wrote.current === stamped) return;
    wrote.current = stamped;
    actions.markCommentsSeen(path, marker);
  }, [path, bodyPath, marker, seenNow, actions]);
  return {
    unread,
    commentKeys,
    edited: posts.edited,
    removed: posts.removed,
    posted: posts.posted,
  };
}

export type CommentReadState = ReturnType<typeof useCommentReadState>;
