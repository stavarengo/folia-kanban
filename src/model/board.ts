// Pure board graph. No Obsidian dependency.
//
// Parentage has a single source of truth: a card is a subcard of P iff P's `## Subtasks`
// checklist links to it (`- [ ] [[Child]]`). We invert those links to derive parent-of and
// the top-level set. No `parent` frontmatter, so re-parenting is one write and can't desync.

import type { Board, BoardConfig, Card, ContextConfig, SubItem } from "./types";
import { dateOnly } from "./dates";
import type { MatchContext } from "./filter";
import { columnEffectiveOrders } from "./cardOrder";
import { deriveContext } from "./cardFolder";
import { findDoneColumn } from "./boardColumns";
import { linkResolver, type SourcedLinkResolver } from "./linkResolver";
import { buildRelations, relationCounts } from "./relationGraph";
import { makeTodoPath } from "./todoPath";

export { columnOf, findDoneColumn } from "./boardColumns";
export { makeTodoPath, parseTodoPath } from "./todoPath";
export { deriveContext, resolveCardFolder } from "./cardFolder";
export { boardLinkResolver, type LinkResolver, type SourcedLinkResolver } from "./linkResolver";
export { columnEffectiveOrders, computeDropOrder } from "./cardOrder";
export { relationCounts } from "./relationGraph";
export {
  filterVisiblePaths,
  nestedCards,
  subtreePaths,
  type FilterVisibility,
} from "./boardVisibility";
export {
  applyReloc,
  isComputedOrder,
  makeCardDragId,
  moveColumn,
  planDrop,
  resolveDragReloc,
  resolveDrop,
  splitCardDragId,
  type DragReloc,
} from "./dragDrop";
export {
  claimInStep,
  isTodoLine,
  moveCard,
  moveSubtask,
  reassignColumn,
  sameLine,
  subtaskRef,
  syncSubcardLines,
  syncSubtaskClaim,
  todoTile,
  type CardMutation,
} from "./cardMoves";

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

export function buildBoard(
  config: BoardConfig,
  cards: Card[],
  contexts: Record<string, ContextConfig> = {},
  hostResolve?: SourcedLinkResolver,
): Board {
  // Derive each card's context from its path (#14): one place, so every card on the board carries
  // the same notion of context the `context:` filter token reads. Path-derived, never written.
  for (const c of cards) {
    const ctx = deriveContext(config.cardFolder, c.path);
    if (ctx !== undefined) c.context = ctx;
  }

  const resolve = linkResolver(cards, hostResolve);
  const cardsByPath: Record<string, Card> = {};
  for (const c of cards) cardsByPath[c.path] = c;

  buildRelations(cards, resolve, config.relations);

  const parentOf = parentsOf(cards, resolve);
  const colIds = new Set(config.columns.map((c) => c.id));
  const groups: Record<string, Card[]> = {};
  for (const col of config.columns) groups[col.id] = [];
  const build: BoardBuild = {
    cardsByPath,
    parentOf,
    placedOf: {},
    placedTodos: new Map(),
    groups,
    colIds,
    doneCol: findDoneColumn(config.columns),
    resolve,
    effectiveColumnOf: effectiveColumns(config, colIds, cardsByPath, parentOf),
  };

  const placedChildren = placeCards(build, cards);
  placeTodos(build, cards);
  countPlacedTodos(build);

  const columns: Record<string, string[]> = {};
  for (const col of config.columns) {
    columns[col.id] = columnEffectiveOrders(groups[col.id] ?? []).map((x) => x.card.path);
  }

  return {
    config,
    columns,
    cards: cardsByPath,
    parentOf,
    placedOf: build.placedOf,
    childrenOf: nestedChildren(cards, parentOf, placedChildren),
    contexts,
    // The board keeps the reading that decided its own nesting, so nothing looking at it later
    // (the detail panel, a checklist tick, an MCP tool) can bind the same link to another card.
    resolveLink: resolve,
  };
}

/** What `buildBoard` fills in as it places cards, shared by each of its passes. */
interface BoardBuild {
  cardsByPath: Record<string, Card>;
  parentOf: Record<string, string>;
  /**
   * Every subitem standing in a column of its own, mapped to the card it belongs to. This is what
   * the render layer reads for the `↳ parent` reference — NOT `parentOf`, which also links the
   * members of a subcard cycle to each other and would give a top-level card a parent it does not
   * visibly have.
   */
  placedOf: Record<string, string>;
  /** Per card, what its checklist lines placed elsewhere mean for the card's own progress. */
  placedTodos: Map<string, PlacedTodos>;
  groups: Record<string, Card[]>;
  colIds: ReadonlySet<string>;
  doneCol: string | null;
  resolve: SourcedLinkResolver;
  effectiveColumnOf: (path: string) => string | undefined;
}

/** Each card's parent: the first card whose checklist links it, a card never its own. */
function parentsOf(cards: Card[], resolve: SourcedLinkResolver): Record<string, string> {
  const parentOf: Record<string, string> = {};
  for (const c of cards) {
    for (const link of c.childLinks) {
      const childPath = resolve(link, c.path);
      if (childPath && childPath !== c.path && !parentOf[childPath]) {
        parentOf[childPath] = c.path;
      }
    }
  }
  return parentOf;
}

/**
 * The column a card actually renders in. A top-level card reads its own `status` and falls back
 * to the first column, as it always has. A nested subcard reads its own `status` too — that is
 * what lets it sit in a column of its own — and only falls back to its parent's column when it
 * has none, which is why a board nobody has moved a subitem on looks exactly as it did.
 * Memoized, and the walk terminates because `isGenuinelyNested` already rejected every cycle.
 */
function effectiveColumns(
  config: BoardConfig,
  colIds: ReadonlySet<string>,
  cardsByPath: Record<string, Card>,
  parentOf: Record<string, string>,
): (path: string) => string | undefined {
  const firstCol = config.columns[0]?.id;
  const effective = new Map<string, string | undefined>();
  const effectiveColumnOf = (path: string): string | undefined => {
    const hit = effective.get(path);
    if (hit !== undefined || effective.has(path)) return hit;
    effective.set(path, firstCol); // cycle guard; overwritten below
    const st = String(cardsByPath[path]?.frontmatter.status ?? "");
    const own = colIds.has(st) ? st : undefined;
    const parent = parentOf[path];
    const value =
      own ?? (parent && isGenuinelyNested(path, parentOf) ? effectiveColumnOf(parent) : firstCol);
    effective.set(path, value);
    return value;
  };
  return effectiveColumnOf;
}

function place(build: BoardBuild, card: Card, target: string | undefined): void {
  if (!target) return;
  const bucket = build.groups[target];
  if (bucket) bucket.push(card);
}

/**
 * Put every top-level card in its column, and every subcard whose own column differs from its
 * parent's in that column too. Returns the subcards placed that way.
 */
function placeCards(build: BoardBuild, cards: Card[]): Set<string> {
  const placedChildren = new Set<string>();
  for (const c of cards) {
    const nested = isGenuinelyNested(c.path, build.parentOf);
    if (!nested) {
      place(build, c, build.effectiveColumnOf(c.path));
      continue;
    }
    const parent = build.parentOf[c.path];
    const own = build.effectiveColumnOf(c.path);
    if (parent !== undefined && own !== undefined && own !== build.effectiveColumnOf(parent)) {
      placedChildren.add(c.path);
      build.placedOf[c.path] = parent;
      place(build, c, own);
    }
  }
  return placedChildren;
}

interface PlacedTodos {
  indices: Set<number>;
  doneByColumn: number;
}

function placedFor(build: BoardBuild, path: string): PlacedTodos {
  let placed = build.placedTodos.get(path);
  if (!placed) build.placedTodos.set(path, (placed = { indices: new Set(), doneByColumn: 0 }));
  return placed;
}

/**
 * Inline todos that claim a column of their own become synthetic cards, so every per-column rule
 * the board already has — order, sort, group, filter, WIP count, drag — applies to them without
 * a second implementation. A line with no `[status:: …]` field claims nothing and keeps rendering
 * inside its parent card, exactly as before; a checked line is done wherever its field points.
 */
function placeTodos(build: BoardBuild, cards: Card[]): void {
  for (const c of cards) {
    const parentColumn = build.effectiveColumnOf(c.path);
    for (const item of c.subItems ?? []) {
      if (item.kind === "card") {
        if (childFinishedByColumn(build, c, item)) placedFor(build, c.path).doneByColumn++;
        continue;
      }
      placeTodo(build, c, item, parentColumn);
    }
  }
}

/**
 * The same one meaning of done, for a line that names a file: the child's own `status` says where
 * it stands, and standing in the done column is finished whether or not the parent's box was ever
 * ticked. Every write the board makes ticks that box (`moveCard`), but a `status` edited by hand in
 * the child note reaches the parent only here — so the progress bar tells the truth either way,
 * and the note catches up on the next move.
 */
function childFinishedByColumn(build: BoardBuild, c: Card, item: SubItem): boolean {
  const child = item.link === undefined ? null : build.resolve(item.link, c.path);
  const finished =
    child !== null &&
    child !== c.path &&
    build.cardsByPath[child]?.frontmatter.status === build.doneCol;
  return !item.done && build.doneCol !== null && finished;
}

function placeTodo(
  build: BoardBuild,
  c: Card,
  item: SubItem,
  parentColumn: string | undefined,
): void {
  const { doneCol } = build;
  const claimed =
    item.status !== undefined && build.colIds.has(item.status) ? item.status : undefined;
  if (claimed === undefined) return;
  // Done has one meaning, reached two ways: the line is checked, or its field names the done
  // column. Either says the work is finished, so both put it there and both count as finished
  // on the parent's progress bar — a line hand-written as `- [ ] X [status:: done]` cannot end
  // up sitting in Done while the card it belongs to still calls it outstanding.
  const finished = item.done || claimed === doneCol;
  const target = finished && doneCol ? doneCol : claimed;
  // The card's own reading of the line comes first, and holds whether or not a tile is minted:
  // a line claiming the done column is finished even when its card is ALREADY in that column
  // and there is nothing to move it to, which is exactly where the tile is skipped below.
  const placed = placedFor(build, c.path);
  if (finished && !item.done) {
    placed.indices.add(item.index); // finished work is not an outstanding next action
    placed.doneByColumn++;
  }
  if (target === parentColumn) return; // back home: renders inside its parent again
  const todoCard = todoCardOf(c, item, target);
  build.cardsByPath[todoCard.path] = todoCard;
  build.parentOf[todoCard.path] = c.path;
  build.placedOf[todoCard.path] = c.path;
  placed.indices.add(item.index);
  place(build, todoCard, target);
}

function todoCardOf(c: Card, item: SubItem, target: string): Card {
  const todoCard: Card = {
    path: makeTodoPath(c.path, item.index),
    basename: c.basename,
    title: item.text,
    titleSource: "subtask",
    frontmatter: { status: target },
    childLinks: [],
    todoRef: { parentPath: c.path, line: { ...item, kind: "todo" } },
  };
  if (c.context !== undefined) todoCard.context = c.context;
  return todoCard;
}

/**
 * A todo showing as its own tile must not ALSO show in its parent's "next todos" list. Its
 * checklist line still counts towards the parent's progress: the work is still the card's — and
 * one sitting in the done column counts as finished there even if nobody ticked its box.
 */
function countPlacedTodos(build: BoardBuild): void {
  for (const [path, placed] of build.placedTodos) {
    const card = build.cardsByPath[path];
    const stats = card?.stats;
    if (!card || !stats) continue;
    card.stats = {
      ...stats,
      checklistDone: stats.checklistDone + placed.doneByColumn,
      nextTodos: stats.nextTodos.filter((t) => !placed.indices.has(t.index)),
    };
  }
}

/**
 * Inverse of parentOf, but ONLY for genuinely-nested children that are not placed in a column of
 * their own — and so a card in an A<->B cycle (which parentOf links both ways) is excluded here.
 * That keeps childrenOf a forest: cycle members surface only as top-level cards, never doubly as
 * a nested child of each other.
 */
function nestedChildren(
  cards: Card[],
  parentOf: Record<string, string>,
  placedChildren: ReadonlySet<string>,
): Record<string, string[]> {
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
  return childrenOf;
}

/**
 * Everything a filter can be judged by without a reader in front of it: today, the board's done
 * column, and its blocking counts. What it leaves out is what only the board view knows — which
 * comments <User-Name> has seen (`unread:`) and who "me" is (`assignee:me`) — so a rule naming
 * either reads as `unknown` rather than as a "no" (see `judgeCard`).
 *
 * This is the context anything reading through the port uses, the MCP server being the one that
 * matters, so that a lane resolves there the same way it does on screen.
 */
export function boardMatchContext(board: Board, today = dateOnly()): MatchContext {
  const doneColumnId = findDoneColumn(board.config.columns);
  return { today, doneColumnId, relations: relationCounts(board, doneColumnId) };
}
