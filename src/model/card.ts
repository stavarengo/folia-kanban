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

import yaml from "js-yaml";
import type { CardBody, CardStats, SubItem } from "./types";
import { DataCorruptionError, FrontmatterSchema, decode } from "./schemas";

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/;
const CHECKBOX_RE = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/;
const WIKILINK_ONLY_RE = /^\[\[([^\]]+)\]\]$/;
const TS_LINE_RE = /^\s*[-*]\s+\[([^\]]+)\]\s+([\s\S]*)$/;

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
    data = yaml.load(inner);
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

function parseSubItem(rawText: string, index: number, done: boolean): SubItem {
  const trimmed = rawText.trim();
  const m = WIKILINK_ONLY_RE.exec(trimmed);
  if (m) {
    const group1 = m[1] ?? "";
    const target = group1.split("|")[0]?.split("#")[0]?.trim() ?? "";
    return { kind: "card", text: trimmed, done, link: target, index };
  }
  return { kind: "todo", text: trimmed, done, index };
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
    const m = TS_LINE_RE.exec(line);
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

  let descEnd = lines.length;
  for (let i = h1 === -1 ? 0 : h1 + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^##\s+/.test(line)) {
      descEnd = i;
      break;
    }
  }
  const description = lines
    .slice(h1 === -1 ? 0 : h1 + 1, descEnd)
    .join("\n")
    .trim();

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
    nextTodos: b.subtasks
      .filter((s) => s.kind === "todo" && !s.done)
      .slice(0, 5)
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
  return withBody(text, (b) => appendToSection(b, SECTION.comments, `- [${timestamp}] ${comment}`));
}

export function appendHistory(text: string, entry: string, timestamp: string): string {
  return withBody(text, (b) => appendToSection(b, SECTION.history, `- [${timestamp}] ${entry}`));
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

const TS_PREFIX_RE = /^(\s*[-*]\s+\[[^\]]+\]\s+)([\s\S]*)$/;
const BULLET_RE = /^\s*[-*]\s+/;

/**
 * Replace ONLY the text after `[timestamp] ` of the index-th bullet line in a timestamped
 * section (Comments / History). The bullet prefix + timestamp stay byte-identical. Index is
 * 0-based among the section's bullet lines (matching `parseTimestamped`'s walk).
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

/** Replace the description region (between the H1 title and the first `##` section). */
export function setDescription(text: string, description: string): string {
  return withBody(text, (body) => {
    const lines = body.split("\n");
    const h1 = lines.findIndex((l) => /^#\s+/.test(l));
    const from = h1 === -1 ? 0 : h1 + 1;
    let to = lines.length;
    for (let i = from; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^##\s+/.test(line)) {
        to = i;
        break;
      }
    }
    const desc = description.trim();
    const block = desc === "" ? [""] : ["", ...desc.split("\n"), ""];
    const tail = to < lines.length ? lines.slice(to) : [];
    const head = lines.slice(0, from);
    const rebuilt = [...head, ...block, ...tail];
    return rebuilt.join("\n");
  });
}
