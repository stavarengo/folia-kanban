// Who a card is assigned to, read off its frontmatter. Pure card data with no notion of a board
// or a view, so the filter grammar, the detail panel and the context menu all read one answer.
import type { Card } from "./types";

/**
 * The people a card is assigned to, as its note spells them.
 *
 * Read tolerantly, written narrowly. The panel and the context menu write ONE name as a plain
 * string, which is the shape the whole feature is designed around; but the key is hand-editable
 * frontmatter, and a YAML list is what somebody writing two names by hand will naturally produce.
 * A list read as a single mangled string would be a card that quietly stops matching its own
 * `assignee:` filter, so both shapes are read the same way `context` already is.
 *
 * Values keep the case the note wrote them in — this is what a chip shows and what a picker
 * offers — and comparison is left to {@link sameAssignee}.
 */
export function assigneeValues(card: Card): string[] {
  const raw = card.frontmatter["assignee"];
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (name) out.push(name);
  }
  return out;
}

/**
 * Two spellings of the same person: case and surrounding space are noise, and a leading `@` is
 * how half the world writes a name. Anything past that — "Alex" and "Alex Smith" — is two
 * different names, because the plugin holds no roster that could say otherwise.
 */
export function sameAssignee(a: string, b: string): boolean {
  const key = (s: string) => s.trim().replace(/^@+/, "").toLowerCase();
  const left = key(a);
  return left !== "" && left === key(b);
}

/**
 * The card's assignees with `me` added or taken away — whichever the one-click control means for a
 * card that already names them. The result is the frontmatter value to write: `null` to remove the
 * key, a plain string for a single name, a list for several.
 *
 * The list cases exist because a hand-written `assignee: [alex, ana]` is a card two people are on,
 * and the one gesture the board offers about a card is "am I on it". Answering that by replacing
 * both names with mine would delete a fact somebody wrote down, and answering it by refusing would
 * leave the one card that most needs the button without it. So the button adds only me and removes
 * only me; the panel's field remains where a name other than yours is written.
 */
export function toggleAssignee(names: readonly string[], me: string): string | string[] | null {
  const rest = names.filter((name) => !sameAssignee(name, me));
  const next = rest.length === names.length ? [...names, me.trim()] : rest;
  if (next.length === 0) return null;
  // A card that already named more than one person keeps its list even when leaving it empties down
  // to one name. Collapsing that to a scalar would rewrite the shape somebody else authored, which
  // is the one thing these two buttons promise not to do; a first assignment, where there was no
  // list to preserve, is written as the plain string the field would have written.
  return next.length === 1 && names.length <= 1 ? (next[0] as string) : next;
}

/**
 * The names a board's cards are actually assigned to, deduplicated case-insensitively (first
 * spelling wins) and sorted alphabetically — what an assignee picker offers.
 *
 * Read off the cards and nowhere else. A board note listing its people would be new board
 * vocabulary, and who a vault's people are is exactly the question left open elsewhere; a name
 * that appears the moment someone is assigned needs no such answer, and disappears again when the
 * last card carrying it does.
 */
export function boardAssignees(cards: readonly Card[]): string[] {
  const seen = new Map<string, string>();
  for (const card of cards) {
    for (const name of assigneeValues(card)) {
      const key = name.replace(/^@+/, "").toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  // Sorted by the same key the deduplication used, so `@alex` sits under "a" beside a plain `alex`
  // rather than ahead of every name because of a character the plugin has already agreed to ignore.
  return [...seen.entries()]
    .sort(
      ([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b),
    )
    .map(([, name]) => name);
}
