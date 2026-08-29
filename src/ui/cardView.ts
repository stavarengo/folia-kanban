// Pure helpers that turn a card's data into the little chips shown on its board card.
// Backward-compatible across vaults: priority may be a letter scale (A/B/C/D), a word
// scale (urgent/high/medium/low) — both map to the same four severity tones — or a board's own
// words, ranked across those same tones by the order its note lists them.
import type { RelationCount } from "../model/board";
import { dedupePriorities, priorityIndex } from "../model/priorities";
import { BLOCKS } from "../model/relationships";
import type { Card, ColumnGroup, ColumnSort } from "../model/types";
import type { UnreadState } from "../model/unread";
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
  return next.length === 1 ? (next[0] as string) : next;
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
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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
// (area:, status:, priority:, tag:, due:, context:, is:, unread:) or free text. Free text is matched
// case-insensitively against a card's title + basename + priority + tags (a Card has no body
// text at board level, so "free text" means title/priority/tags). Use "double quotes"
// to allow spaces in a value or a free-text phrase. All terms AND together; an empty
// query matches every card. The grammar never throws — unknown keys fall back to free text.
// ---------------------------------------------------------------------------

/** Token keys the grammar understands. Free text is held separately. */
export type FilterKey =
  | "area"
  | "status"
  | "priority"
  | "tag"
  | "due"
  | "context"
  | "assignee"
  | "is"
  | "unread";

const FILTER_KEYS: readonly FilterKey[] = [
  "area",
  "status",
  "priority",
  "tag",
  "due",
  "context",
  "assignee",
  "is",
  "unread",
];

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

/**
 * Extra context the matcher needs that isn't on the card. `today` and `doneColumnId` serve `due:`;
 * the two optional parts serve the tokens that read state beyond the card's own note, and a
 * caller that has neither in hand (a one-off rule, a legacy filter) simply leaves them out — the
 * tokens then read as "no card is blocked, nothing is unread".
 */
export interface MatchContext {
  /** Today as YYYY-MM-DD. */
  today: string;
  /** Resolved id of the board's "done" column, or null. */
  doneColumnId: string | null;
  /** Active relationship counts per card path (`relationCounts`), for `is:blocked` / `is:blocking`. */
  relations?: Record<string, RelationCount[]>;
  /** The reader's unread verdict on a card, for `unread:`. Reader-specific: see `unread.ts`. */
  unread?: (card: Card) => UnreadState;
  /**
   * Who "me" is, for `assignee:me` — the **Your name** setting and nothing else. The plugin never
   * guesses it (inferring it is its own open question), so a caller that has no name in hand leaves
   * this out and `assignee:me` then matches no card, which is the truthful answer to "which are
   * mine" from a plugin that has not been told who you are.
   */
  me?: string;
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

/** Lower-cased free-text haystack: title + basename + priority + tags (area + tags). */
function freeTextHaystack(card: Card): string {
  return [
    card.title,
    card.basename,
    String(card.frontmatter.priority ?? ""),
    ...tagValues(card),
    // A person's name searched as plain text finds their cards, without anyone having to know the
    // `assignee:` token exists. The token is still what says "only theirs": free text matches a
    // name anywhere on the card, a title included.
    ...assigneeValues(card),
  ]
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

/**
 * `is:` matching, on the same active blocking counts the tile markers show — so `is:blocked` lists
 * exactly the cards wearing the *Blocked* marker, done ends excluded. `unblocked` is the question
 * the marker makes people ask ("what can I work on?"), and the grammar has no negation to ask it
 * with otherwise. An unknown value matches nothing rather than everything.
 */
function matchIs(card: Card, value: string, ctx: MatchContext): boolean {
  const blocking = ctx.relations?.[card.path]?.find((c) => c.type.key === BLOCKS.key);
  switch (value) {
    case "blocked":
      return (blocking?.in ?? 0) > 0;
    case "unblocked":
      return (blocking?.in ?? 0) === 0;
    case "blocking":
      return (blocking?.out ?? 0) > 0;
    default:
      return false;
  }
}

/**
 * `unread:` matching, on the same verdict the tile badge shows. `comments` = anything unread on
 * the card, `replies` = only the louder "someone answered you" state, `none` = nothing unread.
 */
function matchUnread(card: Card, value: string, ctx: MatchContext): boolean {
  const kind = ctx.unread?.(card).kind ?? "none";
  switch (value) {
    case "comments":
      return kind !== "none";
    case "replies":
      return kind === "reply";
    case "none":
      return kind === "none";
    default:
      return false;
  }
}

/**
 * `assignee:<name>` — that person and nobody else; `assignee:none` — nobody at all; `assignee:me`
 * — whoever the **Your name** setting says you are, and no card when it says nothing, since a
 * plugin that has not been told who you are cannot honestly answer "mine".
 */
function matchAssignee(card: Card, value: string, ctx: MatchContext): boolean {
  const names = assigneeValues(card);
  if (value === "none") return names.length === 0;
  const want = value === "me" ? (ctx.me ?? "") : value;
  if (want.trim() === "") return false;
  return names.some((name) => sameAssignee(name, want));
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
    case "assignee":
      return matchAssignee(card, token.value, ctx);
    case "due":
      return matchDue(card, token.value, ctx);
    case "is":
      return matchIs(card, token.value, ctx);
    case "unread":
      return matchUnread(card, token.value, ctx);
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
  for (const [i, tag] of tagValues(card).entries()) {
    chips.push({ key: "tag-" + i, label: tag, tone: "muted", title: "Tag" });
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
