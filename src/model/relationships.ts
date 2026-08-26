// Typed, non-hierarchical links between two cards, as the frontmatter holds them, and the
// vocabulary of types a board understands. Pure: this module reads and rewrites the stored shape
// only; resolving a target to a card on the board happens in `buildBoard`, the one place that
// already knows how a `[[wikilink]]` binds.

import { RelationTypeEntrySchema } from "./schemas";
import type { RelationType, RelationTypeDef } from "./types";

/**
 * The one type every board has, listed or not: notes written before the vocabulary existed carry
 * `blocks` / `blocked-by`, and they keep working unchanged. It is also the only type the board
 * gives a meaning beyond "linked": a blocking link is held up while both ends are unfinished, which
 * is what the tile markers and the `is:blocked` filter read.
 */
export const BLOCKS: RelationTypeDef = {
  key: "blocks",
  inverse: "blocked-by",
  label: "Blocks",
  inverseLabel: "Blocked by",
};

/**
 * Card frontmatter keys the plugin already reads or writes with a meaning of their own, so a type
 * cannot take them over. Any other key is the user's to declare — and declaring one does turn
 * whatever that key already holds into links, which the README says in as many words.
 */
const RESERVED_KEYS = new Set([
  "status",
  "order",
  "priority",
  "area",
  "due",
  "tags",
  "title",
  "context",
  "type",
  "created",
]);

/** How a frontmatter key reads as a heading: `a-result-of` → `A result of`. */
export function relationLabel(key: string): string {
  const words = key.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function cleanKey(raw: string | undefined): string | null {
  const key = raw?.trim() ?? "";
  // A key with no letters in it has no heading to show, so it is not usable either.
  return key && !RESERVED_KEYS.has(key.toLowerCase()) && relationLabel(key) !== "" ? key : null;
}

/**
 * One `relations` entry as `{ key, inverse }`, or `null` when it is not usable as a type. An
 * inverse that is named but unusable (reserved, or the key itself) fails the whole entry rather
 * than quietly becoming "no inverse": the note said two keys, and reading it as one would show
 * the other end under a heading the author never chose.
 */
function parseEntry(entry: unknown): { key: string; inverse: string | null } | null {
  const parsed = RelationTypeEntrySchema.safeParse(entry);
  if (!parsed.success) return null;
  const def = typeof parsed.data === "string" ? { key: parsed.data } : parsed.data;
  const key = cleanKey(def.key);
  if (key === null) return null;
  const named = def.inverse?.trim() ?? "";
  if (!named) return { key, inverse: null };
  const inverse = cleanKey(named);
  return inverse === null || inverse === key ? null : { key, inverse };
}

/**
 * Read the board note's `relations` property into the vocabulary, `blocks` always first.
 *
 * Like `normalizePriorities`, this never throws: a malformed entry is a config concern, not
 * corruption worth refusing the board over, so it is dropped and the rest still load. An entry is
 * a string (the key alone) or `{ key, inverse }`. A key or inverse that repeats one already taken —
 * including the built-in pair — is dropped too, since one frontmatter key can only mean one thing.
 */
export function normalizeRelationTypes(raw: unknown): RelationTypeDef[] {
  const out: RelationTypeDef[] = [BLOCKS];
  // Compared case-insensitively: `Blocks` next to `blocks` would be two sections with one heading.
  const taken = new Set(relationKeys(out).map((k) => k.toLowerCase()));
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    const def = parseEntry(entry);
    if (def === null || taken.has(def.key.toLowerCase())) continue;
    if (def.inverse !== null && taken.has(def.inverse.toLowerCase())) continue;
    for (const k of relationKeys([{ ...def, label: "", inverseLabel: "" }]))
      taken.add(k.toLowerCase());
    out.push({
      ...def,
      label: relationLabel(def.key),
      // With no inverse key named, the other end has no words of its own; say what it is.
      inverseLabel:
        def.inverse === null ? `${relationLabel(def.key)} (reverse)` : relationLabel(def.inverse),
    });
  }
  return out;
}

/** Every frontmatter key the vocabulary owns, so generic property editing stays out of them. */
export function relationKeys(types: readonly RelationTypeDef[]): string[] {
  return types.flatMap((t) => (t.inverse === null ? [t.key] : [t.key, t.inverse]));
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

/**
 * The part of a target that decides WHICH card it names: the alias and the heading anchor dropped,
 * since `buildBoard` resolves `[[A|see this]]`, `[[A#Notes]]` and `[[A]]` to the same card. Two
 * stored entries that share an identity are one relationship, so the list must not hold both — the
 * board would collapse them into a single row that one click could not clear. Case is kept, matching
 * how the board itself binds a link.
 */
function targetIdentity(value: string): string {
  return (relationTarget(value).split("#")[0]?.split("|")[0] ?? "").trim();
}

/**
 * How a target is written back. Always exactly one pair of brackets, so a target that ARRIVES
 * bracketed (someone typing `[[Other card]]` into the field, rather than picking a suggestion)
 * cannot come out as `[[[[Other card]]]]`.
 */
export function relationLinkText(target: string): string {
  return `[[${relationTarget(target)}]]`;
}

/**
 * Does `target` name the card that declares it? A card cannot relate to itself — the board drops
 * such a link rather than show one card as both ends — so writing one would leave data in the note
 * that nothing on the board can show or undo. Both ends refuse it instead.
 *
 * A bare name matching this card's file name counts even when another folder holds a same-named
 * card: the board refuses to bind an ambiguous name at all, so that link would be dead anyway.
 */
export function isSelfRelation(path: string, basename: string, target: string): boolean {
  const raw = targetIdentity(target);
  if (!raw) return true;
  const withMd = /\.md$/i.test(raw) ? raw : raw + ".md";
  // A target carrying a folder names one exact note, so only that note counts — `[[Sub/A]]` from
  // `A.md` is a link to a DIFFERENT card that happens to share a file name, not a self-link.
  if (raw.includes("/")) return withMd === path;
  return raw.replace(/\.md$/i, "") === basename;
}

/**
 * The targets stored under one key, de-duplicated, in the order the note lists them.
 *
 * Deliberately forgiving about the shape, because the point of reading these keys is that people
 * write them by hand. The single-scalar form (`blocks: "[[A]]"`) works. So does the unquoted list
 * item someone typing into a note produces: YAML reads `- [[A]]` as a nested sequence rather than
 * a string, so nesting is flattened instead of dropped — the plugin writes the quoted form, but it
 * must not silently ignore the one a person is most likely to type.
 */
function collectStrings(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
    return;
  }
  if (typeof value === "string") out.push(value);
}

function readTargets(fm: Record<string, unknown>, key: string): string[] {
  const raw: string[] = [];
  collectStrings(fm[key], raw);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const target = relationTarget(entry);
    // De-duplicated by what the target NAMES, not by how it is written, so a note holding both
    // `[[A]]` and `[[A|see this]]` is one relationship everywhere: one row, and one click that
    // clears every stored form of it. The first form written is the one shown.
    const identity = targetIdentity(entry);
    if (!target || !identity || seen.has(identity)) continue;
    seen.add(identity);
    out.push(target);
  }
  return out;
}

/** The outgoing targets of `type` a card declares itself. */
export function readRelations(fm: Record<string, unknown>, type: RelationType): string[] {
  return readTargets(fm, type);
}

/**
 * The targets a card declares under a type's inverse key, read as that type stated from the other
 * end: `blocked-by: ["[[A]]"]` on card C is the same edge as `blocks: ["[[C]]"]` on card A, and
 * the board treats them as one.
 *
 * Read, never written. The plugin only ever writes the declaring end, so the two ends cannot drift
 * apart through the UI — but people (and other tools) already write `blocked-by` by hand, and
 * ignoring a key that plainly states a relationship would be worse than reading it. A hand-written
 * `blocked-by: []` stays exactly as written: it parses to zero links, and nothing normalizes it
 * away. Empty for a type with no inverse key.
 */
export function readInverse(fm: Record<string, unknown>, type: RelationTypeDef): string[] {
  return type.inverse === null ? [] : readTargets(fm, type.inverse);
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
  if (!next || current.some((t) => targetIdentity(t) === targetIdentity(next))) return null;
  return [...current, next].map(relationLinkText);
}

/**
 * The stored list after removing every one of `targets`, or `null` when none of them was there.
 *
 * A set, not one string, because the board shows ONE row for a link its note spells more than one
 * way, and clearing that row has to clear every spelling — in a single rewrite, so a failure
 * cannot leave half a relationship behind. An empty result comes back as an empty array; the
 * caller drops the key rather than leave a `blocks: []`.
 */
export function withoutRelation(
  fm: Record<string, unknown>,
  type: RelationType,
  targets: readonly string[],
): string[] | null {
  const gone = new Set(targets.map(targetIdentity).filter((t) => t !== ""));
  if (gone.size === 0) return null;
  const current = readRelations(fm, type);
  if (!current.some((t) => gone.has(targetIdentity(t)))) return null;
  return current.filter((t) => !gone.has(targetIdentity(t))).map(relationLinkText);
}
