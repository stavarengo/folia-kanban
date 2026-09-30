import type {
  Board,
  Card,
  RelationCount,
  RelationDirection,
  RelationLink,
  RelationType,
  RelationTypeDef,
} from "./types";
import type { SourcedLinkResolver } from "./linkResolver";
import { BLOCKS, readInverse, readRelations } from "./relationships";

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
export function buildRelations(
  cards: Card[],
  resolve: SourcedLinkResolver,
  types: readonly RelationTypeDef[],
): void {
  const graph: EdgeGraph = { outgoing: {}, incoming: {}, seen: new Map() };
  for (const type of types) {
    // Two passes, the declaring key first, so an edge stated at BOTH ends always keeps the
    // declaration the plugin itself writes. Reading them card by card would hand that to whichever
    // note the vault happened to list first, and with it whether the panel offers a remove button.
    for (const c of cards) {
      for (const target of readRelations(c.frontmatter, type.key)) {
        addEdge(graph, {
          type: type.key,
          from: { path: c.path, target: c.basename },
          to: { path: resolve(target, c.path), target },
          declaredBy: "from",
        });
      }
    }
    for (const c of cards) {
      for (const target of readInverse(c.frontmatter, type)) {
        addEdge(graph, {
          type: type.key,
          from: { path: resolve(target, c.path), target },
          to: { path: c.path, target: c.basename },
          declaredBy: "to",
        });
      }
    }
  }

  for (const c of cards) {
    c.relations = [...(graph.outgoing[c.path] ?? []), ...(graph.incoming[c.path] ?? [])];
  }
}

/** One end of an edge: the card it resolved to, if any, and the target as the note wrote it. */
interface EdgeEnd {
  path: string | null;
  target: string;
}

/** One statement of an edge, by the note at its `declaredBy` end. */
interface Edge {
  type: RelationType;
  from: EdgeEnd;
  to: EdgeEnd;
  declaredBy: "from" | "to";
}

interface EdgeRecord {
  declarer: string | null;
  out?: RelationLink;
  in?: RelationLink;
}

interface EdgeGraph {
  outgoing: Record<string, RelationLink[]>;
  incoming: Record<string, RelationLink[]>;
  /**
   * Every edge already registered, so a second statement of the same one is folded into it rather
   * than added twice — and so the fact that it WAS stated twice is not lost, which is what decides
   * whether one note can end the relationship on its own.
   */
  seen: Map<string, EdgeRecord>;
}

/**
 * One end of an edge, for that key: its card path, or the raw target when nothing resolved (so
 * two notes pointing at the same missing card still count as one edge).
 */
function endKey(end: EdgeEnd): string {
  return end.path ?? "?" + end.target;
}

function addEdge(graph: EdgeGraph, edge: Edge): void {
  const { type, from, to, declaredBy } = edge;
  if (from.path !== null && from.path === to.path) return; // no card relates to itself
  const key = type + ":" + endKey(from) + ">" + endKey(to);
  const declarer = declaredBy === "from" ? from.path : to.path;
  const existing = graph.seen.get(key);
  if (existing)
    restate(existing, declarer, declaredBy, declaredBy === "from" ? to.target : from.target);
  else graph.seen.set(key, registerEdge(graph, edge, declarer));
}

/** Fold a second statement of a registered edge into it; `extra` is how this one spells the far end. */
function restate(
  existing: EdgeRecord,
  declarer: string | null,
  declaredBy: "from" | "to",
  extra: string,
): void {
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
  if (link && !link.targets.includes(extra)) link.targets.push(extra);
}

function registerEdge(graph: EdgeGraph, edge: Edge, declarer: string | null): EdgeRecord {
  const { type, from, to, declaredBy } = edge;
  const record: EdgeRecord = { declarer };
  if (from.path !== null) {
    record.out = {
      type,
      direction: "out",
      target: to.target,
      targets: [to.target],
      path: to.path,
      source: declaredBy === "from" ? "own" : "inverse",
    };
    (graph.outgoing[from.path] ??= []).push(record.out);
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
    (graph.incoming[to.path] ??= []).push(record.in);
  }
  return record;
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
