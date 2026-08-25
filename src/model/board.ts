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
  RelationLink,
} from "./types";
import { readBlockedBy, readRelations } from "./relationships";

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

/**
 * Resolve a wikilink target to a card path. Prefers an exact path when the link carries a
 * folder segment; otherwise matches by basename, but only when that basename is unambiguous
 * (duplicate basenames across folders resolve to nothing rather than silently binding the wrong one).
 */
function resolveLink(
  link: string,
  byBasename: Map<string, string[]>,
  byPath: Record<string, Card>,
): string | null {
  const noAnchor = link.split("#");
  const noAlias = (noAnchor[0] ?? link).split("|");
  const raw = (noAlias[0] ?? "").trim();
  if (raw.includes("/")) {
    const withMd = /\.md$/i.test(raw) ? raw : raw + ".md";
    if (byPath[withMd]) return withMd;
  }
  const segments = raw.split("/");
  const last = segments[segments.length - 1];
  const base = (last ?? raw).replace(/\.md$/i, "").trim();
  const paths = byBasename.get(base);
  return paths !== undefined && paths.length === 1 ? (paths[0] ?? null) : null;
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
 * Resolve every `blocks` / `blocked-by` declaration into the two directions each card sees, and
 * hang the result on the cards themselves (the `context` precedent).
 *
 * The two keys describe the SAME kind of edge from opposite ends, so both are read into one graph
 * and an edge declared from both ends is kept once — as `both` rather than as either end's own,
 * because neither note can end it alone. `source` is what tells the detail panel whether the card
 * in front of you may remove the link or only report where it lives. A card cannot block itself:
 * a self-link is dropped rather than shown as both a blocker and a blocked card.
 */
function buildRelations(
  cards: Card[],
  byBasename: Map<string, string[]>,
  cardsByPath: Record<string, Card>,
): void {
  const blocks: Record<string, RelationLink[]> = {};
  const blockedBy: Record<string, RelationLink[]> = {};
  // Every edge already registered, so a second statement of the same one is folded into it rather
  // than added twice — and so the fact that it WAS stated twice is not lost, which is what decides
  // whether one note can end the relationship on its own.
  const seen = new Map<
    string,
    { declarer: string | null; out?: RelationLink; in?: RelationLink }
  >();
  // One end of an edge, for that key: its card path, or the raw target when nothing resolved (so
  // two notes pointing at the same missing card still count as one edge).
  const endKey = (path: string | null, target: string) => path ?? "?" + target;

  const addEdge = (
    blocker: { path: string | null; target: string },
    blocked: { path: string | null; target: string },
    declaredBy: "blocker" | "blocked",
  ) => {
    if (blocker.path !== null && blocker.path === blocked.path) return; // no card blocks itself
    const key = endKey(blocker.path, blocker.target) + ">" + endKey(blocked.path, blocked.target);
    const declarer = declaredBy === "blocker" ? blocker.path : blocked.path;
    const existing = seen.get(key);
    if (existing) {
      // Stated a second time by the OTHER note: both ends declare it, so deleting the blocker's
      // own list would not end it — the inverse would simply be derived again on the next load.
      // Say so on both rows instead of offering a remove button that quietly does nothing.
      if (existing.declarer !== declarer) {
        if (existing.out) existing.out.source = "both";
        if (existing.in) existing.in.source = "both";
        return;
      }
      // Stated twice by the SAME note, spelled differently (`[[B]]` and `[[Tasks/B]]`). One row,
      // but every spelling has to go when it is removed — remember them all on that row.
      const link = declaredBy === "blocker" ? existing.out : existing.in;
      const extra = declaredBy === "blocker" ? blocked.target : blocker.target;
      if (link && !link.targets.includes(extra)) link.targets.push(extra);
      return;
    }
    const record: { declarer: string | null; out?: RelationLink; in?: RelationLink } = { declarer };
    if (blocker.path !== null) {
      record.out = {
        type: "blocks",
        target: blocked.target,
        targets: [blocked.target],
        path: blocked.path,
        source: declaredBy === "blocker" ? "own" : "inverse",
      };
      (blocks[blocker.path] ??= []).push(record.out);
    }
    if (blocked.path !== null) {
      record.in = {
        type: "blocks",
        target: blocker.target,
        targets: [blocker.target],
        path: blocker.path,
        source: declaredBy === "blocked" ? "own" : "inverse",
      };
      (blockedBy[blocked.path] ??= []).push(record.in);
    }
    seen.set(key, record);
  };

  // Two passes, `blocks` first, so an edge stated at BOTH ends always keeps the declaration the
  // plugin itself writes. Reading them card by card would hand that to whichever note the vault
  // happened to list first, and with it whether the panel offers a remove button.
  for (const c of cards) {
    for (const target of readRelations(c.frontmatter, "blocks")) {
      addEdge(
        { path: c.path, target: c.basename },
        { path: resolveLink(target, byBasename, cardsByPath), target },
        "blocker",
      );
    }
  }
  for (const c of cards) {
    for (const target of readBlockedBy(c.frontmatter)) {
      addEdge(
        { path: resolveLink(target, byBasename, cardsByPath), target },
        { path: c.path, target: c.basename },
        "blocked",
      );
    }
  }

  for (const c of cards) {
    c.relations = { blocks: blocks[c.path] ?? [], blockedBy: blockedBy[c.path] ?? [] };
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

  const byBasename = new Map<string, string[]>();
  for (const c of cards) {
    const arr = byBasename.get(c.basename);
    if (arr) arr.push(c.path);
    else byBasename.set(c.basename, [c.path]);
  }

  const cardsByPath: Record<string, Card> = {};
  for (const c of cards) cardsByPath[c.path] = c;

  buildRelations(cards, byBasename, cardsByPath);

  const parentOf: Record<string, string> = {};
  for (const c of cards) {
    for (const link of c.childLinks) {
      const childPath = resolveLink(link, byBasename, cardsByPath);
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

  // Which nested subcards were pulled OUT of their parent's group into a column of their own, so
  // the nested view below skips them (they must render once, not twice).
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
      place(c, own);
    }
  }

  // Inline todos that claim a column of their own become synthetic cards, so every per-column rule
  // the board already has — order, sort, group, filter, WIP count, drag — applies to them without
  // a second implementation. A line with no `[status:: …]` field claims nothing and keeps rendering
  // inside its parent card, exactly as before; a checked line is done wherever its field points.
  const placedTodos = new Map<string, Set<number>>();
  for (const c of cards) {
    const parentColumn = effectiveColumnOf(c.path);
    for (const item of c.subItems ?? []) {
      if (item.kind !== "todo") continue;
      const claimed =
        item.status !== undefined && colIds.has(item.status) ? item.status : undefined;
      if (claimed === undefined) continue;
      const target = item.done && doneCol ? doneCol : claimed;
      if (target === parentColumn) continue; // back home: renders inside its parent again
      const path = makeTodoPath(c.path, item.index);
      const todoCard: Card = {
        path,
        basename: c.basename,
        title: item.text,
        titleSource: "subtask",
        frontmatter: { status: target },
        childLinks: [],
        todoRef: { parentPath: c.path, index: item.index },
      };
      if (c.context !== undefined) todoCard.context = c.context;
      cardsByPath[path] = todoCard;
      parentOf[path] = c.path;
      let indices = placedTodos.get(c.path);
      if (!indices) placedTodos.set(c.path, (indices = new Set()));
      indices.add(item.index);
      place(todoCard, target);
    }
  }

  // A todo showing as its own tile must not ALSO show in its parent's "next todos" list. Its
  // checklist line still counts towards the parent's progress: the work is still the card's.
  for (const [path, indices] of placedTodos) {
    const card = cardsByPath[path];
    const stats = card?.stats;
    if (!card || !stats) continue;
    card.stats = { ...stats, nextTodos: stats.nextTodos.filter((t) => !indices.has(t.index)) };
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

  return { config, columns, cards: cardsByPath, parentOf, childrenOf, contexts };
}

/** How many ACTIVE blocking links a card has in each direction (see {@link relationCounts}). */
export interface RelationCounts {
  /** Cards it is holding up. */
  blocks: number;
  /** Cards holding it up. */
  blockedBy: number;
}

/**
 * The blocking links worth showing a marker for, per card path. Only paths with at least one are
 * present, so a lookup that misses means "nothing to show".
 *
 * A link counts while NEITHER end sits in the board's done column: a card is not held up by
 * something already finished, and a finished card is not holding anything up. Unresolved targets
 * never count — there is no card to be waiting on. This is presentation only; nothing about it
 * restricts what a card may do, which stays true to the board's nudge-never-block posture.
 */
export function relationCounts(
  board: Board,
  doneColumnId: string | null,
): Record<string, RelationCounts> {
  const isDone = (path: string) =>
    doneColumnId !== null && board.cards[path]?.frontmatter.status === doneColumnId;
  const out: Record<string, RelationCounts> = {};
  for (const [path, card] of Object.entries(board.cards)) {
    if (isDone(path)) continue;
    const relations = card.relations;
    if (!relations) continue;
    const live = (links: RelationLink[]) =>
      links.filter((l) => l.path !== null && !isDone(l.path)).length;
    const counts = { blocks: live(relations.blocks), blockedBy: live(relations.blockedBy) };
    if (counts.blocks > 0 || counts.blockedBy > 0) out[path] = counts;
  }
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
   * the line's `[status:: …]` field (`null` clears it) and its checkbox. Mutually exclusive with
   * `setFrontmatter` — a checklist line has no frontmatter of its own.
   */
  setSubtaskStatus?: { index: number; status: string | null; done: boolean };
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
 * The checkbox moves with it: landing in the done column checks the line, leaving it unchecks it.
 * That keeps the two ways a todo can say "finished" from disagreeing, since a checked line reads as
 * done wherever its field points. Coming home leaves the checkbox alone — it says nothing about
 * which column the line claims, because it no longer claims one.
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
  if (from === target) return null; // already where it is being sent
  const setSubtaskStatus =
    toColumnId === null
      ? { index, status: null, done: item.done }
      : { index, status: toColumnId, done: toColumnId === findDoneColumn(board.config.columns) };
  const label = item.text || "todo";
  return {
    path: parentPath,
    setSubtaskStatus,
    history: `Moved subtask "${label}" from ${columnTitle(board.config, from ?? "\u2014")} to ${columnTitle(board.config, target ?? "\u2014")}`,
  };
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
  const done = toColumnId === findDoneColumn(board.config.columns);
  return {
    path: todoRef.parentPath,
    setSubtaskStatus: { index: todoRef.index, status: toColumnId, done },
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
  const history =
    fromStatus === toColumnId
      ? `Reordered within ${columnTitle(board.config, toColumnId)}`
      : `Moved from ${columnTitle(board.config, fromStatus || "—")} to ${columnTitle(board.config, toColumnId)}`;
  return { path: cardPath, setFrontmatter: { status: toColumnId, order }, history };
}
