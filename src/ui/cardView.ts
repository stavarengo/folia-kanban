// Pure helpers that turn a card's data into the little chips shown on its board card.
// Backward-compatible across vaults: priority may be a letter scale (A/B/C/D), a word
// scale (urgent/high/medium/low) — both map to the same four severity tones — or a board's own
// words, ranked across those same tones by the order its note lists them.
import { assigneeValues } from "../model/assignees";
import { dueInfo, type DueUrgency } from "../model/dates";
import { matchCard, type Filter } from "../model/filter";
import { dedupePriorities, priorityIndex } from "../model/priorities";
import { BLOCKS } from "../model/relationships";
import { frontmatterTagValues, tagValues } from "../model/tags";
import type { Card, ColumnGroup, ColumnSort, RelationCount } from "../model/types";
import type { IconName } from "./icons";

export type ChipTone =
  | "prio-1"
  | "prio-2"
  | "prio-3"
  | "prio-4"
  | "danger"
  | "warn"
  | "accent"
  | "muted";

export interface CardChip {
  key: string;
  label: string;
  tone: ChipTone;
  icon?: IconName;
  title?: string;
}

const PRIORITY_TONE: Record<string, ChipTone> = {
  // letter scale
  a: "prio-1",
  b: "prio-2",
  c: "prio-3",
  d: "prio-4",
  // word scale
  urgent: "prio-1",
  highest: "prio-1",
  high: "prio-1",
  p0: "prio-1",
  p1: "prio-1",
  medium: "prio-2",
  med: "prio-2",
  normal: "prio-2",
  p2: "prio-2",
  low: "prio-3",
  p3: "prio-3",
  lowest: "prio-4",
  trivial: "prio-4",
  p4: "prio-4",
};

/** The severity ramp, strongest first — the tones a scale is spread across. */
const PRIORITY_RAMP: readonly ChipTone[] = ["prio-1", "prio-2", "prio-3", "prio-4"];

/**
 * Spread the position `index` of a scale of `length` values over the four `prio-*` tones. The ends
 * are pinned — first value strongest, last weakest — and the rest are spread evenly between them,
 * with a tie broken toward the stronger tone so a three-word scale comes out hot, warm, calm
 * rather than skipping the warm step. With fewer than two values there is no ranking to express,
 * and so no ramp.
 *
 * Two consequences worth knowing. A scale longer than four has neighbours sharing a tone — four
 * steps is what the palette holds, and the sort still separates them. And the tone of a value
 * depends on how long the list is, so adding a word re-spreads the ramp: the board repaints at the
 * moment the user changes their own scale, which is the moment they are looking at it.
 */
function rampTone(index: number, length: number): ChipTone | null {
  if (index < 0 || length < 2) return null;
  const exact = (index * (PRIORITY_RAMP.length - 1)) / (length - 1);
  return PRIORITY_RAMP[Math.ceil(exact - 0.5)] ?? null;
}

/**
 * The severity tone a priority value is drawn in.
 *
 * `scale` is the board note's own `priorities` list and nothing else — the ranking the user wrote
 * down. A word that only appears on a card stays `muted` until the board remembers it, because
 * the position it would occupy in the derived vocabulary is alphabetical, not chosen: colouring by
 * that would invent a ranking nobody authored and repaint every board written before the note
 * learned to hold a list.
 *
 * The fixed scales win over the list: `a`–`d`, the word scale and `p0`–`p4` keep the tone they
 * have always had, wherever a board happens to list them, so no existing board repaints. That also
 * means a scale mixing invented words with known ones takes its colours from both, which is the
 * price of never surprising a board that was reading correctly yesterday.
 */
export function priorityTone(value: string, scale: readonly string[] = []): ChipTone {
  const known = PRIORITY_TONE[value.trim().toLowerCase()];
  if (known) return known;
  return rampTone(priorityIndex(scale, value), scale.length) ?? "muted";
}

/**
 * The priority vocabulary a board actually offers: what its note remembers, followed by whatever
 * its cards use right now and it has not remembered yet.
 *
 * The remembered values come first and keep the board note's order, because that order is the
 * user's to edit and it is what breaks ties when a column sorts by priority. Newly discovered
 * values are appended by severity tone first, then alphabetically within a tone, so a board that
 * has never been through the UI still suggests its own scheme in a defensible order rather than a
 * random one. The tone is coarse — four buckets — so a word scale comes out roughly, not exactly,
 * strongest-first: `urgent` and `high` share the strongest tone and the alphabetical tie-break
 * decides between them. Anything finer is the user's to fix by reordering the board note's list.
 *
 * Comes back EMPTY for a board that has never seen a priority. The empty case is the caller's to
 * interpret: a picker substitutes the todo.txt `A`/`B`/`C` starting set, but nothing remembers it,
 * because suggesting a value and claiming the board uses it are not the same thing.
 */
export function boardPriorities(remembered: readonly string[], cards: Card[]): string[] {
  const inUse: string[] = [];
  for (const card of cards) {
    const p = card.frontmatter.priority;
    if (typeof p === "string" && p.trim()) inUse.push(p.trim());
  }
  inUse.sort(
    (a, b) =>
      PRIORITY_RANK[priorityTone(a)] - PRIORITY_RANK[priorityTone(b)] ||
      a.localeCompare(b, undefined, { sensitivity: "base" }) ||
      a.localeCompare(b),
  );
  return dedupePriorities([...remembered, ...inUse]);
}

/**
 * The options a priority picker shows: the board's vocabulary, plus the card's current value when
 * that value somehow is not in it (a card being edited while the board reloads), so the control
 * never silently reads as a different priority than the note holds.
 */
export function priorityOptions(vocabulary: readonly string[], current: string): string[] {
  const value = current.trim();
  return value && priorityIndex(vocabulary, value) === -1
    ? [value, ...vocabulary]
    : [...vocabulary];
}

/**
 * #3 card-level urgency cue. Returns the at-a-glance urgency bucket that should tint the WHOLE
 * card, or null when no cue should show. Reuses `dueInfo` so it never diverges from the due chip
 * or the `due:` filter: a done card and a far-future card both yield no cue. The render layer maps
 * `overdue`/`today`/`soon` to a `data-urgency` attribute (styled in src/styles.css); `future`/`done`/
 * no-date all return null so the card stays neutral (invariant 4: default = current behavior).
 */
export function cardUrgency(
  card: Card,
  today: string,
  doneColumnId: string | null,
): "overdue" | "today" | "soon" | null {
  const due = card.frontmatter.due;
  if (typeof due !== "string" || due === "") return null;
  const u = dueInfo(due, today, card.frontmatter.status === doneColumnId).urgency;
  return u === "overdue" || u === "today" || u === "soon" ? u : null;
}

type DueFilter = "" | "overdue" | "soon";

export interface BoardFilters {
  text: string;
  due: DueFilter;
}

/**
 * Pure predicate: does a card pass the legacy search text + due filter?
 * Preserved as a thin superset over `matchCard`. The legacy `text` is treated as ONE free-text
 * term (it is NOT re-parsed through `parseFilter`, so a colon in the search box keeps matching
 * literally instead of becoming a token). The `due` field maps to a `due:` token.
 */
export function cardMatches(
  card: Card,
  today: string,
  f: BoardFilters,
  doneColumnId: string | null,
): boolean {
  const q = f.text.trim().toLowerCase();
  const filter: Filter = {
    text: q ? [q] : [],
    tokens: f.due ? [{ key: "due", value: f.due }] : [],
  };
  return matchCard(card, filter, { today, doneColumnId });
}

// ---------------------------------------------------------------------------
// In-column grouping + sorting (#6). Pure, render-time transform over the cards a
// column already holds (in board order). It lives here, not in `src/model/`, because
// grouping reuses `dueInfo` and priority sorting reuses `priorityTone` — both UI-resident.
// Defaults (`group: "none"`, `sort: "manual"`) reproduce today's flat, board-ordered list
// 1:1, so an un-grouped/un-sorted column renders byte-identical to before.
// ---------------------------------------------------------------------------

/** One rendered group of cards: a heading key + label, plus the ordered cards in it. */
export interface CardGroup {
  /** Stable key for React + tests, e.g. a due-bucket id or "" for the single no-grouping group. */
  key: string;
  /** Human heading shown above the group (empty when ungrouped → no heading rendered). */
  label: string;
  cards: Card[];
}

// Higher number = higher urgency, so a descending sort floats the most pressing card up.
const DUE_BUCKET_RANK: Record<DueUrgency, number> = {
  overdue: 4,
  today: 3,
  soon: 2,
  future: 1,
  done: 0,
};
// Lower number = higher priority (prio-1 is the strongest tone). "muted"/unknown sinks last.
const PRIORITY_RANK: Record<ChipTone, number> = {
  "prio-1": 0,
  "prio-2": 1,
  "prio-3": 2,
  "prio-4": 3,
  danger: 4,
  warn: 4,
  accent: 4,
  muted: 5,
};

/** Urgency bucket of a card's due date (or "none" when it has no due date). */
function dueBucket(card: Card, today: string, doneColumnId: string | null): DueUrgency | "none" {
  const due = card.frontmatter.due;
  if (typeof due !== "string" || due === "") return "none";
  return dueInfo(due, today, card.frontmatter.status === doneColumnId).urgency;
}

const DUE_GROUP_ORDER: (DueUrgency | "none")[] = [
  "overdue",
  "today",
  "soon",
  "future",
  "none",
  "done",
];
const DUE_GROUP_LABEL: Record<DueUrgency | "none", string> = {
  overdue: "Overdue",
  today: "Today",
  soon: "Soon",
  future: "Later",
  none: "No due date",
  done: "Done",
};

/**
 * Sort key for `sort: priority`, most pressing first. Two levels:
 *
 * 1. The severity tone — the same one the badge is drawn in, so a card never sorts against what its
 *    colour says. Known values keep the tone they always had, and a hand-added `urgent` still
 *    outranks a `C` even on a board whose vocabulary lists `C`; a value only the board knows takes
 *    its tone from where the vocabulary puts it.
 * 2. The value's position in the board's own vocabulary, which breaks ties within a tone — an
 *    order the user can rearrange by editing the board note's `priorities` list.
 *
 * A value the vocabulary does not hold sorts after the ones it does, within its own tone; a card
 * with no priority sorts after both, so having a priority — even a weak, unrecognised one — ranks
 * a card above having none. (Before the vocabulary existed those two tied and fell back to board
 * order, which read as arbitrary.)
 */
function priorityKey(
  card: Card,
  vocabulary: readonly string[],
  scale: readonly string[],
): { tone: number; index: number } {
  const p = card.frontmatter.priority;
  const value = typeof p === "string" ? p.trim() : "";
  if (!value) return { tone: PRIORITY_RANK.muted, index: vocabulary.length };
  const index = priorityIndex(vocabulary, value);
  return {
    tone: PRIORITY_RANK[priorityTone(value, scale)],
    index: index === -1 ? vocabulary.length : index,
  };
}

/**
 * Stable comparator for a `sort` mode. Returns 0 for `manual` (callers must keep the input order,
 * which is the board's fractional order). `priority`/`due` sort by urgency then fall back to the
 * incoming index so equal-key cards keep their board order (a stable sort).
 */
function dueRank(card: Card, today: string, doneColumnId: string | null): number {
  const b = dueBucket(card, today, doneColumnId);
  return DUE_BUCKET_RANK[b === "none" ? "future" : b];
}

interface SortContext {
  sort: ColumnSort;
  today: string;
  doneColumnId: string | null;
  priorities: readonly string[];
  scale: readonly string[];
}

function sortCards(cards: Card[], ctx: SortContext): Card[] {
  const { sort, today, doneColumnId, priorities, scale } = ctx;
  if (sort === "manual") return cards;
  const ranked = cards.map((card, i) => ({ card, i }));
  ranked.sort((a, b) => {
    // priority: low rank first (prio-1 strongest). due: high rank first (overdue most pressing).
    let d: number;
    if (sort === "priority") {
      const ka = priorityKey(a.card, priorities, scale);
      const kb = priorityKey(b.card, priorities, scale);
      d = ka.tone - kb.tone || ka.index - kb.index;
    } else {
      d = dueRank(b.card, today, doneColumnId) - dueRank(a.card, today, doneColumnId);
    }
    return d !== 0 ? d : a.i - b.i; // stable: equal keys keep their incoming (board) order
  });
  return ranked.map((r) => r.card);
}

/**
 * Group + sort a column's cards for rendering (#6). `cards` arrives in board order.
 * - `group: "none"` → a single group (key/label "") so the column body renders a flat list.
 * - `group: "due"`  → buckets by due urgency (Overdue/Today/Soon/Later/No due date/Done), each in a
 *   fixed, scannable order; empty buckets are omitted.
 * Within every group, `sort` orders the cards (`manual` keeps board order; stable for ties).
 */
export function groupAndSortCards(
  cards: Card[],
  opts: {
    group: ColumnGroup;
    sort: ColumnSort;
    today: string;
    doneColumnId: string | null;
    /** The board's priority vocabulary; only breaks ties under `sort: "priority"`. */
    priorities?: readonly string[];
    scale?: readonly string[];
  },
): CardGroup[] {
  const { group, sort, today, doneColumnId, priorities = [], scale = [] } = opts;
  const ctx: SortContext = { sort, today, doneColumnId, priorities, scale };
  if (group !== "due") {
    return [{ key: "", label: "", cards: sortCards(cards, ctx) }];
  }
  const buckets = new Map<DueUrgency | "none", Card[]>();
  for (const c of cards) {
    const b = dueBucket(c, today, doneColumnId);
    let bucket = buckets.get(b);
    if (!bucket) {
      bucket = [];
      buckets.set(b, bucket);
    }
    bucket.push(c);
  }
  const out: CardGroup[] = [];
  for (const b of DUE_GROUP_ORDER) {
    const inBucket = buckets.get(b);
    if (inBucket && inBucket.length) {
      out.push({
        key: b,
        label: DUE_GROUP_LABEL[b],
        cards: sortCards(inBucket, ctx),
      });
    }
  }
  return out;
}

const cards = (n: number) => (n === 1 ? "card" : "cards");

/**
 * The relationship markers a card shows, from its ACTIVE link counts (see `relationCounts`).
 *
 * Blocking gets two distinct chips, because its two directions mean opposite things: "Blocked" is
 * a reason this card cannot move yet, "Blocks n" is a reason other cards cannot. Every other type
 * is a plain link, so each direction it has gets a quiet chip carrying the type's own label and
 * a count. Nothing here enforces anything — the board still lets any card go anywhere; these only
 * make the link visible.
 *
 * Separate from {@link cardChips} because the counts come from the board graph rather than the
 * card's own frontmatter, and the two reach the card tile by different routes.
 */
export function relationChips(counts: readonly RelationCount[] | undefined): CardChip[] {
  const chips: CardChip[] = [];
  for (const { type, out, in: incoming } of counts ?? []) {
    if (type.key === BLOCKS.key) {
      if (incoming > 0) {
        chips.push({
          key: "blocked-by",
          label: "Blocked",
          tone: "danger",
          icon: "ban",
          title: `Blocked by ${incoming} unfinished ${cards(incoming)}`,
        });
      }
      if (out > 0) {
        chips.push({
          key: "blocks",
          label: `Blocks ${out}`,
          tone: "accent",
          icon: "octagon-alert",
          title: `Blocking ${out} unfinished ${cards(out)}`,
        });
      }
      continue;
    }
    if (out > 0) {
      chips.push({
        key: `${type.key}-out`,
        label: `${type.label} ${out}`,
        tone: "muted",
        icon: "link",
        title: `${type.label}: ${out} ${cards(out)}`,
      });
    }
    if (incoming > 0) {
      chips.push({
        key: `${type.key}-in`,
        label: `${type.inverseLabel} ${incoming}`,
        tone: "muted",
        icon: "link",
        title: `${type.inverseLabel}: ${incoming} ${cards(incoming)}`,
      });
    }
  }
  return chips;
}

export function cardChips(
  card: Card,
  today: string,
  doneColumnId: string | null,
  scale: readonly string[] = [],
): CardChip[] {
  const fm = card.frontmatter;
  const chips: CardChip[] = [];

  if (typeof fm.priority === "string" && fm.priority) {
    chips.push({
      key: "prio",
      label: fm.priority,
      tone: priorityTone(fm.priority, scale),
      title: "Priority",
    });
  }
  // The body tags come last, and say so: they are the ones the detail panel's `tags` property
  // cannot edit, so a reader wondering where a chip came from is told where to go and change it.
  const fmTagCount = frontmatterTagValues(card).length;
  for (const [i, tag] of tagValues(card).entries()) {
    chips.push({
      key: "tag-" + i,
      label: tag,
      tone: "muted",
      title: i < fmTagCount ? "Tag" : "Tag (written in the note's body)",
    });
  }
  for (const [i, name] of assigneeValues(card).entries()) {
    chips.push({
      key: "assignee-" + i,
      label: name,
      tone: "muted",
      icon: "user",
      // Deliberately the same chip whoever it names: telling "mine" apart at a glance is what the
      // `assignee:me` filter and its "Mine" quick filter are for, and a tile that colours one name
      // differently would need to know who is reading it to draw a single card.
      title: "Assigned to " + name,
    });
  }
  if (typeof fm.due === "string" && fm.due) {
    const done = fm.status === doneColumnId;
    const info = dueInfo(fm.due, today, done);
    const tone: ChipTone =
      info.urgency === "overdue"
        ? "danger"
        : info.urgency === "today" || info.urgency === "soon"
          ? "warn"
          : "muted";
    chips.push({
      key: "due",
      label: info.label,
      tone,
      icon: info.urgency === "overdue" ? "alert" : "calendar",
      title: "Due " + fm.due,
    });
  }

  return chips;
}
