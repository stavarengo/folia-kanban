// Where a card's displayed title comes from. The file's basename stays the card's identity (it is
// what `[[wikilinks]]` bind to); the title is only what people read, search and sort by.
//
// Both judgements below are shape-based on purpose: the plugin must not impose a naming
// convention, so it never keeps a list of forbidden words. A file name "looks like a slug" or a
// heading "looks like a title" purely by how it is built.

import { SECTION, splitFrontmatter } from "./card";
import { fencedLines } from "./fences";
import type { CardFrontmatter, TitleMode, TitleSource } from "./types";

/** The per-card frontmatter key that overrides every other source. */
export const TITLE_KEY = "title";

const TITLE_MODES: readonly TitleMode[] = ["auto", "filename", "heading"];

/** Normalize a raw `card-title` frontmatter value; anything unrecognized means `auto`. */
export function asTitleMode(raw: unknown): TitleMode {
  return typeof raw === "string" && (TITLE_MODES as readonly string[]).includes(raw)
    ? (raw as TitleMode)
    : "auto";
}

/**
 * A basename reads as a slug when it is built for sorting or machines rather than for people:
 * it starts with a number (`01-fix-export`, `2026-08-24 notes`) or is words glued together with
 * dashes/underscores and no spaces (`fix-the-export-path`, `widget_helpers`). A single word or
 * anything containing spaces is taken as a name.
 */
export function looksLikeSlug(basename: string): boolean {
  const s = basename.trim();
  if (/^\d+(?:[^\p{L}\p{N}]|$)/u.test(s)) return true;
  return !/\s/.test(s) && /[\p{L}\p{N}][-_][\p{L}\p{N}]/u.test(s);
}

/**
 * A heading reads as a title when it has the breadth of one: three or more words, or two words
 * spanning at least twelve characters. Section labels (`Question`, `Answer`, `To Do`, `Notes`)
 * fall below that bar without any word being special-cased.
 */
export function looksLikeTitle(heading: string): boolean {
  const words = heading.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3 || (words.length === 2 && heading.trim().length >= 12);
}

// CommonMark shape, because that is what Obsidian renders: an ATX heading may be indented by up
// to three spaces.
const HEADING_RE = /^( {0,3})(#{1,6})[ \t]+(.*?)([ \t]*#*[ \t]*)\r?$/;

/**
 * The section headings the card parser owns (`## Subtasks`, `## Comments`, `## History`). They are
 * never title candidates: retitling one would rewrite the heading `parseSubtasks` and friends look
 * for, silently detaching a card's subtasks, comments or history. This is structure, not a word
 * list — these three names are the plugin's own format, not a judgement about anyone's wording.
 */
const RESERVED_HEADINGS: ReadonlySet<string> = new Set(
  Object.values(SECTION).map((s) => s.toLowerCase()),
);

/** Turn heading markup into the plain text a card tile can show. */
function plainHeadingText(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, "$2")
    .trim();
}

interface Heading {
  /** Index into the body's `split("\n")` lines. */
  line: number;
  text: string;
}

/** The first heading (any level, outside code fences) whose plain text passes `accept`. */
function findHeading(body: string, accept: (text: string) => boolean): Heading | null {
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const text = plainHeadingText(HEADING_RE.exec(lines[i] ?? "")?.[3] ?? "");
    if (!text || RESERVED_HEADINGS.has(text.toLowerCase())) continue;
    if (accept(text)) return { line: i, text };
  }
  return null;
}

const ANY_HEADING = () => true;

/** The heading a given mode would take the title from, or null when the mode never reads one. */
function headingFor(body: string, basename: string, mode: TitleMode): Heading | null {
  if (mode === "heading") return findHeading(body, ANY_HEADING);
  if (mode === "auto" && looksLikeSlug(basename)) return findHeading(body, looksLikeTitle);
  return null;
}

function frontmatterTitle(frontmatter: CardFrontmatter): string | null {
  const v = frontmatter[TITLE_KEY];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface ResolvedTitle {
  title: string;
  source: TitleSource;
}

/**
 * Pick a card's displayed title. The card's own `title` frontmatter wins outright; otherwise the
 * board's mode decides whether a heading is consulted; the basename is always the last resort.
 */
export function resolveTitle(
  basename: string,
  frontmatter: CardFrontmatter,
  text: string,
  mode: TitleMode,
): ResolvedTitle {
  const fromFrontmatter = frontmatterTitle(frontmatter);
  if (fromFrontmatter !== null) return { title: fromFrontmatter, source: "frontmatter" };
  const heading = headingFor(splitFrontmatter(text).body, basename, mode);
  if (heading) return { title: heading.text, source: "heading" };
  return { title: basename, source: "filename" };
}

/**
 * Rewrite the text of the heading `resolveTitle` would pick, keeping its `#` marker and every
 * other byte. Returns the text unchanged when no heading is selected under `mode`.
 */
export function setHeadingTitle(
  text: string,
  basename: string,
  mode: TitleMode,
  newTitle: string,
): string {
  const { fmText, body } = splitFrontmatter(text);
  const heading = headingFor(body, basename, mode);
  if (!heading) return text;
  const lines = body.split("\n");
  const current = lines[heading.line] ?? "";
  const m = HEADING_RE.exec(current);
  // Keep the indent, the `#` marker and any closing hashes; only the heading's text is replaced
  // (the old text's inline markup goes with it — the new title is what the person typed, plain).
  const indent = m?.[1] ?? "";
  const marker = m?.[2] ?? "#";
  const suffix = m?.[4] ?? "";
  const cr = current.endsWith("\r") ? "\r" : "";
  lines[heading.line] =
    `${indent}${marker} ${newTitle.replace(/[\r\n]+/g, " ").trim()}${suffix}${cr}`;
  return fmText + lines.join("\n");
}
