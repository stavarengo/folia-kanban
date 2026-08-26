// Pure, byte-stable card markdown engine.
//
// Design rule (the make-or-break property): NEVER reserialize what you didn't change.
//  - Frontmatter is split off verbatim and never rewritten here (the Obsidian adapter
//    edits frontmatter via fileManager.processFrontMatter to avoid YAML drift).
//  - Body edits splice only the target section; every other byte is passed through
//    untouched. Adding a missing section only appends at the end.
//
// All functions take and return the FULL file text so callers can pipe them through
// vault.process(file, text => ...).

import { parse as parseYaml } from "yaml";
import type { CardBody, CardStats, SubItem } from "./types";
import { fencedLines, unclosedFence } from "./fences";
import { DataCorruptionError, FrontmatterSchema, decode } from "./schemas";
import { normalizeAuthor } from "./unread";

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/;
const CHECKBOX_RE = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*]\s+/;
const WIKILINK_ONLY_RE = /^\[\[([^\]]+)\]\]$/;
// A checklist line's own column, written as an Obsidian/Dataview inline field: `- [ ] Ship it
// [status:: doing]`. Hand-editable and invisible in reading view, which is why it is preferred
// over a `#doing` tag (that would land in the note's tag pane and mean something else).
// Whitespace-tolerant on both sides of `::` so a hand-typed `[status::doing]` still reads.
const INLINE_STATUS_RE = /\[status::\s*([^\]]*?)\s*\]/;
// Current write format: `- _2026-08-21 11:49:_ text` — an italic timestamp prefix, no brackets.
// No timezone suffix is written today (`stamp()` in ./dates.ts is local time, unlabeled); if one
// is ever added, extend this character class to match (letters, currently excluded) — otherwise
// every newly written line would silently fail to parse as timestamped.
// The timestamp capture is restricted to the characters `stamp()` ever produces (digits, `-`,
// `:`, space) rather than "anything but `_`": that both makes the closing `:_ ` delimiter
// unambiguous (a timestamp can never itself contain that sequence) and keeps the format from
// swallowing an unrelated prose line that happens to start with an italic label, e.g.
// `- _Decision:_ use SQLite`.
// An optional `@author` may follow the timestamp inside the same italic prefix
// (`- _2026-08-21 11:49 @rafa:_ text`) — how a person or an agent signs a comment. The author
// capture excludes whitespace and `:` (the two characters that delimit the prefix) but ALLOWS `_`,
// so a real name like `@alex_smith` reads: the `:` is what ends the capture, and the `_` right
// after it closes the italics. A line without an author parses exactly as before, author unknown.
const TS_LINE_RE = /^\s*[-*]\s+_([0-9: -]+?)(?:\s+@([^\s:]+))?:_\s+([\s\S]*)$/;
// Legacy format written before this change: `- [2026-08-21 11:49] text`. Old notes never get
// rewritten, so this stays supported for reading forever alongside TS_LINE_RE.
const TS_LINE_LEGACY_RE = /^\s*[-*]\s+\[([^\]]+)\]\s+([\s\S]*)$/;

export const SECTION = {
  subtasks: "Subtasks",
  comments: "Comments",
  history: "History",
} as const;

// ---------------------------------------------------------------------------
// Frontmatter (read-only here; writes happen via the Obsidian adapter)
// ---------------------------------------------------------------------------

export function splitFrontmatter(text: string): { fmText: string; body: string } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { fmText: "", body: text };
  const fmText = m[1] ?? "";
  return { fmText, body: text.slice(fmText.length) };
}

export function parseFrontmatter(text: string): Record<string, unknown> {
  const { fmText } = splitFrontmatter(text);
  if (!fmText) return {};
  const inner = fmText.replace(/^---\r?\n/, "").replace(/\r?\n---\r?\n?$/, "");
  let data: unknown;
  try {
    data = parseYaml(inner);
  } catch (e) {
    // §17: malformed YAML is corruption, not "no frontmatter" — surface it, don't hide it
    // behind an empty object (which would silently drop the card's status/order/etc.).
    throw new DataCorruptionError("Card frontmatter is not valid YAML", { cause: e });
  }
  // An empty frontmatter block (`--- \n ---`) is legitimately "no fields".
  if (data == null) return {};
  // Anything present must be a mapping; a list or scalar in the `---` block is corruption.
  return decode(FrontmatterSchema, data, "card frontmatter");
}

// ---------------------------------------------------------------------------
// Low-level section utilities (operate on the body string)
// ---------------------------------------------------------------------------

// Every structural lookup below takes the body's fence map (`fencedLines`) so that a heading or a
// bullet quoted inside a code block is text, never structure. The map is shared between the
// description boundary, the section readers and the section writers on purpose: if any one of
// them saw a fenced `## Comments` as real, the same text would show in two places and a save would
// rewrite a section the person never touched.

function headingIndex(lines: string[], name: string, fenced: readonly boolean[]): number {
  const re = new RegExp("^##\\s+" + escapeRegExp(name) + "\\s*$", "i");
  return lines.findIndex((l, i) => !fenced[i] && re.test(l));
}

/** Index of the line that ends the section started at `start` (next unfenced H1/H2, or EOF). */
function sectionEnd(lines: string[], start: number, fenced: readonly boolean[]): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (!fenced[i] && /^#{1,2}\s+/.test(lines[i] ?? "")) return i;
  }
  return lines.length;
}

/**
 * Indices of a section's own lines: the heading and anything fenced excluded, so readers and
 * writers that count lines here count the same ones. `null` when the section is absent.
 */
function sectionContent(lines: string[], name: string): number[] | null {
  const fenced = fencedLines(lines);
  const start = headingIndex(lines, name, fenced);
  if (start === -1) return null;
  const end = sectionEnd(lines, start, fenced);
  const out: number[] = [];
  for (let i = start + 1; i < end; i++) if (!fenced[i]) out.push(i);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The `##` headings the plugin itself owns. Deliberately built with the SAME shape as
// `headingIndex` (exactly two hashes, no indent, no trailing hashes, case-insensitive), because
// the description boundary and the section readers must agree line for line: if one of them
// recognized `## comments` and the other did not, the same text would show up in two boxes and
// saving the description would rewrite a section it does not own.
const OWNED_HEADING_RE = new RegExp(
  "^##\\s+(?:" + Object.values(SECTION).map(escapeRegExp).join("|") + ")\\s*$",
  "i",
);

/**
 * The half-open line range `[from, to)` holding a card's description: everything after the `#`
 * title heading (or from the top when there is none) up to the first section the plugin owns.
 * Headings the plugin does not own stay inside the range — a note that keeps its whole body under
 * `## Question` / `## Answer` is still a description, and round-tripping it must not reshape it.
 */
function descriptionRange(lines: string[]): { h1: number; from: number; to: number } {
  const fenced = fencedLines(lines);
  const h1 = lines.findIndex((l, i) => !fenced[i] && /^#\s+/.test(l));
  const from = h1 === -1 ? 0 : h1 + 1;
  let to = lines.length;
  for (let i = from; i < lines.length; i++) {
    if (!fenced[i] && OWNED_HEADING_RE.test(lines[i] ?? "")) {
      to = i;
      break;
    }
  }
  return { h1, from, to };
}

/**
 * Why a would-be description must not be saved as one, or `null` when it is all description: a
 * line that would start a section the plugin owns (`## Comments` typed into the Description box),
 * or a code fence left open, which would run to the end of the note and swallow every section
 * after it. Fenced lines do not count as headings, matching what `descriptionRange` reads back.
 */
export function descriptionRefusal(
  description: string,
): { kind: "heading" | "fence"; line: string } | null {
  // Judge the bytes `setDescription` will write: it trims, so an indent on the first line that
  // would keep a heading or a fence inert here is gone by the time the note is read back.
  const lines = description.trim().split("\n");
  const fenced = fencedLines(lines);
  const i = lines.findIndex((l, n) => !fenced[n] && OWNED_HEADING_RE.test(l));
  if (i !== -1) return { kind: "heading", line: (lines[i] ?? "").trim() };
  const open = unclosedFence(lines);
  return open === null ? null : { kind: "fence", line: (lines[open.at] ?? "").trim() };
}

/** Append a single line to a section, creating the section at end if absent. */
function appendToSection(body: string, name: string, line: string): string {
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  const start = headingIndex(lines, name, fenced);
  if (start === -1) {
    let out = body;
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    // A fence left open runs to the end of the note, and would swallow the new section with it.
    const open = unclosedFence(lines);
    if (open !== null) out += `${open.marker}\n`;
    // ensure a blank line before the new heading when there's preceding content
    if (out.trim() !== "" && !out.endsWith("\n\n")) out += "\n";
    out += `## ${name}\n${line}\n`;
    return out;
  }
  const end = sectionEnd(lines, start, fenced);
  let insert = end;
  while (insert - 1 > start && lines[insert - 1]?.trim() === "") insert--;
  // The same open fence, inside the section itself, would swallow the new line.
  const open = end === lines.length ? unclosedFence(lines) : null;
  lines.splice(insert, 0, ...(open === null ? [line] : [open.marker, line]));
  return lines.join("\n");
}

/** Line index of the index-th checklist line under `## Subtasks`, or -1. */
function checklistLine(lines: string[], index: number): number {
  let n = 0;
  for (const i of sectionContent(lines, SECTION.subtasks) ?? []) {
    if (!CHECKBOX_RE.test(lines[i] ?? "")) continue;
    if (n === index) return i;
    n++;
  }
  return -1;
}

/**
 * One entry of a timestamped section (Comments / History), as the half-open line range
 * `[from, to)`: a bullet, or a paragraph of prose. Either runs until a blank line, a fence or
 * another bullet, so a comment wrapped over several lines reads as one, bullet or not. The reader
 * and both writers walk this same list, which is what keeps "comment N" meaning the same lines to
 * all of them.
 */
interface Entry {
  from: number;
  to: number;
  bullet: boolean;
}

function timestampedEntries(lines: string[], name: string): Entry[] {
  const entries: Entry[] = [];
  for (const i of sectionContent(lines, name) ?? []) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const bullet = BULLET_RE.test(line);
    const last = entries[entries.length - 1];
    if (!bullet && last && last.to === i) last.to = i + 1;
    else entries.push({ from: i, to: i + 1, bullet });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Parsing (read-only, for display)
// ---------------------------------------------------------------------------

/**
 * Rejoin what sat on either side of a removed inline field, closing only the gap the field left
 * behind. Whitespace anywhere else in the line is the author's and is passed through — a todo
 * reading `Deploy  to  prod` must not be respaced just because it also carries a field.
 */
function closeGap(left: string, right: string): string {
  const l = left.replace(/[ \t]+$/, "");
  const r = right.replace(/^[ \t]+/, "");
  return l !== "" && r !== "" ? `${l} ${r}` : l + r;
}

/**
 * Split a checklist line's text into the part people read and the inline `[status:: …]` field.
 * The field is taken out of the text so it never shows up as part of a todo's title, and an empty
 * or whitespace-only value reads as no claim at all (the same as omitting the field).
 */
function splitInlineStatus(text: string): { text: string; status?: string } {
  const m = INLINE_STATUS_RE.exec(text);
  if (!m) return { text };
  const rest = closeGap(text.slice(0, m.index), text.slice(m.index + m[0].length)).trim();
  const value = (m[1] ?? "").trim();
  return value === "" ? { text: rest } : { text: rest, status: value };
}

function parseSubItem(rawText: string, index: number, done: boolean): SubItem {
  // Strip the inline field FIRST: a subcard line carrying one (`- [ ] [[Child]] [status:: doing]`)
  // must still parse as a link, not fall through to a plain todo whose text happens to contain one.
  const { text: trimmed, status } = splitInlineStatus(rawText.trim());
  const m = WIKILINK_ONLY_RE.exec(trimmed);
  if (m) {
    const group1 = m[1] ?? "";
    const target = group1.split("|")[0]?.split("#")[0]?.trim() ?? "";
    return { kind: "card", text: trimmed, done, link: target, index };
  }
  return status === undefined
    ? { kind: "todo", text: trimmed, done, index }
    : { kind: "todo", text: trimmed, done, status, index };
}

export function parseSubtasks(text: string): SubItem[] {
  const lines = splitFrontmatter(text).body.split("\n");
  const items: SubItem[] = [];
  let i = 0;
  for (const n of sectionContent(lines, SECTION.subtasks) ?? []) {
    const m = CHECKBOX_RE.exec(lines[n] ?? "");
    if (!m) continue;
    const rawText = m[3] ?? "";
    const checkChar = m[2] ?? " ";
    items.push(parseSubItem(rawText, i++, checkChar !== " "));
  }
  return items;
}

type Timestamped = { timestamp: string; text: string; author: string | null };

/**
 * Read one entry of a timestamped section. Only the current bullet format carries an author; the
 * legacy bracketed form, bare bullets and prose report `null`, i.e. "written before anyone signed
 * comments", and prose has no timestamp at all.
 */
function readEntry(lines: string[], entry: Entry): Timestamped {
  const [first = "", ...rest] = lines
    .slice(entry.from, entry.to)
    .map((l) => l.replace(/\r$/, "").trim());
  const withRest = (text: string) => [text, ...rest].join("\n").trim();
  if (!entry.bullet) return { timestamp: "", author: null, text: withRest(first) };
  const m = TS_LINE_RE.exec(first);
  if (m)
    return { timestamp: (m[1] ?? "").trim(), author: m[2] ?? null, text: withRest(m[3] ?? "") };
  const legacy = TS_LINE_LEGACY_RE.exec(first);
  if (legacy)
    return { timestamp: (legacy[1] ?? "").trim(), author: null, text: withRest(legacy[2] ?? "") };
  return { timestamp: "", author: null, text: withRest(first.replace(BULLET_RE, "")) };
}

function parseTimestamped(body: string, name: string): Timestamped[] {
  const lines = body.split("\n");
  return timestampedEntries(lines, name).map((e) => readEntry(lines, e));
}

export function parseBody(text: string): CardBody {
  const body = splitFrontmatter(text).body;
  const lines = body.split("\n");
  const { h1, from, to } = descriptionRange(lines);
  const title = h1 === -1 ? "" : (lines[h1] ?? "").replace(/^#\s+/, "").trim();
  const description = lines.slice(from, to).join("\n").trim();

  return {
    title,
    description,
    subtasks: parseSubtasks(text),
    comments: parseTimestamped(body, SECTION.comments),
    history: parseTimestamped(body, SECTION.history),
  };
}

export function cardStats(text: string): CardStats {
  const b = parseBody(text);
  // Progress counts EVERY checklist line by its own checkbox — plain todos AND subcard-links —
  // keyed by line, never collapsed by title. `subcards` stays a separate git-branch counter.
  return {
    checklist: b.subtasks.length,
    checklistDone: b.subtasks.filter((s) => s.done).length,
    subcards: b.subtasks.filter((s) => s.kind === "card").length,
    comments: b.comments.length,
    commentMarks: b.comments.map((c) => ({ timestamp: c.timestamp, author: c.author })),
    // Every outstanding todo, uncapped: the board still has to drop the ones placed in a column of
    // their own, and capping before that could hide todos that are genuinely waiting. The card tile
    // shows the first `cardNextTodos` of what survives.
    nextTodos: b.subtasks
      .filter((s) => s.kind === "todo" && !s.done)
      .map((s) => ({ text: s.text, index: s.index })),
  };
}

// ---------------------------------------------------------------------------
// Byte-stable mutations (full text in, full text out)
// ---------------------------------------------------------------------------

function withBody(text: string, fn: (body: string) => string): string {
  const { fmText, body } = splitFrontmatter(text);
  return fmText + fn(body);
}

/**
 * Append a comment. `author` signs it inside the italic prefix (`- _<ts> @name:_ text`); left out
 * or empty, the line is written exactly as it was before authorship existed. The name is
 * normalized so it can never contain a character that would break the prefix.
 */
export function appendComment(
  text: string,
  comment: string,
  timestamp: string,
  author?: string,
): string {
  const signature = author ? normalizeAuthor(author) : "";
  const prefix = signature ? `${timestamp} @${signature}` : timestamp;
  return withBody(text, (b) => appendToSection(b, SECTION.comments, `- _${prefix}:_ ${comment}`));
}

export function appendHistory(text: string, entry: string, timestamp: string): string {
  return withBody(text, (b) => appendToSection(b, SECTION.history, `- _${timestamp}:_ ${entry}`));
}

export function addTodo(text: string, todo: string): string {
  return withBody(text, (b) => appendToSection(b, SECTION.subtasks, `- [ ] ${todo}`));
}

/** Add a subcard reference (a checklist item linking to a child card). */
export function addSubcard(text: string, link: string): string {
  return withBody(text, (b) => appendToSection(b, SECTION.subtasks, `- [ ] [[${link}]]`));
}

/** Toggle/set the done state of the index-th subtask (0-based among checklist items). */
export function setSubtaskDone(text: string, index: number, done: boolean): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const i = checklistLine(lines, index);
    const m = i === -1 ? null : CHECKBOX_RE.exec(lines[i] ?? "");
    if (!m) return body;
    lines[i] = `${m[1] ?? ""}[${done ? "x" : " "}] ${m[3] ?? ""}`;
    return lines.join("\n");
  });
}

/**
 * Set (or clear, with `null`) the inline `[status:: …]` field of the index-th checklist line.
 * Byte-stable: only that one line is touched, its bullet prefix and checkbox pass through, and an
 * existing field is rewritten where it already sits rather than moved to the end of the line.
 */
export function setSubtaskStatus(text: string, index: number, status: string | null): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const i = checklistLine(lines, index);
    const line = lines[i] ?? "";
    const m = i === -1 ? null : CHECKBOX_RE.exec(line);
    if (!m) return body;
    // `split("\n")` leaves a trailing CR on CRLF files; keep this line's ending as it was.
    const cr = line.endsWith("\r") ? "\r" : "";
    const prefix = m[1] ?? "";
    const box = m[2] ?? " ";
    const content = (m[3] ?? "").replace(/\r$/, "");
    const field = status === null ? "" : `[status:: ${status}]`;
    const existing = INLINE_STATUS_RE.exec(content);
    const before = existing ? content.slice(0, existing.index) : "";
    const after = existing ? content.slice(existing.index + existing[0].length) : "";
    let next: string;
    if (existing && field !== "") {
      // Replace the field exactly where it sits: every other byte of the line is the author's.
      next = before + field + after;
    } else if (existing) {
      next = closeGap(before, after).trimEnd();
    } else {
      next = field === "" ? content : `${content.trimEnd()} ${field}`;
    }
    lines[i] = `${prefix}[${box}] ${next}${cr}`;
    return lines.join("\n");
  });
}

export function removeSubtask(text: string, index: number): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const i = checklistLine(lines, index);
    if (i === -1) return body;
    lines.splice(i, 1);
    return lines.join("\n");
  });
}

// Matches either the current `- _timestamp:_ ` / `- _timestamp @author:_ ` prefix or the legacy
// `- [timestamp] ` one, so editing an old note's line keeps its original prefix byte-for-byte
// instead of migrating it — and editing an authored comment keeps its signature.
// The `_..._` branch mirrors TS_LINE_RE's character-class boundary rule.
const TS_PREFIX_RE = /^(\s*[-*]\s+(?:_[0-9: -]+?(?:\s+@[^\s:]+)?:_|\[[^\]]+\])\s+)([\s\S]*)$/;

// What a line at column 0 must not start with to stay prose: a heading, or a fence. Either would
// be structure to the lookups above, and would move or hide every entry after it. `\s`, not a
// narrower class, because that is what the heading lookups above accept.
const STRUCTURAL_LINE_RE = /^ {0,3}(?:#{1,6}\s|`{3,}|~{3,})/;

/**
 * Rewrite the text of the index-th entry of a timestamped section (Comments / History), 0-based in
 * the order `parseTimestamped` reads them. The entry is written back as one line. On a bullet, ONLY
 * the text after its timestamp prefix (`_timestamp:_ ` or the legacy `[timestamp] `) changes; the
 * bullet prefix and timestamp stay byte-identical. A prose entry has no prefix to keep, so its text
 * is written bare — unless the new text would read as a heading or a fence at column 0, in which
 * case it is written as a bullet so it stays a comment. Nothing outside the entry is touched.
 */
export function updateTimestampedLine(
  text: string,
  section: string,
  index: number,
  newText: string,
): string {
  // Entries are written single-line; collapse any embedded newline so the entry stays one entry.
  const safeText = newText.replace(/[\r\n]+/g, " ");
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const entry = timestampedEntries(lines, section)[index];
    if (!entry) return body;
    const currentLine = lines[entry.from] ?? "";
    // `split("\n")` leaves a trailing CR on CRLF files; re-attach it so the edited line keeps the
    // same line ending as its siblings (byte-stable).
    const cr = currentLine.endsWith("\r") ? "\r" : "";
    // A bare bullet (`- text`, no timestamp) keeps its bullet prefix; prose keeps nothing.
    const prefix = entry.bullet
      ? (TS_PREFIX_RE.exec(currentLine)?.[1] ?? BULLET_RE.exec(currentLine)?.[0] ?? "")
      : STRUCTURAL_LINE_RE.test(safeText)
        ? "- "
        : "";
    lines.splice(entry.from, entry.to - entry.from, `${prefix}${safeText}${cr}`);
    return lines.join("\n");
  });
}

/**
 * Delete ONLY the index-th entry of a timestamped section (a bullet line, or every line of a prose
 * paragraph); every other byte passes through.
 */
export function removeTimestampedLine(text: string, section: string, index: number): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const entry = timestampedEntries(lines, section)[index];
    if (!entry) return body;
    // Take the blank line that separated a paragraph from the next entry with it, so repeated
    // edits do not pile blank lines up.
    const gap = lines[entry.from - 1]?.trim() === "" && lines[entry.to]?.trim() === "" ? 1 : 0;
    lines.splice(entry.from, entry.to - entry.from + gap);
    return lines.join("\n");
  });
}

/**
 * Replace the description region — between the `#` title heading and the first section the plugin
 * owns. Mirrors what `parseBody` reads, so writing back an unedited description is a no-op beyond
 * blank-line normalization, and the note's own headings survive the round trip verbatim.
 */
export function setDescription(text: string, description: string): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const { from, to } = descriptionRange(lines);
    const desc = description.trim();
    const block = desc === "" ? [""] : ["", ...desc.split("\n"), ""];
    const tail = to < lines.length ? lines.slice(to) : [];
    const head = lines.slice(0, from);
    const rebuilt = [...head, ...block, ...tail];
    return rebuilt.join("\n");
  });
}
