import type { Card } from "./types";

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
