// The board's priority vocabulary: the values a board is known to use, remembered in its own note.
// Pure, no Obsidian dependency, mirroring `columns.ts` — the adapter hands the raw frontmatter
// value to `normalizePriorities` and writes `serializePriorities` back.
//
// The plugin treats priorities case-insensitively everywhere already (`priorityTone` lowercases,
// and the `priority:` search token matches case-insensitively), so the vocabulary does too: `a`
// and `A` are one value, and the first spelling encountered is the one kept.

/** The todo.txt-style starting vocabulary offered to a board that knows no priorities yet. */
export const DEFAULT_PRIORITIES = ["A", "B", "C"];

/** Drop blanks and case-insensitive repeats, keeping the first spelling and the incoming order. */
export function dedupePriorities(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Whether two priority values name the same priority (the case-insensitive comparison used everywhere). */
export function samePriority(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Position of `value` in `vocabulary`, case-insensitively; `-1` when it is not there. */
export function priorityIndex(vocabulary: readonly string[], value: string): number {
  return vocabulary.findIndex((v) => samePriority(v, value));
}

/**
 * Fold `values` into the vocabulary `current` already holds, keeping its order and appending only
 * what is genuinely new. `null` when there is nothing to add, so a caller can skip the write.
 *
 * Merging rather than replacing is what makes remembering safe against two edits in flight at
 * once: each write only ever ADDS to whatever the note holds at that moment, so neither can drop
 * a value the other just learned.
 */
export function mergePriorities(
  current: readonly string[],
  values: readonly string[],
): string[] | null {
  const merged = dedupePriorities([...current, ...values]);
  return merged.length === current.length ? null : merged;
}

/**
 * Read the board note's `priorities` value into the vocabulary.
 *
 * Like `normalizeColumns`, this never throws: a hand-edited board can hold anything, and a
 * malformed vocabulary is a display/config concern, not corruption worth refusing the board over.
 * Anything that is not a list of usable strings degrades to "no vocabulary remembered", which is
 * exactly the pre-feature state.
 */
export function normalizePriorities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return dedupePriorities(raw.filter((v): v is string => typeof v === "string"));
}

/**
 * The plain value written back to board-note frontmatter. `null` means "write nothing": a board
 * that has learned nothing must not gain a `priorities:` key it never had, keeping an untouched
 * board note byte-identical to how it was before this feature existed.
 */
export function serializePriorities(priorities: readonly string[]): string[] | null {
  const out = dedupePriorities(priorities);
  return out.length ? out : null;
}
