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

/**
 * Why a heading was or was not read, alongside the heading itself. The reason is part of the
 * answer rather than something a caller re-derives: `resolveTitle` turns it into the sentence a
 * reader sees, and nothing outside this file gets to have its own opinion about when a heading
 * counts.
 */
type HeadingLookup =
  | { consulted: false; why: "mode-filename" | "name-reads-as-name" }
  | { consulted: true; why: "mode-heading" | "name-reads-as-slug"; heading: Heading | null };

/** Whether a given mode reads a heading for this card at all, and which one it lands on. */
function headingFor(body: string, basename: string, mode: TitleMode): HeadingLookup {
  if (mode === "heading")
    return { consulted: true, why: "mode-heading", heading: findHeading(body, ANY_HEADING) };
  if (mode === "filename") return { consulted: false, why: "mode-filename" };
  return looksLikeSlug(basename)
    ? { consulted: true, why: "name-reads-as-slug", heading: findHeading(body, looksLikeTitle) }
    : { consulted: false, why: "name-reads-as-name" };
}

/** The heading a mode actually takes the title from, or null when it reads none (or finds none). */
function selectedHeading(body: string, basename: string, mode: TitleMode): Heading | null {
  const lookup = headingFor(body, basename, mode);
  return lookup.consulted ? lookup.heading : null;
}

function frontmatterTitle(frontmatter: CardFrontmatter): string | null {
  const v = frontmatter[TITLE_KEY];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The three sources `resolveTitle` can pick from, in the order it asks them. */
export type TitleDecisionSource = Extract<TitleSource, "frontmatter" | "heading" | "filename">;

/** What each source is called wherever a person reads about it — a field label, or a trace row. */
export const TITLE_SOURCE_LABEL: Record<TitleDecisionSource, string> = {
  frontmatter: "Override card title",
  heading: "First heading in the note",
  filename: "File name",
};

/** One source's turn in the decision: what it answered, and how that settled things. */
export interface TitleStep {
  source: TitleDecisionSource;
  /** What the source offered, or null when it had nothing (or was never asked). */
  value: string | null;
  outcome: "won" | "empty" | "skipped";
  /** One plain sentence, for a reader who has never seen the code. */
  reason: string;
}

export interface ResolvedTitle {
  title: string;
  source: TitleSource;
  /**
   * The decision as it actually ran: one step per source consulted, in order, ending with the
   * winner. Written here so anything that explains a title reads the algorithm's own account of
   * itself rather than keeping a second copy that can drift from it.
   */
  trace: readonly TitleStep[];
}

/** The heading source's own account of its turn: what it found, or why it found nothing. */
function headingStep(lookup: HeadingLookup): TitleStep {
  if (lookup.consulted && lookup.heading)
    return {
      source: "heading",
      value: lookup.heading.text,
      outcome: "won",
      reason:
        lookup.why === "mode-heading"
          ? "Taken from the note's first heading, because this board titles cards by heading."
          : "Taken from the note's first heading, because the file name reads like a slug.",
    };
  if (lookup.consulted)
    return {
      source: "heading",
      value: null,
      outcome: "empty",
      reason:
        lookup.why === "mode-heading"
          ? "The note has no heading to take a title from."
          : "The file name reads like a slug, but no heading in the note reads as a title.",
    };
  return {
    source: "heading",
    value: null,
    outcome: "skipped",
    reason:
      lookup.why === "mode-filename"
        ? "This board titles cards by file name, so no heading is read."
        : "The file name reads as a name rather than a slug, so no heading is read.",
  };
}

/** Why the file name ended up answering — which depends on what stopped the heading from doing so. */
function filenameReason(lookup: HeadingLookup): string {
  if (lookup.consulted)
    return "Taken from the file name, because no heading in the note could supply a title.";
  return lookup.why === "mode-filename"
    ? "Taken from the file name, because this board titles cards by file name."
    : "Taken from the file name, because it already reads as a name.";
}

/**
 * Pick a card's displayed title. The card's own `title` frontmatter wins outright; otherwise the
 * board's mode decides whether a heading is consulted; the basename is always the last resort.
 * Each source's turn is appended to the trace as it is taken, so the answer arrives with its own
 * explanation rather than leaving one to be reconstructed elsewhere.
 */
export function resolveTitle(
  basename: string,
  frontmatter: CardFrontmatter,
  text: string,
  mode: TitleMode,
): ResolvedTitle {
  const trace: TitleStep[] = [];
  const fromFrontmatter = frontmatterTitle(frontmatter);
  if (fromFrontmatter !== null) {
    trace.push({
      source: "frontmatter",
      value: fromFrontmatter,
      outcome: "won",
      reason: "Taken from the override, which wins over every other source.",
    });
    return { title: fromFrontmatter, source: "frontmatter", trace };
  }
  trace.push({
    source: "frontmatter",
    value: null,
    outcome: "empty",
    reason: "No override is set on this card, so the next source decides.",
  });

  const lookup = headingFor(splitFrontmatter(text).body, basename, mode);
  trace.push(headingStep(lookup));
  if (lookup.consulted && lookup.heading)
    return { title: lookup.heading.text, source: "heading", trace };

  trace.push({
    source: "filename",
    value: basename,
    outcome: "won",
    reason: filenameReason(lookup),
  });
  return { title: basename, source: "filename", trace };
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
  const heading = selectedHeading(body, basename, mode);
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
