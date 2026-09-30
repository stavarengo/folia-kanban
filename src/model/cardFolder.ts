/** The folder a vault path lives in — `""` for a note sitting at the vault root. */
function parentFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * The candidate vault paths a configured `card-folder` value can name, best reading first, for
 * the adapter to pick from by checking which one actually exists.
 *
 * Two readings exist. A value written with an explicit relative marker (`./x`, `../x`, `.`, `..`)
 * means genuinely relative to the board note, so it gets that reading only — a self-contained
 * project folder can point at `./Cards` and stay portable when it moves. Any other value keeps
 * the vault-root reading it always had, with the board-note-relative one as a fallback, so a
 * board whose card folder sits beside it works without repeating its own location.
 *
 * `.` and `..` are resolved here: Obsidian's `normalizePath` leaves them untouched, it only tidies
 * separators. They are matched as whole segments, so folders legitimately named `...` or `..foo`
 * survive. Two readings are dropped rather than returned, which is why the list can come back
 * empty: one that would climb above the vault root (the plugin must never resolve outside the
 * vault) and one that lands on the vault root itself (every note in the vault is not a card
 * folder, and no folder can be created to fix it).
 */
function cardFolderCandidates(boardPath: string, cardFolder: string): string[] {
  // A root-anchored value (`/`, or the empty value `normalizePath` turns into `/`) names the vault
  // root and nothing else. Without this guard the board-note reading below would quietly turn it
  // into the board's own folder, which is not what someone writing `/` asked for. `.` and `..` are
  // a different thing — they do mean "relative to this note" — and fall through to the resolution.
  if (cardFolder.split("/").every((s) => s === "")) return [];
  const relativeOnly = /^\.\.?(\/|$)/.test(cardFolder);
  const bases = relativeOnly ? [parentFolder(boardPath)] : ["", parentFolder(boardPath)];
  const out: string[] = [];
  for (const base of bases) {
    const resolved = resolveSegments(base, cardFolder);
    if (resolved !== null && resolved !== "" && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/**
 * Pick the vault path a configured `card-folder` value names, out of the readings
 * {@link cardFolderCandidates} allows, and report which of them exist right now.
 *
 * `entryAt` is the caller's live view of the vault — the only impure part, injected so the choice
 * itself stays testable. An existing folder always beats one that isn't there, which is what makes
 * the board-note reading a fallback rather than a second guess. When none of the readings exists,
 * the first one wins and keeps its create-on-first-card story: for a value without an explicit
 * `./`, that is the vault-root reading, exactly where the folder has always been created.
 *
 * Only when no reading is an existing folder are the vault's `folders` asked for (walking them is
 * the expensive part), to find the ones a reading names in another letter case. A reading taken by
 * a file spelled exactly that way is left out of the search, just as that file never stopped the
 * other reading from being picked; when it is the preferred reading, the caller refuses the file.
 * The leading segments a reading shares with the board note's own folder stay exact, since that
 * folder is a real path: a `./Cards` beside `basic/Board.md` never reaches into a `Basic/` next to
 * it. The rest, and always the last segment, is compared ignoring case. Exactly one such folder is
 * taken, under its real path, since every consumer compares that path exactly; with two or more,
 * which one was meant is unknowable, so `path` stays the preferred reading and `caseMatches` lists
 * them for the caller to refuse on. Linux lets `Cards/` and `cards/` coexist.
 *
 * `null` when no reading survives at all — see {@link cardFolderCandidates}.
 */
export function resolveCardFolder(
  boardPath: string,
  cardFolder: string,
  entryAt: (path: string) => "folder" | "file" | null,
  folders: () => readonly string[],
): { path: string; existing: string[]; caseMatches: string[] } | null {
  const candidates = cardFolderCandidates(boardPath, cardFolder);
  const [preferred] = candidates;
  if (preferred === undefined) return null;
  const existing = candidates.filter((c) => entryAt(c) === "folder");
  if (existing[0] !== undefined) return { path: existing[0], existing, caseMatches: [] };
  const open = candidates.filter((c) => entryAt(c) === null);
  if (open.length === 0) return { path: preferred, existing, caseMatches: [] };
  const home = parentFolder(boardPath).split("/");
  const matchers = open.map((c) => {
    const segments = c.split("/");
    let kept = 0;
    while (kept < segments.length - 1 && segments[kept] === home[kept]) kept++;
    const anchor = segments.slice(0, kept).join("/");
    return {
      anchor: kept === 0 ? "" : anchor + "/",
      rest: segments.slice(kept).join("/").toLowerCase(),
    };
  });
  const caseMatches = folders().filter((f) =>
    matchers.some(
      (m) => f.startsWith(m.anchor) && f.slice(m.anchor.length).toLowerCase() === m.rest,
    ),
  );
  const [only] = caseMatches;
  return {
    path: only !== undefined && caseMatches.length === 1 ? only : preferred,
    existing,
    caseMatches,
  };
}

/** Join `base` with `path`, resolving `.`/`..` segments. `null` when it climbs above the root. */
function resolveSegments(base: string, path: string): string | null {
  const segments = base === "" ? [] : base.split("/");
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * The context (#14) a card belongs to, derived purely from its path: the immediate subfolder of
 * `cardFolder` it lives under. A card directly in `cardFolder` (no further `/` after the folder)
 * has no context → undefined. The single source of truth shared by every repo + the board build,
 * so derived context can never diverge between adapters. `cardFolder` must already be the
 * resolved path the adapter settled on (see {@link cardFolderCandidates}), never the raw property.
 */
export function deriveContext(cardFolder: string, path: string): string | undefined {
  const prefix = cardFolder + "/";
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined; // file sits directly in the card folder
  return rest.slice(0, slash);
}
