// Pure helpers that turn a card's data into the little chips shown on its board card.
// Backward-compatible across vaults: priority may be a letter scale (A/B/C/D) or a word
// scale (urgent/high/medium/low) — both map to the same four severity tones.
import type { Card, ColumnGroup, ColumnSort } from "../model/types";
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

export function priorityTone(value: string): ChipTone {
  return PRIORITY_TONE[value.trim().toLowerCase()] ?? "muted";
}

const PRIORITY_WORD_SCALE = ["urgent", "high", "medium", "low"];
const PRIORITY_LETTER_SCALE = ["A", "B", "C", "D"];

/** Priority options that always include the card's current value (keeps arbitrary scales working). */
export function priorityOptions(current: string): string[] {
  const base = PRIORITY_LETTER_SCALE.includes(current)
    ? PRIORITY_LETTER_SCALE
    : PRIORITY_WORD_SCALE;
  return current && !base.includes(current) ? [current, ...base] : base;
}

/** Whole-day difference (target − today), both as YYYY-MM-DD. */
function dayDelta(target: string, today: string): number | null {
  const t = Date.parse(target + "T00:00:00");
  const n = Date.parse(today + "T00:00:00");
  if (Number.isNaN(t) || Number.isNaN(n)) return null;
  return Math.round((t - n) / 86_400_000);
}

type DueUrgency = "overdue" | "today" | "soon" | "future" | "done";

export interface DueInfo {
  label: string;
  urgency: DueUrgency;
}

/** Human, scannable due label + urgency. Quick-scan friendly: "Today", "Tomorrow", "in 3d", "2d ago". */
export function dueInfo(due: string, today: string, done: boolean): DueInfo {
  const delta = dayDelta(due, today);
  if (delta === null) return { label: due, urgency: done ? "done" : "future" };
  if (done) return { label: due, urgency: "done" };
  if (delta < 0) {
    const d = -delta;
    return { label: d === 1 ? "Yesterday" : `${d}d ago`, urgency: "overdue" };
  }
  if (delta === 0) return { label: "Today", urgency: "today" };
  if (delta === 1) return { label: "Tomorrow", urgency: "soon" };
  if (delta <= 3) return { label: `in ${delta}d`, urgency: "soon" };
  if (delta <= 7) return { label: `in ${delta}d`, urgency: "future" };
  return { label: due.slice(5), urgency: "future" }; // MM-DD for far-out dates
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

function tagValues(card: Card): string[] {
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

type DueFilter = "" | "overdue" | "soon";

export interface BoardFilters {
  text: string;
  due: DueFilter;
}

// ---------------------------------------------------------------------------
// Filter grammar — a reusable string-query language shared by the search toolbar
// (#9) and area-scoped / auto-populated columns (#1).
//
// A query is a space-separated list of terms. A term is either a `key:value` token
// (area:, status:, priority:, tag:, due:, context:) or free text. Free text is matched
// case-insensitively against a card's basename + priority + tags (a Card has no body
// text at board level, so "free text" means title/priority/tags). Use "double quotes"
// to allow spaces in a value or a free-text phrase. All terms AND together; an empty
// query matches every card. The grammar never throws — unknown keys fall back to free text.
// ---------------------------------------------------------------------------

/** Token keys the grammar understands. Free text is held separately. */
export type FilterKey = "area" | "status" | "priority" | "tag" | "due" | "context";

const FILTER_KEYS: readonly FilterKey[] = ["area", "status", "priority", "tag", "due", "context"];

/** Recognized `due:` values. A bare YYYY-MM-DD date is also accepted (exact match). */
interface FilterToken {
  key: FilterKey;
  /** Lower-cased value as written after the colon. */
  value: string;
}

export interface Filter {
  /** Free-text terms (lower-cased); each must be found in the haystack. */
  text: string[];
  /** `key:value` tokens, ANDed together. */
  tokens: FilterToken[];
}

/** Extra context the matcher needs that isn't on the card (for `due:` urgency). */
export interface MatchContext {
  /** Today as YYYY-MM-DD. */
  today: string;
  /** Resolved id of the board's "done" column, or null. */
  doneColumnId: string | null;
}

export const EMPTY_FILTER: Filter = { text: [], tokens: [] };

function isFilterKey(s: string): s is FilterKey {
  return (FILTER_KEYS as readonly string[]).includes(s);
}

/**
 * Split a query into terms, honoring "double quotes" so a value (or a free-text phrase) can
 * contain spaces. A quoted run may carry a `key:` prefix glued to it (`area:"garden prep"`),
 * which is kept attached so the whole thing parses as one `key:value` token. Quotes are stripped
 * from the value; the optional key prefix is preserved.
 */
function tokenizeQuery(query: string): string[] {
  const out: string[] = [];
  // Either: an optional non-space prefix immediately before a "quoted run"; or an unquoted run.
  const re = /(\S*?)"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    if (m[2] !== undefined)
      out.push((m[1] ?? "") + m[2]); // prefix (maybe "key:") + unquoted value
    else if (m[3] !== undefined) out.push(m[3]);
  }
  return out;
}

/** Parse a query string into a structured Filter. Never throws. */
export function parseFilter(query: string): Filter {
  const text: string[] = [];
  const tokens: FilterToken[] = [];
  for (const term of tokenizeQuery(query)) {
    const colon = term.indexOf(":");
    if (colon > 0) {
      const rawKey = term.slice(0, colon).toLowerCase();
      const value = term
        .slice(colon + 1)
        .trim()
        .toLowerCase();
      if (isFilterKey(rawKey) && value !== "") {
        tokens.push({ key: rawKey, value });
        continue;
      }
    }
    const t = term.trim().toLowerCase();
    if (t !== "") text.push(t);
  }
  return { text, tokens };
}

/** True when the filter has no terms (matches everything). */
export function isEmptyFilter(f: Filter): boolean {
  return f.text.length === 0 && f.tokens.length === 0;
}

/** Lower-cased free-text haystack: basename + priority + tags (area + tags). */
function freeTextHaystack(card: Card): string {
  return [card.basename, String(card.frontmatter.priority ?? ""), ...tagValues(card)]
    .join(" ")
    .toLowerCase();
}

/** All lower-cased entries of a frontmatter value that may be a string or string[]. */
function listValues(value: unknown): string[] {
  if (typeof value === "string") return value ? [value.toLowerCase()] : [];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
  return [];
}

/**
 * `due:` matching. Delegates to `dueInfo` so urgency buckets stay identical to the chip and
 * the legacy filter (done cards are never "overdue"). `soon` is cumulative (soon-or-sooner);
 * `today`/`overdue` are exact; `none` = no due date; an explicit YYYY-MM-DD matches that date.
 */
function matchDue(card: Card, value: string, ctx: MatchContext): boolean {
  const due = card.frontmatter.due;
  const has = typeof due === "string" && due !== "";
  if (value === "none") return !has;
  if (!has) return false;
  const u = dueInfo(due, ctx.today, card.frontmatter.status === ctx.doneColumnId).urgency;
  switch (value) {
    case "overdue":
      return u === "overdue";
    case "today":
      return u === "today";
    case "soon":
      return u === "overdue" || u === "today" || u === "soon";
    default:
      return due.toLowerCase() === value;
  }
}

function matchToken(card: Card, token: FilterToken, ctx: MatchContext): boolean {
  const fm = card.frontmatter;
  switch (token.key) {
    case "area":
      return String(fm.area ?? "").toLowerCase() === token.value;
    case "status":
      return String(fm.status ?? "").toLowerCase() === token.value;
    case "priority":
      return String(fm.priority ?? "").toLowerCase() === token.value;
    case "tag":
      return tagValues(card).some((t) => t.toLowerCase() === token.value);
    case "context":
      // #14: a card's context is the folder-derived `card.context` (path-based, the primary
      // source) OR any entry of its `context` frontmatter (string | string[]). Matching both keeps
      // §1/§9/§14 on one notion of context so the filter token stays truthful for folder contexts.
      return (
        (typeof card.context === "string" && card.context.toLowerCase() === token.value) ||
        listValues(fm["context"]).includes(token.value)
      );
    case "due":
      return matchDue(card, token.value, ctx);
  }
}

/** Pure predicate: does a card satisfy every term of the parsed filter? */
export function matchCard(card: Card, filter: Filter, ctx: MatchContext): boolean {
  if (filter.text.length) {
    const hay = freeTextHaystack(card);
    for (const t of filter.text) if (!hay.includes(t)) return false;
  }
  for (const token of filter.tokens) if (!matchToken(card, token, ctx)) return false;
  return true;
}

/** Convenience: parse + match in one call (e.g. a one-off area-scoped column rule). */
export function matchQuery(card: Card, query: string, ctx: MatchContext): boolean {
  return matchCard(card, parseFilter(query), ctx);
}

/** True when the query already carries the exact `key:value` token (case-insensitive). */
export function hasToken(query: string, key: FilterKey, value: string): boolean {
  const want = value.toLowerCase();
  return parseFilter(query).tokens.some((t) => t.key === key && t.value === want);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Toggle a simple (space-free) `key:value` token in a raw query string, treating the search input
 * as the single source of truth (#9). Used by the preset chips so they hold no state of their own —
 * clicking a chip just edits the one query string. When the token is already present it is removed
 * (every OTHER term is left byte-for-byte intact, including quoted phrases — only the toggled token
 * and its surrounding whitespace are touched); when absent it is appended.
 *
 * Only call this with values that contain no spaces (the chips use `due:overdue` / `due:soon`).
 */
export function toggleToken(query: string, key: FilterKey, value: string): string {
  const want = value.toLowerCase();
  // Match the whole-word token (case-insensitive key & value) with any flanking whitespace, so
  // removing it doesn't leave a double space. \S-anchored so we never clip inside another term.
  const re = new RegExp(`(^|\\s)${escapeRegExp(key)}:${escapeRegExp(want)}(?=\\s|$)`, "i");
  if (hasToken(query, key, value)) {
    return query
      .replace(re, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  const base = query.trim();
  return base ? `${base} ${key}:${want}` : `${key}:${want}`;
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

function priorityRank(card: Card): number {
  const p = card.frontmatter.priority;
  return typeof p === "string" && p ? PRIORITY_RANK[priorityTone(p)] : PRIORITY_RANK.muted;
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

function sortCards(
  cards: Card[],
  sort: ColumnSort,
  today: string,
  doneColumnId: string | null,
): Card[] {
  if (sort === "manual") return cards;
  const ranked = cards.map((card, i) => ({ card, i }));
  ranked.sort((a, b) => {
    // priority: low rank first (prio-1 strongest). due: high rank first (overdue most pressing).
    const d =
      sort === "priority"
        ? priorityRank(a.card) - priorityRank(b.card)
        : dueRank(b.card, today, doneColumnId) - dueRank(a.card, today, doneColumnId);
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
  group: ColumnGroup,
  sort: ColumnSort,
  today: string,
  doneColumnId: string | null,
): CardGroup[] {
  if (group !== "due") {
    return [{ key: "", label: "", cards: sortCards(cards, sort, today, doneColumnId) }];
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
        cards: sortCards(inBucket, sort, today, doneColumnId),
      });
    }
  }
  return out;
}

export function cardChips(card: Card, today: string, doneColumnId: string | null): CardChip[] {
  const fm = card.frontmatter;
  const chips: CardChip[] = [];

  if (typeof fm.priority === "string" && fm.priority) {
    chips.push({
      key: "prio",
      label: fm.priority,
      tone: priorityTone(fm.priority),
      title: "Priority",
    });
  }
  for (const [i, tag] of tagValues(card).entries()) {
    chips.push({ key: "tag-" + i, label: tag, tone: "muted", title: "Tag" });
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
