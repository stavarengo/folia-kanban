// Typed, non-hierarchical links between two cards, as the frontmatter holds them. Pure: this
// module reads and rewrites the stored shape only; resolving a target to a card on the board
// happens in `buildBoard`, the one place that already knows how a `[[wikilink]]` binds.
//
// Only ONE type exists today — `blocks` — but it is addressed by type everywhere, so a second one
// is additive rather than a reshape of what this version writes into people's notes.

import type { RelationType } from "./types";

/** The frontmatter key each relationship type writes its outgoing links to. */
const RELATION_KEY: Record<RelationType, string> = { blocks: "blocks" };

/**
 * The frontmatter key read as an EXPLICIT inverse of `blocks`: `blocked-by: ["[[A]]"]` on card C
 * states the same edge as `blocks: ["[[C]]"]` on card A, and the board treats them as one.
 *
 * It is read, never written. The plugin only ever writes the blocker's own `blocks` list, so the
 * two ends cannot drift apart through the UI — but people (and other tools) already write
 * `blocked-by` by hand, and ignoring a key that plainly states a blocking relationship would be
 * worse than reading it. A hand-written `blocked-by: []` stays exactly as written: it parses to
 * zero links, and nothing normalizes it away.
 */
const BLOCKED_BY_KEY = "blocked-by";

/** Every frontmatter key this module owns, so generic property editing stays out of them. */
export const RELATION_KEYS: readonly string[] = [...Object.values(RELATION_KEY), BLOCKED_BY_KEY];

/** The frontmatter key a relationship type is stored under. */
export function relationKey(type: RelationType): string {
  return RELATION_KEY[type];
}

const WIKILINK_RE = /^\[\[([^\]]+)\]\]$/;

/**
 * The link target inside a stored value: `[[Other card]]` → `Other card`. A value written WITHOUT
 * brackets is taken at face value, so a hand-edited `blocks: [Other card]` still points somewhere
 * instead of quietly resolving to nothing.
 */
export function relationTarget(value: string): string {
  const trimmed = value.trim();
  const m = WIKILINK_RE.exec(trimmed);
  return (m?.[1] ?? trimmed).trim();
}

/** How a target is written back. Always a wikilink, so Obsidian's own link tooling sees it. */
export function relationLinkText(target: string): string {
  return `[[${target}]]`;
}

/**
 * The targets stored under one key, de-duplicated, in the order the note lists them. Tolerates
 * the single-scalar form (`blocks: "[[A]]"`) as well as the list form the plugin writes.
 */
function readTargets(fm: Record<string, unknown>, key: string): string[] {
  const value = fm[key];
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const target = relationTarget(entry);
    if (target && !out.includes(target)) out.push(target);
  }
  return out;
}

/** The outgoing targets of `type` a card declares itself. */
export function readRelations(fm: Record<string, unknown>, type: RelationType): string[] {
  return readTargets(fm, relationKey(type));
}

/** The `blocked-by` targets a card declares itself, read as inverse `blocks`; see the key's docs. */
export function readBlockedBy(fm: Record<string, unknown>): string[] {
  return readTargets(fm, BLOCKED_BY_KEY);
}

/**
 * The stored list after adding `target`, or `null` when it is already there — so a caller can skip
 * the write rather than churn the note. Rewrites the whole list as wikilinks, which is also how a
 * hand-written bare target gets normalized: only ever as a side effect of an edit to that list.
 */
export function withRelation(
  fm: Record<string, unknown>,
  type: RelationType,
  target: string,
): string[] | null {
  const current = readRelations(fm, type);
  const next = relationTarget(target);
  if (!next || current.includes(next)) return null;
  return [...current, next].map(relationLinkText);
}

/**
 * The stored list after removing `target`, or `null` when the target was not there. An empty
 * result comes back as an empty array; the caller drops the key rather than leave a `blocks: []`.
 */
export function withoutRelation(
  fm: Record<string, unknown>,
  type: RelationType,
  target: string,
): string[] | null {
  const current = readRelations(fm, type);
  const gone = relationTarget(target);
  if (!current.includes(gone)) return null;
  return current.filter((t) => t !== gone).map(relationLinkText);
}
