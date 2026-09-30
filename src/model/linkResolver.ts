import type { Board, Card } from "./types";
import { linkpath } from "./links";

/** What a `[[wikilink]]` binds to on a given set of cards, read from one note: a card path, or null. */
export type LinkResolver = (link: string) => string | null;

/**
 * The same question with the note asking it named, which is what Obsidian needs to answer it: the
 * host resolves a link differently depending on where it is written (a name a sibling note carries
 * wins over a distant one). Supplied by the adapter — see {@link Board.resolveLink}.
 */
export type SourcedLinkResolver = NonNullable<Board["resolveLink"]>;

/**
 * Build the one resolver every reading of a `[[wikilink]]` goes through — subcard parentage,
 * blocking relationships, and the detail panel's rows alike — so they can never disagree about
 * which card a link names. A `.md` suffix, an `#anchor` and a `|alias` are all tolerated, and the
 * answer is always a card on this board or nothing: a link naming a note outside the card folder
 * resolves to null, the way it always has.
 *
 * `host` is the vault's own resolution (Obsidian's `MetadataCache`, injected by the adapter) and
 * is authoritative when it is there, so a link binds to exactly the note the same link would open
 * in the editor — including the shortest-path and same-folder rules, which need the note the link
 * is written in and are why this takes a `sourcePath` at all.
 *
 * Without a host — a board assembled in a test, or by any caller with no vault behind it — the
 * fallback is the basename index this always used: a link carrying a folder segment binds to that
 * exact path, a bare name binds only when one card answers to it, and an ambiguous name binds to
 * nothing rather than to whichever card came first.
 *
 * Feed it real notes only: the synthetic cards minted for placed inline todos borrow their note's
 * file name, and would make every card holding one look like two cards sharing a name.
 */
export function linkResolver(
  cards: Iterable<Card>,
  host?: SourcedLinkResolver,
): SourcedLinkResolver {
  const byBasename = new Map<string, string[]>();
  const byPath = new Set<string>();
  for (const c of cards) {
    byPath.add(c.path);
    const arr = byBasename.get(c.basename);
    if (arr) arr.push(c.path);
    else byBasename.set(c.basename, [c.path]);
  }
  return (link, sourcePath) => {
    const raw = linkpath(link);
    if (raw === "") return null;
    if (host !== undefined) {
      const hit = host(raw, sourcePath);
      return hit !== null && byPath.has(hit) ? hit : null;
    }
    return indexedLookup(raw, byPath, byBasename);
  };
}

/** The fallback answer, from the basename index alone, for a board with no vault behind it. */
function indexedLookup(
  raw: string,
  byPath: ReadonlySet<string>,
  byBasename: ReadonlyMap<string, string[]>,
): string | null {
  if (raw.includes("/")) {
    const withMd = /\.md$/i.test(raw) ? raw : raw + ".md";
    if (byPath.has(withMd)) return withMd;
  }
  const segments = raw.split("/");
  const last = segments[segments.length - 1];
  const base = (last ?? raw).replace(/\.md$/i, "").trim();
  const paths = byBasename.get(base);
  return paths !== undefined && paths.length === 1 ? (paths[0] ?? null) : null;
}

/**
 * The resolver for a built board, reading links as the note at `sourcePath` writes them. The board
 * carries the answer it was built with (the vault's, where there is a vault), so every later
 * reading agrees with the one that decided the board's own nesting; a `Board` assembled by hand
 * falls back to the basename index over its real notes.
 */
export function boardLinkResolver(board: Board, sourcePath: string): LinkResolver {
  const resolve =
    board.resolveLink ?? linkResolver(Object.values(board.cards).filter((c) => !c.todoRef));
  return (link) => resolve(link, sourcePath);
}
