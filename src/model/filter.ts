// The board's query language: one grammar, parsed and matched below the CardRepository port so
// the search toolbar, a column's lane rule and the MCP tools all judge a card the same way.
import type { RelationCount, Card } from "./types";
import { assigneeValues, sameAssignee } from "./assignees";
import { dueInfo } from "./dates";
import { tagValues } from "./tags";
import { BLOCKS } from "./relationships";
import type { UnreadState } from "./unread";

// ---------------------------------------------------------------------------
// Filter grammar — a reusable string-query language shared by the search toolbar
// (#9) and area-scoped / auto-populated columns (#1).
//
// A query is a space-separated list of terms. A term is either a `key:value` token
// (area:, status:, priority:, tag:, due:, context:, assignee:, is:, unread:) or free text. Free text
// is matched case-insensitively against a card's title + basename + priority + tags + assignees (a
// Card has no body text at board level). Use "double quotes"
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

/** Lower-cased free-text haystack: title + basename + priority + tags (area + frontmatter + body) + assignees. */
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
function blockingCount(card: Card, ctx: MatchContext): { in: number; out: number } {
  const link = ctx.relations?.[card.path]?.find((c) => c.type.key === BLOCKS.key);
  return { in: link?.in ?? 0, out: link?.out ?? 0 };
}

const IS_TESTS: Record<string, (blocking: { in: number; out: number }) => boolean> = {
  blocked: (b) => b.in > 0,
  unblocked: (b) => b.in === 0,
  blocking: (b) => b.out > 0,
};

function matchIs(card: Card, value: string, ctx: MatchContext): boolean {
  const test = IS_TESTS[value];
  return test ? test(blockingCount(card, ctx)) : false;
}

/**
 * `unread:` matching, on the same verdict the tile badge shows. `comments` = anything unread on
 * the card, `replies` = only the louder "someone answered you" state, `none` = nothing unread.
 */
const UNREAD_TESTS: Record<string, (kind: UnreadState["kind"]) => boolean> = {
  comments: (kind) => kind !== "none",
  replies: (kind) => kind === "reply",
  none: (kind) => kind === "none",
};

function matchUnread(card: Card, value: string, ctx: MatchContext): boolean {
  const test = UNREAD_TESTS[value];
  return test ? test(ctx.unread?.(card).kind ?? "none") : false;
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

/**
 * One token key's behaviour: how it judges a card, and whether the context in hand can answer it
 * at all. `answerable` exists because two tokens read state that is not on the card and not on the
 * board — who is reading (`unread:`) and who "me" is (`assignee:me`) — so a caller without those,
 * the MCP server being the one that matters, must be able to tell "this card does not match" from
 * "I cannot say". `matchCard` collapses the second into the first, which is the honest answer for
 * a search box; {@link judgeCard} keeps them apart for a caller about to refuse a write over it.
 */
interface TokenRule {
  test: (card: Card, value: string, ctx: MatchContext) => boolean;
  answerable?: (value: string, ctx: MatchContext) => boolean;
}

/** A typed scalar property read as the lower-cased text a token compares against. */
const propertyIs =
  (read: (card: Card) => string | undefined) =>
  (card: Card, value: string): boolean =>
    (read(card) ?? "").toLowerCase() === value;

const TOKEN_RULES: Record<FilterKey, TokenRule> = {
  area: { test: propertyIs((card) => card.frontmatter.area) },
  status: { test: propertyIs((card) => card.frontmatter.status) },
  priority: { test: propertyIs((card) => card.frontmatter.priority) },
  tag: { test: (card, value) => tagValues(card).some((t) => t.toLowerCase() === value) },
  // #14: a card's context is the folder-derived `card.context` (path-based, the primary source) OR
  // any entry of its `context` frontmatter (string | string[]). Matching both keeps §1/§9/§14 on
  // one notion of context so the filter token stays truthful for folder contexts.
  context: {
    test: (card, value) =>
      (typeof card.context === "string" && card.context.toLowerCase() === value) ||
      listValues(card.frontmatter["context"]).includes(value),
  },
  assignee: {
    test: matchAssignee,
    answerable: (value, ctx) => value !== "me" || ctx.me !== undefined,
  },
  due: { test: matchDue },
  is: { test: matchIs, answerable: (_value, ctx) => ctx.relations !== undefined },
  unread: { test: matchUnread, answerable: (_value, ctx) => ctx.unread !== undefined },
};

/** What a filter says about a card: it matches, it does not, or this context cannot tell. */
export type FilterVerdict = "matches" | "rejects" | "unknown";

/**
 * The engine behind {@link matchCard} and {@link judgeCard}. With `skipUnanswerable` off, a token
 * the context cannot answer is tested anyway and reads as its documented default ("no card is
 * blocked, nothing is unread, nobody is me") — the right answer for a search box, which must return
 * something. With it on, such a token is set aside and the whole verdict becomes `unknown`, which
 * is what a caller about to refuse a write over a rule needs: refusing a card because the server
 * cannot see who has read it would be worse than the write it prevents.
 */
function judge(
  card: Card,
  filter: Filter,
  ctx: MatchContext,
  skipUnanswerable: boolean,
): FilterVerdict {
  if (filter.text.length) {
    const hay = freeTextHaystack(card);
    for (const t of filter.text) if (!hay.includes(t)) return "rejects";
  }
  let unanswered = false;
  for (const token of filter.tokens) {
    const rule = TOKEN_RULES[token.key];
    if (skipUnanswerable && rule.answerable?.(token.value, ctx) === false) {
      unanswered = true;
      continue;
    }
    if (!rule.test(card, token.value, ctx)) return "rejects";
  }
  return unanswered ? "unknown" : "matches";
}

/** Pure predicate: does a card satisfy every term of the parsed filter? */
export function matchCard(card: Card, filter: Filter, ctx: MatchContext): boolean {
  return judge(card, filter, ctx, false) === "matches";
}

/**
 * Like {@link matchCard}, but says "I cannot tell" instead of guessing when the context is missing
 * what a token reads. Only a caller that will act on a "no" — refusing a write — needs the
 * distinction; everything that merely shows cards wants {@link matchCard}.
 */
export function judgeCard(card: Card, filter: Filter, ctx: MatchContext): FilterVerdict {
  return judge(card, filter, ctx, true);
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
