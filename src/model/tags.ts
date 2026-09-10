// Every tag the board credits a card with. Pure card data: the filter grammar and the chips on a
// tile read the same list, in the same order.
import type { Card } from "./types";

/** The card's own `area` and `tags` properties, in that order. */
export function frontmatterTagValues(card: Card): string[] {
  const fm = card.frontmatter;
  const out: string[] = [];
  if (typeof fm.area === "string" && fm.area) out.push(fm.area);
  const fmTags = fm["tags"];
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) if (typeof t === "string" && t) out.push(t);
  } else if (typeof fmTags === "string" && fmTags) {
    out.push(fmTags);
  }
  return out;
}

/**
 * The tags Obsidian read out of the note's text that the frontmatter does not already list,
 * compared case-insensitively the way Obsidian compares tag names. Frontmatter values are never
 * deduped against each other: a card with no body tags reads exactly as it did before.
 */
function bodyOnlyTagValues(card: Card): string[] {
  const body = card.bodyTags ?? [];
  if (body.length === 0) return [];
  const seen = new Set(frontmatterTagValues(card).map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const t of body) {
    const key = t.toLowerCase();
    if (t === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Every tag the board credits a card with: its `area`, its frontmatter `tags`, then the tags
 * Obsidian read out of the note's body (`Card.bodyTags`, filled by the adapter — this file cannot
 * import `obsidian`). Obsidian counts a `#tag` written in the text as a tag of the note, so a card
 * tagged that ordinary way has to answer the board's `tag:` filter too.
 */
export function tagValues(card: Card): string[] {
  return [...frontmatterTagValues(card), ...bodyOnlyTagValues(card)];
}
