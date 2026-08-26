// Pure board graph + drag reducer. No Obsidian dependency.
//
// Parentage has a single source of truth: a card is a subcard of P iff P's `## Subtasks`
// checklist links to it (`- [ ] [[Child]]`). We invert those links to derive parent-of and
// the top-level set. No `parent` frontmatter, so re-parenting is one write and can't desync.

import type {
  Board,
  BoardConfig,
  Card,
  CardFrontmatter,
  ColumnDef,
  ContextConfig,
  RelationDirection,
  RelationLink,
  RelationType,
  RelationTypeDef,
} from "./types";
import { BLOCKS, readInverse, readRelations } from "./relationships";

const DONE_RE = /\b(done|complete|completed|finished|shipped|closed)\b/i;

/**
 * The column that means "finished": the one whose id is literally `done`, else the first whose id
 * or title reads as done, else none. Lives here rather than in the UI because the board graph needs
 * it too — a checked inline todo is done whatever its `[status:: …]` line says.
 */
export function findDoneColumn(columns: readonly ColumnDef[]): string | null {
  const exact = columns.find((c) => c.id.toLowerCase() === "done");
  if (exact) return exact.id;
  const fuzzy = columns.find((c) => DONE_RE.test(c.id) || DONE_RE.test(c.title));
  return fuzzy?.id ?? null;
}

// A placed inline todo is a board item without a file. Its id is its owning note's path plus the
// checklist index — `#` cannot occur in an Obsidian vault path, so this can never collide with a
// real card, and it holds no `::`, so the drag-id namespacing still splits it correctly.
const TODO_PATH_SEP = "#todo:";

/** The synthetic board path for the index-th checklist line of the note at `parentPath`. */
export function makeTodoPath(parentPath: string, index: number): string {
  return parentPath + TODO_PATH_SEP + index;
}

/**
 * Read a synthetic inline-todo path back into the note that owns the line and the line's index,
 * or `null` for an ordinary card path. Every write path uses this to route to a real file.
 */
export function parseTodoPath(path: string): { parentPath: string; index: number } | null {
  const at = path.lastIndexOf(TODO_PATH_SEP);
  if (at < 0) return null;
  const index = Number(path.slice(at + TODO_PATH_SEP.length));
  if (!Number.isInteger(index) || index < 0) return null;
  return { parentPath: path.slice(0, at), index };
}

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
 * `isFolder` is the caller's live view of the vault — the only impure part, injected so the choice
 * itself stays testable. An existing folder always beats one that isn't there, which is what makes
 * the board-note reading a fallback rather than a second guess. When none of the readings exists,
 * the first one wins and keeps its create-on-first-card story: for a value without an explicit
 * `./`, that is the vault-root reading, exactly where the folder has always been created.
 *
 * `null` when no reading survives at all — see {@link cardFolderCandidates}.
 */
export function resolveCardFolder(
  boardPath: string,
  cardFolder: string,
  isFolder: (path: string) => boolean,
): { path: string; existing: string[] } | null {
  const candidates = cardFolderCandidates(boardPath, cardFolder);
  const [preferred] = candidates;
  if (preferred === undefined) return null;
  const existing = candidates.filter(isFolder);
  return { path: existing[0] ?? preferred, existing };
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

/** What a `[[wikilink]]` binds to on a given set of cards: a card path, or null. */
export type LinkResolver = (link: string) => string | null;

/**
 * Build the one resolver every reading of a `[[wikilink]]` goes through — subcard parentage,
 * blocking relationships, and the detail panel's rows alike — so they can never disagree about
 * which card a link names. A link carrying a folder segment binds to that exact path; otherwise
 * it matches by basename, but only when that basename is unambiguous (duplicate basenames across
 * folders resolve to nothing rather than silently binding the wrong one). A `.md` suffix, an
 * `#anchor` and a `|alias` are all tolerated.
 *
 * Feed it real notes only: the synthetic cards minted for placed inline todos borrow their note's
 * file name, and would make every card holding one look like two cards sharing a name.
 */
function linkResolver(cards: Iterable<Card>): LinkResolver {
  const byBasename = new Map<string, string[]>();
  const byPath = new Set<string>();
  for (const c of cards) {
    byPath.add(c.path);
    const arr = byBasename.get(c.basename);
    if (arr) arr.push(c.path);
    else byBasename.set(c.basename, [c.path]);
  }
  return (link) => {
    const noAnchor = link.split("#");
    const noAlias = (noAnchor[0] ?? link).split("|");
    const raw = (noAlias[0] ?? "").trim();
    if (raw.includes("/")) {
      const withMd = /\.md$/i.test(raw) ? raw : raw + ".md";
      if (byPath.has(withMd)) return withMd;
    }
    const segments = raw.split("/");
    const last = segments[segments.length - 1];
    const base = (last ?? raw).replace(/\.md$/i, "").trim();
    const paths = byBasename.get(base);
    return paths !== undefined && paths.length === 1 ? (paths[0] ?? null) : null;
  };
}

/** The resolver for a built board: its real notes, never the tiles minted for placed todos. */
export function boardLinkResolver(board: Board): LinkResolver {
  return linkResolver(Object.values(board.cards).filter((c) => !c.todoRef));
}

/** Alphabetical by displayed title; the basename breaks ties so the order stays deterministic. */
function byTitle(a: Card, b: Card): number {
  return a.title.localeCompare(b.title) || a.basename.localeCompare(b.basename);
}

function orderOf(c: Card): number | null {
  const o = c.frontmatter.order;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
}

/**
 * Merge ordered + unordered cards into one stable sequence.
 * Cards with an explicit numeric `order` sort by it. Cards without one are appended after all
 * ordered cards (alphabetically), each with a strictly-distinct effective order BEYOND the max
 * real order — so a synthetic position can never collide with a real `order` value (a collision
 * would make `computeDropOrder` return a duplicate rank and a drop land in the wrong place).
 */
export function columnEffectiveOrders(cards: Card[]): { card: Card; eff: number }[] {
  const ordered = cards
    .filter((c) => orderOf(c) !== null)
    .map((c) => {
      const eff = orderOf(c);
      if (eff === null) throw new Error("invariant: filtered null order");
      return { card: c, eff };
    })
    .sort((a, b) => a.eff - b.eff || byTitle(a.card, b.card));
  const lastOrdered = ordered[ordered.length - 1];
  const maxEff = lastOrdered !== undefined ? lastOrdered.eff : -1;
  const unordered = cards
    .filter((c) => orderOf(c) === null)
    .sort(byTitle)
    .map((c, i) => ({ card: c, eff: maxEff + 1 + i }));
  return [...ordered, ...unordered];
}

/**
 * True when a card is genuinely nested: walking its parent chain bottoms out at a parentless
 * top-level root. A chain that loops (mutual / cyclic subcard links) returns false, so cycle
 * members are surfaced as top-level cards instead of silently vanishing from every column.
 */
function isGenuinelyNested(path: string, parentOf: Record<string, string>): boolean {
  let cur: string | undefined = parentOf[path];
  if (!cur) return false;
  const seen = new Set<string>([path]);
  while (cur) {
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = parentOf[cur];
  }
  return true;
}

/**
 * Resolve every relationship declaration into the two directions each card sees, and hang the
 * result on the cards themselves (the `context` precedent). One pass per type in the board's
 * vocabulary; `blocks` / `blocked-by` is one such type.
 *
 * A type's key and its inverse key describe the SAME kind of edge from opposite ends, so both are
 * read into one graph and an edge declared from both ends is kept once — as `both` rather than as
 * either end's own, because neither note can end it alone. `source` is what tells the detail panel
 * whether the card in front of you may remove the link or only report where it lives. A card
 * cannot relate to itself: a self-link is dropped rather than shown as both ends.
 */
function buildRelations(
  cards: Card[],
  resolve: LinkResolver,
  types: readonly RelationTypeDef[],
): void {
  const outgoing: Record<string, RelationLink[]> = {};
  const incoming: Record<string, RelationLink[]> = {};
  // Every edge already registered, so a second statement of the same one is folded into it rather
  // than added twice — and so the fact that it WAS stated twice is not lost, which is what decides
  // whether one note can end the relationship on its own.
  const seen = new Map<
    string,
    { declarer: string | null; out?: RelationLink; in?: RelationLink }
  >();
  // One end of an edge, for that key: its card path, or the raw target when nothing resolved (so
  // two notes pointing at the same missing card still count as one edge).
  const endKey = (end: { path: string | null; target: string }) => end.path ?? "?" + end.target;

  const addEdge = (
    type: RelationType,
    from: { path: string | null; target: string },
    to: { path: string | null; target: string },
    declaredBy: "from" | "to",
  ) => {
    if (from.path !== null && from.path === to.path) return; // no card relates to itself
    const key = type + ":" + endKey(from) + ">" + endKey(to);
    const declarer = declaredBy === "from" ? from.path : to.path;
    const existing = seen.get(key);
    if (existing) {
      // Stated a second time by the OTHER note: both ends declare it, so deleting the declaring
      // list alone would not end it — the inverse would simply be derived again on the next load.
      // Say so on both rows instead of offering a remove button that quietly does nothing.
      if (existing.declarer !== declarer) {
        if (existing.out) existing.out.source = "both";
        if (existing.in) existing.in.source = "both";
        return;
      }
      // Stated twice by the SAME note, spelled differently (`[[B]]` and `[[Tasks/B]]`). One row,
      // but every spelling has to go when it is removed — remember them all on that row.
      const link = declaredBy === "from" ? existing.out : existing.in;
      const extra = declaredBy === "from" ? to.target : from.target;
      if (link && !link.targets.includes(extra)) link.targets.push(extra);
      return;
    }
    const record: { declarer: string | null; out?: RelationLink; in?: RelationLink } = { declarer };
    if (from.path !== null) {
      record.out = {
        type,
        direction: "out",
        target: to.target,
        targets: [to.target],
        path: to.path,
        source: declaredBy === "from" ? "own" : "inverse",
      };
      (outgoing[from.path] ??= []).push(record.out);
    }
    if (to.path !== null) {
      record.in = {
        type,
        direction: "in",
        target: from.target,
        targets: [from.target],
        path: from.path,
        source: declaredBy === "to" ? "own" : "inverse",
      };
      (incoming[to.path] ??= []).push(record.in);
    }
    seen.set(key, record);
  };

  for (const type of types) {
    // Two passes, the declaring key first, so an edge stated at BOTH ends always keeps the
    // declaration the plugin itself writes. Reading them card by card would hand that to whichever
    // note the vault happened to list first, and with it whether the panel offers a remove button.
    for (const c of cards) {
      for (const target of readRelations(c.frontmatter, type.key)) {
        addEdge(
          type.key,
          { path: c.path, target: c.basename },
          { path: resolve(target), target },
          "from",
        );
      }
    }
    for (const c of cards) {
      for (const target of readInverse(c.frontmatter, type)) {
        addEdge(
          type.key,
          { path: resolve(target), target },
          { path: c.path, target: c.basename },
          "to",
        );
      }
    }
  }

  for (const c of cards) {
    c.relations = [...(outgoing[c.path] ?? []), ...(incoming[c.path] ?? [])];
  }
}

export function buildBoard(
  config: BoardConfig,
  cards: Card[],
  contexts: Record<string, ContextConfig> = {},
): Board {
  // Derive each card's context from its path (#14): one place, so every card on the board carries
  // the same notion of context the `context:` filter token reads. Path-derived, never written.
  for (const c of cards) {
    const ctx = deriveContext(config.cardFolder, c.path);
    if (ctx !== undefined) c.context = ctx;
  }

  const resolve = linkResolver(cards);
  const cardsByPath: Record<string, Card> = {};
  for (const c of cards) cardsByPath[c.path] = c;

  buildRelations(cards, resolve, config.relations);

  const parentOf: Record<string, string> = {};
  for (const c of cards) {
    for (const link of c.childLinks) {
      const childPath = resolve(link);
      if (childPath && childPath !== c.path && !parentOf[childPath]) {
        parentOf[childPath] = c.path;
      }
    }
  }

  const colIds = new Set(config.columns.map((c) => c.id));
  const firstCol = config.columns[0]?.id;
  const doneCol = findDoneColumn(config.columns);

  // The column a card actually renders in. A top-level card reads its own `status` and falls back
  // to the first column, as it always has. A nested subcard reads its own `status` too — that is
  // what lets it sit in a column of its own — and only falls back to its parent's column when it
  // has none, which is why a board nobody has moved a subitem on looks exactly as it did.
  // Memoized, and the walk terminates because `isGenuinelyNested` already rejected every cycle.
  const effective = new Map<string, string | undefined>();
  const effectiveColumnOf = (path: string): string | undefined => {
    const hit = effective.get(path);
    if (hit !== undefined || effective.has(path)) return hit;
    effective.set(path, firstCol); // cycle guard; overwritten below
    const card = cardsByPath[path];
    const st = String(card?.frontmatter.status ?? "");
    const own = colIds.has(st) ? st : undefined;
    const parent = parentOf[path];
    const value =
      own ?? (parent && isGenuinelyNested(path, parentOf) ? effectiveColumnOf(parent) : firstCol);
    effective.set(path, value);
    return value;
  };

  const groups: Record<string, Card[]> = {};
  for (const col of config.columns) groups[col.id] = [];
  const place = (card: Card, target: string | undefined) => {
    if (!target) return;
    const bucket = groups[target];
    if (bucket) bucket.push(card);
  };

  // Every subitem standing in a column of its own, mapped to the card it belongs to. This is what
  // the render layer reads for the `↳ parent` reference — NOT `parentOf`, which also links the
  // members of a subcard cycle to each other and would give a top-level card a parent it does not
  // visibly have.
  const placedOf: Record<string, string> = {};
  const placedChildren = new Set<string>();
  for (const c of cards) {
    const nested = isGenuinelyNested(c.path, parentOf);
    if (!nested) {
      place(c, effectiveColumnOf(c.path));
      continue;
    }
    const parent = parentOf[c.path];
    const own = effectiveColumnOf(c.path);
    if (parent !== undefined && own !== undefined && own !== effectiveColumnOf(parent)) {
      placedChildren.add(c.path);
      placedOf[c.path] = parent;
      place(c, own);
    }
  }

  // Inline todos that claim a column of their own become synthetic cards, so every per-column rule
  // the board already has — order, sort, group, filter, WIP count, drag — applies to them without
  // a second implementation. A line with no `[status:: …]` field claims nothing and keeps rendering
  // inside its parent card, exactly as before; a checked line is done wherever its field points.
  const placedTodos = new Map<string, { indices: Set<number>; doneByColumn: number }>();
  const placedFor = (path: string) => {
    let placed = placedTodos.get(path);
    if (!placed) placedTodos.set(path, (placed = { indices: new Set(), doneByColumn: 0 }));
    return placed;
  };
  for (const c of cards) {
    const parentColumn = effectiveColumnOf(c.path);
    for (const item of c.subItems ?? []) {
      if (item.kind === "card") {
        // The same one meaning of done, for a line that names a file: the child's own `status`
        // says where it stands, and standing in the done column is finished whether or not the
        // parent's box was ever ticked. Every write the board makes ticks that box (`moveCard`),
        // but a `status` edited by hand in the child note reaches the parent only here — so the
        // progress bar tells the truth either way, and the note catches up on the next move.
        const child = item.link === undefined ? null : resolve(item.link);
        const finished =
          child !== null && child !== c.path && cardsByPath[child]?.frontmatter.status === doneCol;
        if (!item.done && doneCol !== null && finished) placedFor(c.path).doneByColumn++;
        continue;
      }
      const claimed =
        item.status !== undefined && colIds.has(item.status) ? item.status : undefined;
      if (claimed === undefined) continue;
      // Done has one meaning, reached two ways: the line is checked, or its field names the done
      // column. Either says the work is finished, so both put it there and both count as finished
      // on the parent's progress bar — a line hand-written as `- [ ] X [status:: done]` cannot end
      // up sitting in Done while the card it belongs to still calls it outstanding.
      const finished = item.done || claimed === doneCol;
      const target = finished && doneCol ? doneCol : claimed;
      // The card's own reading of the line comes first, and holds whether or not a tile is minted:
      // a line claiming the done column is finished even when its card is ALREADY in that column
      // and there is nothing to move it to, which is exactly where the tile is skipped below.
      const placed = placedFor(c.path);
      if (finished && !item.done) {
        placed.indices.add(item.index); // finished work is not an outstanding next action
        placed.doneByColumn++;
      }
      if (target === parentColumn) continue; // back home: renders inside its parent again
      const path = makeTodoPath(c.path, item.index);
      const todoCard: Card = {
        path,
        basename: c.basename,
        title: item.text,
        titleSource: "subtask",
        frontmatter: { status: target },
        childLinks: [],
        todoRef: { parentPath: c.path, index: item.index, claim: item.status ?? "" },
      };
      if (c.context !== undefined) todoCard.context = c.context;
      cardsByPath[path] = todoCard;
      parentOf[path] = c.path;
      placedOf[path] = c.path;
      placed.indices.add(item.index);
      place(todoCard, target);
    }
  }

  // A todo showing as its own tile must not ALSO show in its parent's "next todos" list. Its
  // checklist line still counts towards the parent's progress: the work is still the card's — and
  // one sitting in the done column counts as finished there even if nobody ticked its box.
  for (const [path, placed] of placedTodos) {
    const card = cardsByPath[path];
    const stats = card?.stats;
    if (!card || !stats) continue;
    card.stats = {
      ...stats,
      checklistDone: stats.checklistDone + placed.doneByColumn,
      nextTodos: stats.nextTodos.filter((t) => !placed.indices.has(t.index)),
    };
  }

  const columns: Record<string, string[]> = {};
  for (const col of config.columns) {
    columns[col.id] = columnEffectiveOrders(groups[col.id] ?? []).map((x) => x.card.path);
  }

  // Inverse of parentOf, but ONLY for genuinely-nested children that are not placed in a column of
  // their own — and so a card in an A<->B cycle (which parentOf links both ways) is excluded here.
  // That keeps childrenOf a forest: cycle members surface only as top-level cards, never doubly as
  // a nested child of each other.
  const childGroups: Record<string, Card[]> = {};
  for (const c of cards) {
    const parent = parentOf[c.path];
    if (!parent || placedChildren.has(c.path) || !isGenuinelyNested(c.path, parentOf)) continue;
    (childGroups[parent] ??= []).push(c);
  }
  const childrenOf: Record<string, string[]> = {};
  for (const parent in childGroups) {
    childrenOf[parent] = columnEffectiveOrders(childGroups[parent] ?? []).map((x) => x.card.path);
  }

  return { config, columns, cards: cardsByPath, parentOf, placedOf, childrenOf, contexts };
}

/** How many links of one type a card shows in each direction (see {@link relationCounts}). */
export interface RelationCount {
  type: RelationTypeDef;
  out: number;
  in: number;
}

/**
 * The relationship markers a card shows, per card path: one entry per type it has links of, in
 * the vocabulary's order. Only paths with at least one are present, so a lookup that misses means
 * "nothing to show". Unresolved targets never count — there is no card on the other end.
 *
 * A blocking link counts while NEITHER end sits in the board's done column: a card is not held up
 * by something already finished, and a finished card is not holding anything up. Every other type
 * is a plain link with no such meaning, so it counts whatever column either end is in. This is
 * presentation only; nothing about it restricts what a card may do, which stays true to the
 * board's nudge-never-block posture.
 */
export function relationCounts(
  board: Board,
  doneColumnId: string | null,
): Record<string, RelationCount[]> {
  const isDone = (path: string) =>
    doneColumnId !== null && board.cards[path]?.frontmatter.status === doneColumnId;
  const out: Record<string, RelationCount[]> = {};
  for (const [path, card] of Object.entries(board.cards)) {
    const links = card.relations;
    if (!links) continue;
    const counts: RelationCount[] = [];
    for (const type of board.config.relations) {
      const holdsUp = type.key !== BLOCKS.key || !isDone(path);
      const live = (direction: RelationDirection) =>
        links.filter(
          (l) =>
            l.type === type.key &&
            l.direction === direction &&
            l.path !== null &&
            holdsUp &&
            (type.key !== BLOCKS.key || !isDone(l.path)),
        ).length;
      const count = { type, out: live("out"), in: live("in") };
      if (count.out > 0 || count.in > 0) counts.push(count);
    }
    if (counts.length > 0) out[path] = counts;
  }
  return out;
}

/**
 * Every path reachable from `roots` by walking `board.childrenOf` (the same nested-subcard tree
 * `SubcardGroup` renders), roots included. Used by a column's "collapse all / expand all" so it
 * sets every descendant's state, not just the top-level cards — an "expand all" that stopped at
 * the top would leave a grandchild collapsed from an earlier individual toggle. Cycle-safe with
 * the same per-branch `seen` guard `SubcardGroup` uses.
 */
export function subtreePaths(board: Board, roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (path: string, seen: ReadonlySet<string>) => {
    out.push(path);
    for (const child of board.childrenOf[path] ?? []) {
      if (seen.has(child) || !board.cards[child]) continue;
      walk(child, new Set(seen).add(child));
    }
  };
  for (const root of roots) walk(root, new Set([root]));
  return out;
}

// ---------------------------------------------------------------------------
// Drag reducer
// ---------------------------------------------------------------------------

// A card can be placed in more than one column at once: its status column AND any cross-board lane
// (#1) whose filter it matches. dnd-kit keys draggables/droppables by id, so two placements sharing a
// bare `card.path` would collide (last-writer-wins, non-deterministic). We therefore give each
// PLACEMENT a unique sortable id, namespaced by the column it renders in: `${columnId}::${card.path}`.
// The separator is the first `::` only — a card path may itself contain `::`, a column id cannot
// (column ids come from frontmatter keys / titleCase and never include it).
const CARD_DRAG_SEP = "::";

/** Build the per-placement sortable id for a card rendered in `columnId`. */
export function makeCardDragId(columnId: string, path: string): string {
  return columnId + CARD_DRAG_SEP + path;
}

/**
 * Parse a per-placement card sortable id back into its column + real card path. Splits on the FIRST
 * `::` so a path containing `::` survives intact. An un-namespaced id (no separator — e.g. a legacy
 * or column id passed by mistake) yields an empty `columnId` and the whole string as `path`.
 */
export function splitCardDragId(id: string): { columnId: string; path: string } {
  const i = id.indexOf(CARD_DRAG_SEP);
  if (i < 0) return { columnId: "", path: id };
  return { columnId: id.slice(0, i), path: id.slice(i + CARD_DRAG_SEP.length) };
}

/**
 * A live cross-column relocation in progress: the active card (`activeId` is its ORIGINAL namespaced
 * sortable id, kept stable through the drop so dnd-kit never loses the rect) is being shown moved
 * from `fromColumn` into `toColumn`, inserted before `beforePath` (or appended when null).
 */
export interface DragReloc {
  activeId: string;
  fromColumn: string;
  toColumn: string;
  beforePath: string | null;
}

/**
 * Apply a live cross-column relocation to a columns map, yielding the EFFECTIVE per-column card
 * paths to render while the drag is open. Pure + idempotent: the active path is removed from EVERY
 * column first (so a stale reloc applied to a board where the card already landed can't duplicate
 * it), then inserted into `toColumn` before `beforePath` — or appended when `beforePath` is null or
 * not found. The input map is left untouched. Only the two affected columns get new arrays; the rest
 * are returned by reference. Returns the input itself when there's no reloc.
 */
export function applyReloc(
  columns: Record<string, string[]>,
  reloc: DragReloc | null,
): Record<string, string[]> {
  if (!reloc) return columns;
  // `fromColumn` needs no special handling: removing the active path from EVERY column below already
  // empties the source (and makes the reducer idempotent against a board where the card has landed).
  const { toColumn, beforePath } = reloc;
  const { path } = splitCardDragId(reloc.activeId);
  const out: Record<string, string[]> = {};
  for (const [colId, paths] of Object.entries(columns)) {
    out[colId] = paths.includes(path) ? paths.filter((p) => p !== path) : paths;
  }
  const target = (out[toColumn] ?? []).slice();
  const at = beforePath != null ? target.indexOf(beforePath) : -1;
  if (at >= 0) target.splice(at, 0, path);
  else target.push(path);
  out[toColumn] = target;
  return out;
}

/**
 * Decide the live cross-column relocation a drag's current `over` target implies — the make-room
 * counterpart to {@link planDrop}, kept pure so the gap rules are unit-testable. Returns `null` when
 * no gap should open: a column drag (bare column active id), no target, or a SAME-column hover (the
 * native sortable owns that reorder — its tween is already correct, so we never override it).
 *
 * `rawOverId` may be a column id (dropped on / hovering the column body → `beforePath: null`, append)
 * or a namespaced card id (`col::path` → insert before that path). Callers must short-circuit a hover
 * over the dragged card's OWN placeholder (`rawOverId === rawActiveId`) BEFORE calling this — once the
 * card is relocated it carries its source-column id, so its own `over` would parse back to `fromColumn`
 * and falsely read as same-column, collapsing the gap.
 */
export function resolveDragReloc(
  rawActiveId: string,
  rawOverId: string | null,
  columnIds: string[],
): DragReloc | null {
  if (columnIds.includes(rawActiveId)) return null; // a column reorder, not a card move
  if (rawOverId == null) return null;
  const fromColumn = splitCardDragId(rawActiveId).columnId;
  let toColumn: string;
  let beforePath: string | null;
  if (columnIds.includes(rawOverId)) {
    toColumn = rawOverId; // over the column body → append
    beforePath = null;
  } else {
    const split = splitCardDragId(rawOverId);
    if (!split.columnId) return null; // un-namespaced / unrecognised over id
    toColumn = split.columnId;
    beforePath = split.path; // over a card → insert before it
  }
  if (toColumn === fromColumn) return null; // same-column: native sortable owns it
  return { activeId: rawActiveId, fromColumn, toColumn, beforePath };
}

function between(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (prev !== null) return prev + 1;
  if (next !== null) return next - 1;
  return 0;
}

/** New fractional order for a card dropped at `dropIndex` among `colCards` (moving card excluded). */
export function computeDropOrder(colCards: Card[], dropIndex: number): number {
  const eff = columnEffectiveOrders(colCards).map((x) => x.eff);
  const prev = dropIndex > 0 ? (eff[dropIndex - 1] ?? null) : null;
  const next = dropIndex < eff.length ? (eff[dropIndex] ?? null) : null;
  return between(prev, next);
}

export interface CardMutation {
  /** The note to write. For an inline todo this is the note that OWNS the checklist line. */
  path: string;
  setFrontmatter?: Partial<CardFrontmatter>;
  /**
   * An inline todo's placement, written to its own `## Subtasks` line instead of to frontmatter:
   * the line's `[status:: …]` field (`null` clears it) and, when the move states one, its checkbox.
   * An absent `done` leaves the box exactly as the note has it. Mutually exclusive with
   * `setFrontmatter` — a checklist line has no frontmatter of its own.
   */
  setSubtaskStatus?: { index: number; status: string | null; done?: boolean };
  /** Frontmatter keys to remove from `path` — how a subcard's own `status` claim is dropped. */
  unsetFrontmatter?: string[];
  /**
   * Checklist lines in OTHER notes to tick or untick along with this move: for each note, the
   * `[[link]]` targets of the lines that name the moved card (see {@link setSubcardDone}). Lines are
   * addressed by their link and never by a position, so a note edited in the meantime can at worst
   * receive no write — never one on somebody else's todo.
   */
  parentLines?: { path: string; links: string[]; done: boolean }[];
  /** History event text to append (timestamp added by the adapter). */
  history?: string;
}

function columnTitle(config: BoardConfig, id: string): string {
  return config.columns.find((c) => c.id === id)?.title ?? id;
}

/**
 * Reorder columns by moving the column `activeId` to the slot currently held by `overId`.
 * Pure: returns a new array, leaving the input untouched. A drop onto itself, an unknown id,
 * or a no-op move returns the original order (referentially the same array when nothing moves).
 * Drives the header drag-reorder (#2); the menu's step-wise move stays a separate path.
 */
export function moveColumn(columns: ColumnDef[], activeId: string, overId: string): ColumnDef[] {
  if (activeId === overId) return columns;
  const from = columns.findIndex((c) => c.id === activeId);
  const to = columns.findIndex((c) => c.id === overId);
  if (from < 0 || to < 0 || from === to) return columns;
  const next = columns.slice();
  const spliced = next.splice(from, 1);
  const moved = spliced[0];
  if (moved === undefined) return columns;
  next.splice(to, 0, moved);
  return next;
}

/** A column renders its cards in a COMPUTED order when it groups or sorts non-manually (#6). Manual
 *  in-column drag-reorder is a no-op there (the order is recomputed every render). */
export function isComputedOrder(board: Board, columnId: string): boolean {
  const col = board.config.columns.find((c) => c.id === columnId);
  if (!col) return false;
  return (col.group ?? "none") !== "none" || (col.sort ?? "manual") !== "manual";
}

/** What a dnd-kit drop should do, after parsing namespaced card ids and applying the drag rules. */
export type DropPlan =
  | { kind: "reorderColumns"; activeId: string; overId: string }
  | { kind: "moveCard"; path: string; overId: string }
  | { kind: "noop" };

/**
 * Decide what a finished drag should do. Pure + UI-free so the rules are unit-testable.
 *
 * Card sortables are namespaced `${columnId}::${card.path}` (#2) so a card placed in both its status
 * column and a cross-board lane (#1) never collides on a single dnd-kit id. This unwraps the active +
 * over ids back to bare ids and routes:
 *  - a bare COLUMN active id → column reorder (#2 header drag);
 *  - a same-column card drop onto a COMPUTED-order column → no-op (#3: manual reorder is meaningless
 *    when the order is grouped/sorted; cross-column moves still flow through);
 *  - otherwise → a card move, with the real path + the real (un-namespaced) over id for resolveDrop.
 */
export function planDrop(
  board: Board,
  rawActiveId: string,
  rawOverId: string,
  columnIds: string[],
): DropPlan {
  if (columnIds.includes(rawActiveId)) {
    return { kind: "reorderColumns", activeId: rawActiveId, overId: rawOverId };
  }
  const { columnId: fromColumn, path: activePath } = splitCardDragId(rawActiveId);
  const overIsColumn = columnIds.includes(rawOverId);
  const over = overIsColumn ? null : splitCardDragId(rawOverId);
  const toColumn = overIsColumn ? rawOverId : (over?.columnId ?? "");
  const realOver = overIsColumn ? rawOverId : (over?.path ?? rawOverId);
  if (toColumn === fromColumn && isComputedOrder(board, toColumn)) {
    return { kind: "noop" };
  }
  return { kind: "moveCard", path: activePath, overId: realOver };
}

/**
 * Move the index-th checklist line of `parentPath` into `toColumnId`, or back home to wherever its
 * card is with `null`. This is the ONE write behind every way a todo changes column — the drag, the
 * context menu and the detail panel — so a todo cannot end up in a state one of them can produce
 * and another cannot read.
 *
 * The checkbox moves with it: landing in the done column checks the line, any other column unchecks
 * it. That keeps the two ways a todo can say "finished" from disagreeing, since a line sitting in
 * the done column reads as done whether or not anyone ticked its box. Coming home does not touch
 * the checkbox at all — it says where a todo shows, never whether the work is over.
 */
export function moveSubtask(
  board: Board,
  parentPath: string,
  index: number,
  toColumnId: string | null,
): CardMutation | null {
  const parent = board.cards[parentPath];
  if (!parent) return null;
  const item = parent.subItems?.find((s) => s.index === index && s.kind === "todo");
  if (!item) return null;
  const home = columnOf(board, parentPath);
  const from = columnOf(board, makeTodoPath(parentPath, index)) ?? home;
  const target = toColumnId ?? home;
  // "The column my card is in" and "no claim of my own" name the same place, and only one of them
  // keeps naming it after the card moves. So a move that lands on the card's own column is written
  // as no claim at all: otherwise dragging a todo back onto its parent would leave a field pinning
  // it to that column, and the todo would pop out on its own the next time the card was dragged.
  const claimTo = toColumnId !== null && toColumnId === home ? null : toColumnId;
  // What the line LITERALLY says, unnormalised — including a value naming no column of this board
  // (a typo, or a column since renamed). The board graph ignores such a value, but the write path
  // must not: normalising it to "no claim" here would make the guard below skip the one write that
  // can clear it, leaving a field no interface could reach and the todo free to detach the day a
  // column with that id appears.
  const claim = item.status ?? null;
  // Naming a column states a done-ness; sending a todo home does not. In that second case the
  // checkbox is left out of the write entirely rather than written back to what we believe it
  // currently is — the board we are reading may be one reload behind the note, and a stale belief
  // would tick or untick the wrong way. Read from `toColumnId`, not `claimTo`: dropping a finished
  // todo on its card's Todo column reopens it, even though the claim that lands is "none".
  const done =
    toColumnId === null ? undefined : toColumnId === findDoneColumn(board.config.columns);
  if (claim === claimTo && (done === undefined || item.done === done)) {
    return null; // the line already says this
  }
  const setSubtaskStatus =
    done === undefined ? { index, status: claimTo } : { index, status: claimTo, done };
  const label = item.text || "todo";
  return {
    path: parentPath,
    setSubtaskStatus,
    history: `Moved subtask "${label}" from ${columnTitle(board.config, from ?? "\u2014")} to ${columnTitle(board.config, target ?? "\u2014")}`,
  };
}

/**
 * The follow-up write that keeps a placed todo's claim in step with its checkbox, or `null` when
 * there is nothing to keep in step.
 *
 * Ticking a line's box says the work is finished, and finished work belongs in the done column — so
 * a line that claims a column has its claim moved there rather than left saying something the board
 * no longer renders. Unticking one that claims done drops the claim instead of inventing a column
 * nobody chose: the todo goes back to living with its card, which is where it started.
 *
 * A line claiming nothing is left entirely alone. Ticking a plain todo has never placed it
 * anywhere, and it must not start now — and neither does a board with no done column at all, where
 * "finished work belongs in the done column" names nowhere and the claim is left exactly as it is.
 *
 * `line` is the checklist line as the caller showed it: its index, and for a subcard line the
 * `[[link]]` it carried — see the card branch below for why the index alone is not enough there.
 */
export function syncSubtaskClaim(
  board: Board,
  parentPath: string,
  line: { index: number; link?: string },
  done: boolean,
): CardMutation | null {
  const { index, link } = line;
  const parent = board.cards[parentPath];
  const item = parent?.subItems?.find((s) => s.index === index);
  if (!item) return null;
  const doneCol = findDoneColumn(board.config.columns);
  if (done && doneCol === null) return null; // nowhere to move the claim to; leave the line's own
  if (item.kind === "card") {
    // The same rule, for a line that names a file: its claim is the child note's own `status`.
    // Ticking sends a child that stands somewhere to Done; unticking one in Done drops its
    // `status` so it rejoins its card; a child claiming nothing is left where it is.
    // This branch writes into ANOTHER note, so a position alone is not enough to name it: the
    // caller says which `[[link]]` it showed the person, and a line that no longer carries that
    // link (the note was edited under the open panel) gets no write rather than a wrong one.
    if (link === undefined || item.link !== link) return null;
    const child = boardLinkResolver(board)(link);
    const status = child === null ? undefined : board.cards[child]?.frontmatter.status;
    if (child === null || status === undefined) return null;
    const moving = done ? status !== doneCol && doneCol !== null : status === doneCol;
    if (!moving) return null;
    // The clicked note's own box was just written by the caller; any other card listing the
    // same child follows along, as it would had the child's tile been dragged.
    // The child's note records it as the move it is, in the words a drag would leave.
    const from = columnTitle(board.config, status);
    const mutation: CardMutation = done
      ? {
          path: child,
          setFrontmatter: { status: doneCol ?? "" },
          history: `Moved from ${from} to ${columnTitle(board.config, doneCol ?? "")}`,
        }
      : {
          path: child,
          unsetFrontmatter: ["status"],
          history: `Moved from ${from} to ${columnTitle(board.config, columnOf(board, parentPath) ?? "\u2014")}`,
        };
    const parentLines = parentLinesOf(board, child, done, parentPath);
    if (parentLines.length > 0) mutation.parentLines = parentLines;
    return mutation;
  }
  if (item.status === undefined) return null; // claims nothing — nothing to keep in step
  const next = done ? doneCol : item.status === doneCol ? null : item.status;
  if (next === item.status) return null;
  return { path: parentPath, setSubtaskStatus: { index, status: next } };
}

/**
 * The checklist lines, in every card on the board, that name `childPath` and do not already say
 * `done` — what a subcard reaching or leaving the done column must tick or untick so its parent
 * tells the same story an inline todo would. Every card that links the child is included, not
 * only the one `parentOf` picked: the child's progress is a fact about the child, and each of
 * those cards counts the line in its own progress bar. `except` skips a note already written by
 * the caller.
 */
function parentLinesOf(
  board: Board,
  childPath: string,
  done: boolean,
  except?: string,
): NonNullable<CardMutation["parentLines"]> {
  const resolve = boardLinkResolver(board);
  const out: NonNullable<CardMutation["parentLines"]> = [];
  for (const c of Object.values(board.cards)) {
    if (c.todoRef || c.path === childPath || c.path === except) continue;
    const links = (c.subItems ?? [])
      .filter(
        (s): s is typeof s & { link: string } =>
          s.kind === "card" &&
          s.link !== undefined &&
          s.done !== done &&
          resolve(s.link) === childPath,
      )
      .map((s) => s.link);
    if (links.length > 0) out.push({ path: c.path, links, done });
  }
  return out;
}

/**
 * The write that keeps the `- [ ] [[Child]]` lines naming `childPath` in step with the column it
 * is being sent to: landing in the done column ticks them, any other column unticks them — the
 * rule {@link moveSubtask} applies to an inline todo's own checkbox. `null` when nothing needs to
 * change, or when the board has no done column and so no column means "finished".
 */
export function syncSubcardLines(
  board: Board,
  childPath: string,
  toColumnId: string,
): CardMutation | null {
  const doneCol = findDoneColumn(board.config.columns);
  if (doneCol === null) return null;
  const parentLines = parentLinesOf(board, childPath, toColumnId === doneCol);
  return parentLines.length === 0 ? null : { path: childPath, parentLines };
}

/**
 * The history-free mutation that reassigns `path` to `toColumnId` — what a column being deleted
 * needs for the cards it leaves behind. Routed through here rather than a direct frontmatter write
 * so an inline todo stranded in that column is rehomed on its own line instead of being handed a
 * synthetic path no file answers to.
 */
export function reassignColumn(
  board: Board,
  path: string,
  toColumnId: string,
): CardMutation | null {
  const card = board.cards[path];
  if (!card) return null;
  const todoRef = card.todoRef;
  if (!todoRef) return { path, setFrontmatter: { status: toColumnId } };
  // The checkbox is left out: a column going away rehomes what it held, it does not decide that the
  // work in it is finished or unfinished. Stating one here would reopen a ticked line every time
  // someone deleted the done column, in their own note, with nothing to undo it.
  return {
    path: todoRef.parentPath,
    setSubtaskStatus: { index: todoRef.index, status: toColumnId },
  };
}

/** Column id that currently contains `path`, or null. */
export function columnOf(board: Board, path: string): string | null {
  for (const col of board.config.columns) {
    if (board.columns[col.id]?.includes(path)) return col.id;
  }
  return null;
}

/**
 * Translate a dnd-kit drop (active card id, the id it was dropped over) into a target
 * column + insertion index among that column's cards with the active card removed.
 * `overId` may be a column id (dropped on the column body) or a card path (dropped on a card,
 * inserting before it). Pure and testable.
 */
export function resolveDrop(
  board: Board,
  activeId: string,
  overId: string,
): { columnId: string; index: number } | null {
  if (!board.cards[activeId]) return null;
  if (board.columns[overId]) {
    const list = board.columns[overId].filter((p) => p !== activeId);
    return { columnId: overId, index: list.length };
  }
  const columnId = columnOf(board, overId);
  if (!columnId) return null;
  const list = (board.columns[columnId] ?? []).filter((p) => p !== activeId);
  const idx = list.indexOf(overId);
  return { columnId, index: idx === -1 ? list.length : idx };
}

/**
 * Move/reorder a card to `toColumnId` at `dropIndex`. Returns the single mutation to apply
 * (status + fractional order + a history line). Pure: does not mutate the board.
 */
export function moveCard(
  board: Board,
  cardPath: string,
  toColumnId: string,
  dropIndex: number,
): CardMutation | null {
  const card = board.cards[cardPath];
  if (!card) return null;
  const fromStatus = String(card.frontmatter.status ?? "");
  const todoRef = card.todoRef;
  if (todoRef) return moveSubtask(board, todoRef.parentPath, todoRef.index, toColumnId);
  const colCards = (board.columns[toColumnId] ?? [])
    .filter((p) => p !== cardPath)
    .flatMap((p) => {
      const c = board.cards[p];
      return c !== undefined ? [c] : [];
    });
  const order = computeDropOrder(colCards, dropIndex);
  const mutation: CardMutation = {
    path: cardPath,
    setFrontmatter: { status: toColumnId, order },
    history: `Moved from ${columnTitle(board.config, fromStatus || "—")} to ${columnTitle(board.config, toColumnId)}`,
  };
  // The history line records what the note said: a `status` naming no column of this board is a
  // real change when it is overwritten, even though the tile did not visibly move.
  if (fromStatus === toColumnId) {
    mutation.history = `Reordered within ${columnTitle(board.config, toColumnId)}`;
  }
  // The checkbox follows what the tile did: a card with no `status`, or one naming a column since
  // removed, renders in the first column, and a drop there says nothing about finishing — unless
  // that column is Done, where landing is the statement whatever the tile did before.
  const doneCol = findDoneColumn(board.config.columns);
  if (toColumnId !== doneCol && columnOf(board, cardPath) === toColumnId) return mutation;
  const parentLines = syncSubcardLines(board, cardPath, toColumnId)?.parentLines;
  if (parentLines) mutation.parentLines = parentLines;
  return mutation;
}
