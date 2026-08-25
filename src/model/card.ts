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
import { DataCorruptionError, FrontmatterSchema, decode } from "./schemas";

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/;
const CHECKBOX_RE = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/;
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
const TS_LINE_RE = /^\s*[-*]\s+_([0-9: -]+):_\s+([\s\S]*)$/;
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

function headingIndex(lines: string[], name: string): number {
  const re = new RegExp("^##\\s+" + escapeRegExp(name) + "\\s*$", "i");
  return lines.findIndex((l) => re.test(l));
}

/** Index of the line that ends the section started at `start` (next H1/H2, or EOF). */
function sectionEnd(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && /^#{1,2}\s+/.test(line)) return i;
  }
  return lines.length;
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
function descriptionRange(lines: string[]): { from: number; to: number } {
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  const from = h1 === -1 ? 0 : h1 + 1;
  let to = lines.length;
  for (let i = from; i < lines.length; i++) {
    if (OWNED_HEADING_RE.test(lines[i] ?? "")) {
      to = i;
      break;
    }
  }
  return { from, to };
}

/** Append a single line to a section, creating the section at end if absent. */
function appendToSection(body: string, name: string, line: string): string {
  const lines = body.split("\n");
  const start = headingIndex(lines, name);
  if (start === -1) {
    let out = body;
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    // ensure a blank line before the new heading when there's preceding content
    if (out.trim() !== "" && !out.endsWith("\n\n")) out += "\n";
    out += `## ${name}\n${line}\n`;
    return out;
  }
  const end = sectionEnd(lines, start);
  let insert = end;
  while (insert - 1 > start && lines[insert - 1]?.trim() === "") insert--;
  lines.splice(insert, 0, line);
  return lines.join("\n");
}

/** Return the content lines (excluding the heading) of a section, or [] if absent. */
function sectionLines(body: string, name: string): string[] {
  const lines = body.split("\n");
  const start = headingIndex(lines, name);
  if (start === -1) return [];
  return lines.slice(start + 1, sectionEnd(lines, start));
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
  const body = splitFrontmatter(text).body;
  const items: SubItem[] = [];
  let i = 0;
  for (const line of sectionLines(body, SECTION.subtasks)) {
    const m = CHECKBOX_RE.exec(line);
    if (!m) continue;
    const rawText = m[3] ?? "";
    const checkChar = m[2] ?? " ";
    items.push(parseSubItem(rawText, i++, checkChar !== " "));
  }
  return items;
}

function parseTimestamped(body: string, name: string): { timestamp: string; text: string }[] {
  const out: { timestamp: string; text: string }[] = [];
  for (const line of sectionLines(body, name)) {
    if (!/^\s*[-*]\s+/.test(line)) continue;
    const m = TS_LINE_RE.exec(line) ?? TS_LINE_LEGACY_RE.exec(line);
    if (m) out.push({ timestamp: (m[1] ?? "").trim(), text: (m[2] ?? "").trim() });
    else out.push({ timestamp: "", text: line.replace(/^\s*[-*]\s+/, "").trim() });
  }
  return out;
}

export function parseBody(text: string): CardBody {
  const body = splitFrontmatter(text).body;
  const lines = body.split("\n");
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  const h1Line = h1 === -1 ? "" : (lines[h1] ?? "");
  const title = h1 === -1 ? "" : h1Line.replace(/^#\s+/, "").trim();

  const { from, to } = descriptionRange(lines);
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

export function appendComment(text: string, comment: string, timestamp: string): string {
  return withBody(text, (b) =>
    appendToSection(b, SECTION.comments, `- _${timestamp}:_ ${comment}`),
  );
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
    const start = headingIndex(lines, SECTION.subtasks);
    if (start === -1) return body;
    const end = sectionEnd(lines, start);
    let n = 0;
    for (let i = start + 1; i < end; i++) {
      const m = CHECKBOX_RE.exec(lines[i] ?? "");
      if (!m) continue;
      if (n === index) {
        lines[i] = `${m[1] ?? ""}[${done ? "x" : " "}] ${m[3] ?? ""}`;
        break;
      }
      n++;
    }
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
    const start = headingIndex(lines, SECTION.subtasks);
    if (start === -1) return body;
    const end = sectionEnd(lines, start);
    let n = 0;
    for (let i = start + 1; i < end; i++) {
      const line = lines[i] ?? "";
      const m = CHECKBOX_RE.exec(line);
      if (!m) continue;
      if (n === index) {
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
        break;
      }
      n++;
    }
    return lines.join("\n");
  });
}

export function removeSubtask(text: string, index: number): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const start = headingIndex(lines, SECTION.subtasks);
    if (start === -1) return body;
    const end = sectionEnd(lines, start);
    let n = 0;
    for (let i = start + 1; i < end; i++) {
      if (!CHECKBOX_RE.test(lines[i] ?? "")) continue;
      if (n === index) {
        lines.splice(i, 1);
        break;
      }
      n++;
    }
    return lines.join("\n");
  });
}

// Matches either the current `- _timestamp:_ ` prefix or the legacy `- [timestamp] ` one, so
// editing an old note's line keeps its original prefix byte-for-byte instead of migrating it.
// The `_..._` branch mirrors TS_LINE_RE's character-class boundary rule.
const TS_PREFIX_RE = /^(\s*[-*]\s+(?:_[0-9: -]+:_|\[[^\]]+\])\s+)([\s\S]*)$/;
const BULLET_RE = /^\s*[-*]\s+/;

/**
 * Replace ONLY the text after the timestamp prefix (`_timestamp:_ ` or the legacy `[timestamp] `)
 * of the index-th bullet line in a timestamped section (Comments / History). The bullet prefix +
 * timestamp stay byte-identical. Index is 0-based among the section's bullet lines (matching
 * `parseTimestamped`'s walk).
 */
export function updateTimestampedLine(
  text: string,
  section: string,
  index: number,
  newText: string,
): string {
  // Comments are single-line; collapse any embedded newline so it can't desync the index walk.
  const safeText = newText.replace(/[\r\n]+/g, " ");
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const start = headingIndex(lines, section);
    if (start === -1) return body;
    const end = sectionEnd(lines, start);
    let n = 0;
    for (let i = start + 1; i < end; i++) {
      const currentLine = lines[i] ?? "";
      if (!BULLET_RE.test(currentLine)) continue;
      if (n === index) {
        // `split("\n")` leaves a trailing CR on CRLF files; re-attach it so the edited line keeps
        // the same line ending as its siblings (byte-stable).
        const cr = currentLine.endsWith("\r") ? "\r" : "";
        const m = TS_PREFIX_RE.exec(currentLine);
        if (m) {
          lines[i] = `${m[1] ?? ""}${safeText}${cr}`;
        } else {
          // Bullet with no `[timestamp]` (a bare `- text`): replace only the post-bullet text.
          const bm = BULLET_RE.exec(currentLine);
          if (bm) lines[i] = `${bm[0] ?? ""}${safeText}${cr}`;
        }
        break;
      }
      n++;
    }
    return lines.join("\n");
  });
}

/** Delete ONLY the index-th bullet line of a timestamped section; every other byte passes through. */
export function removeTimestampedLine(text: string, section: string, index: number): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const start = headingIndex(lines, section);
    if (start === -1) return body;
    const end = sectionEnd(lines, start);
    let n = 0;
    for (let i = start + 1; i < end; i++) {
      if (!BULLET_RE.test(lines[i] ?? "")) continue;
      if (n === index) {
        lines.splice(i, 1);
        break;
      }
      n++;
    }
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
