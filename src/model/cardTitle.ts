// A card has one title. The file is named after it, and the file's basename stays the card's
// identity (it is what `[[wikilinks]]` bind to). A title the file name cannot hold exactly — a
// link, a character a file name refuses, a name already taken, a title too long — is kept whole in
// the `title` frontmatter key, beside a file named with the text that could be kept.

import { SECTION, splitFrontmatter } from "./card";
import { fencedLines } from "./fences";
import type { CardFrontmatter, TitleMode, TitleSource } from "./types";

/** The frontmatter key holding a title its file name cannot spell. */
export const TITLE_KEY = "title";

const TITLE_MODES: readonly TitleMode[] = ["filename", "heading"];

/**
 * A title as it is stored: one line, single spaces, and composed characters. The last is what
 * lets a title be compared with a file name: macOS hands `é` back as `e` plus an accent, and a
 * title typed either way must read as the same title.
 */
export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().normalize("NFC");
}

/** Whether two titles are the same text, however their accented characters are composed. */
export function sameTitle(a: string, b: string): boolean {
  return a.normalize("NFC") === b.normalize("NFC");
}

/**
 * The file name a typed name actually becomes: Obsidian (and the filesystems under it) refuse
 * `\ / : * ? " < > |`, and `# ^ [ ]` carry meaning inside a `[[wikilink]]`, so a name containing
 * them would not link back. A name left with nothing usable still has to be a file, hence the
 * fallback.
 */
export function sanitizeFilename(name: string): string {
  const base = name
    // Before the control characters go: a tab or a line break is one of them, and it is a space.
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex -- control characters are what is being removed
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/g, "")
    .replace(/ {2,}/g, " ")
    // A leading dot hides the file; Windows drops a trailing dot or space from a name.
    .replace(/^[. ]+|[. ]+$/g, "")
    // Device names Windows will not let a file have, whatever follows the first dot.
    .replace(/^(con|prn|aux|nul|com\d|lpt\d)(?=\.|$)/i, "$1 card");
  return base || "Untitled card";
}

/** The longest file name a card is given; a longer title keeps its whole text in `title`. */
export const FILE_NAME_CHARS = 100;
// A name is at most 255 bytes on Linux, macOS and Android; this leaves room for `.md` and a
// number added to tell two notes apart.
const FILE_NAME_BYTES = 200;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** A string as the characters a person counts, so a cut never lands inside an emoji or an accent. */
function characters(s: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)).map(
    (g) => g.segment,
  );
}

/** Cut a file name to what every platform can hold, at a word boundary when one is near. */
export function fitFileName(name: string, maxChars: number = FILE_NAME_CHARS): string {
  const chars = characters(name);
  if (chars.length <= maxChars && utf8Length(name) <= FILE_NAME_BYTES) return name;
  let kept = chars.slice(0, maxChars);
  while (utf8Length(kept.join("")) > FILE_NAME_BYTES) kept = kept.slice(0, -1);
  let cut = kept.join("");
  const space = cut.lastIndexOf(" ");
  if (space > cut.length * 0.6) cut = cut.slice(0, space);
  return cut.replace(/[. ]+$/, "") || "Untitled card";
}

// The characters Markdown lets a backslash escape: written `\*`, a `*` is read as itself.
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const ESCAPED_RE = /\\([!-/:-@[-`{-~])/g;
// Where an escaped character waits while the markup around it is read, and what marks the place
// of a code span set aside: Unicode's noncharacters, which no text is ever written in.
const HELD_AT = 0xfdd0;
const HELD_RE = /[\ufdd0-\ufdef]/g;
const CODE_AT = "\uffff";
const CODE_AT_RE = /\uffff(\d+)\uffff/g;

const WIKILINK_RE = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
// One level of brackets inside the address, which is as far as a pasted URL goes in practice.
const MARKDOWN_LINK_RE = /!?\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))*)[^)]*\)/g;
const AUTOLINK_RE = /<(https?:\/\/[^\s<>]+)>/g;
const CODE_SPAN_RE = /(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
// Emphasis as CommonMark opens and closes it: the markers hug the words, and an underscore
// inside a word (`snake_case_name`) is a letter, not a marker.
const EMPHASIS_RES: readonly RegExp[] = [
  /\*\*(?=\S)(.+?)(?<=\S)\*\*/g,
  /(?<![\p{L}\p{N}])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}])/gu,
  /\*(?=\S)(.+?)(?<=\S)\*/g,
  /(?<![\p{L}\p{N}])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/gu,
  /~~(?=\S)(.+?)(?<=\S)~~/g,
  /==(?=\S)(.+?)(?<=\S)==/g,
];

/** Inline Markdown as the plain text it reads as: a link is its label, emphasis is its words. */
export function plainTitleText(raw: string): string {
  // Most titles carry no markup at all, and this is asked of every card on every search.
  if (!/[\\`*_~=[<]/.test(raw)) return raw.trim();
  const held = raw.replace(ESCAPED_RE, (_, c: string) =>
    String.fromCharCode(HELD_AT + ESCAPABLE.indexOf(c)),
  );
  // Code is read first and set aside, so the markup characters inside it stay what was typed.
  const code: string[] = [];
  let text = held.replace(CODE_SPAN_RE, (_, _ticks: string, inner: string) => {
    code.push(inner.trim());
    return `${CODE_AT}${code.length - 1}${CODE_AT}`;
  });
  text = text
    .replace(WIKILINK_RE, (_, target: string, alias: string | undefined) => alias ?? target)
    .replace(MARKDOWN_LINK_RE, (_, label: string, address: string) => label || address)
    .replace(AUTOLINK_RE, "$1");
  for (const re of EMPHASIS_RES) text = text.replace(re, "$1");
  return text
    .replace(CODE_AT_RE, (_, i: string) => code[Number(i)] ?? "")
    .replace(HELD_RE, (c) => ESCAPABLE[c.charCodeAt(0) - HELD_AT] ?? "")
    .trim();
}

const BARE_URL_RE = /https?:\/\/[^\s<>"]+/gi;

/** A web address as the words a file name can carry: its host, then each step of its path. */
function urlWords(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A path that is not valid percent-encoding is kept as it was written.
  }
  return [parsed.hostname.replace(/^www\./i, ""), ...path.split("/")].filter(Boolean).join(" ");
}

/**
 * The file name a title asks for: what it reads as, less what a file name cannot hold. A web
 * address is named by its host and path (`https://example.com/a/b?c=d` is `example.com a b`),
 * since with its punctuation merely removed it reads as one unbroken run of letters.
 */
export function titleFileName(title: string): string {
  return sanitizeFilename(plainTitleText(title).replace(BARE_URL_RE, urlWords));
}

/** Whether a title carries Markdown that draws differently from its source text. */
export function hasInlineMarkdown(title: string): boolean {
  // `test` on a global expression remembers where it stopped; `search` does not.
  return plainTitleText(title) !== title.trim() || title.search(BARE_URL_RE) !== -1;
}

// What would open a block when it starts a line: a heading, a quote, a list, a rule, a code or
// math fence. A numbered list is told apart below, since its marker is escaped after the number.
const BLOCK_START_RE =
  /^(?:#{1,6}(?:\s|$)|>|[-+*](?:\s|$)|`{3,}|~{3,}|\$\$|([-*_])(?:\s*\1){2,}\s*$)/;

/**
 * A title as the Markdown handed to the renderer. A title is one line of inline text, so what
 * would open a block is escaped and shows as typed, and an embed (`![[note]]`, `![](image)`),
 * which would draw a whole note or a picture inside a tile, is read as the link it wraps.
 */
export function titleMarkdown(title: string): string {
  const line = title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/!\[\[/g, "[[")
    .replace(
      /!\[([^\]]*)\]\(([^)\s]*)([^)]*)\)/g,
      (_, label: string, address: string, rest: string) =>
        `[${label || address}](${address}${rest})`,
    );
  if (BLOCK_START_RE.test(line)) return `\\${line}`;
  return line.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
}

/** Normalize a raw `card-title` frontmatter value; anything but `heading` means the file name. */
export function asTitleMode(raw: unknown): TitleMode {
  return typeof raw === "string" && (TITLE_MODES as readonly string[]).includes(raw)
    ? (raw as TitleMode)
    : "filename";
}

// CommonMark shape, because that is what Obsidian renders: an ATX heading may be indented by up
// to three spaces.
const HEADING_RE = /^( {0,3})(#{1,6})[ \t]+(.*?)([ \t]*#*[ \t]*)\r?$/;

/**
 * The section headings the card parser owns (`## Subtasks`, `## Comments`, `## History`). They are
 * never title candidates: retitling one would rewrite the heading `parseSubtasks` and friends look
 * for, silently detaching a card's subtasks, comments or history.
 */
const RESERVED_HEADINGS: ReadonlySet<string> = new Set(
  Object.values(SECTION).map((s) => s.toLowerCase()),
);

interface Heading {
  /** Index into the body's `split("\n")` lines. */
  line: number;
  text: string;
}

/** The note's first heading (any level, outside code fences) that is not one the plugin owns. */
function firstHeading(body: string): Heading | null {
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const text = (HEADING_RE.exec(lines[i] ?? "")?.[3] ?? "").trim();
    if (text && !RESERVED_HEADINGS.has(plainTitleText(text).toLowerCase()))
      return { line: i, text };
  }
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
 * A card's title: the `title` key when the note has one, else the file name. A board that sets
 * `card-title: heading` reads the note's first heading before the file name.
 */
export function resolveTitle(
  basename: string,
  frontmatter: CardFrontmatter,
  text: string,
  mode: TitleMode,
): ResolvedTitle {
  const fromFrontmatter = frontmatterTitle(frontmatter);
  if (fromFrontmatter !== null) return { title: fromFrontmatter, source: "frontmatter" };
  const heading = mode === "heading" ? firstHeading(splitFrontmatter(text).body) : null;
  if (heading) return { title: heading.text, source: "heading" };
  return { title: basename, source: "filename" };
}

/**
 * Rewrite the text of the note's first heading, keeping its `#` marker and every other byte.
 * Returns the text unchanged when the note has no heading.
 */
export function setHeadingTitle(text: string, newTitle: string): string {
  const { fmText, body } = splitFrontmatter(text);
  const heading = firstHeading(body);
  if (!heading) return text;
  const lines = body.split("\n");
  const current = lines[heading.line] ?? "";
  const m = HEADING_RE.exec(current);
  const indent = m?.[1] ?? "";
  const marker = m?.[2] ?? "#";
  const suffix = m?.[4] ?? "";
  const cr = current.endsWith("\r") ? "\r" : "";
  lines[heading.line] =
    `${indent}${marker} ${newTitle.replace(/[\r\n]+/g, " ").trim()}${suffix}${cr}`;
  return fmText + lines.join("\n");
}

const folded = (s: string) => normalizeTitle(s).toLowerCase();

/**
 * The note without its top `# heading`, when that heading only repeats the card's title; `null`
 * when there is nothing to remove. "Top" is the body's first line of text, where cards made before
 * a card had one title were given theirs. A heading that says more than the title (a link the
 * title does not carry, a character its file name could not hold) is not a repeat and stays.
 */
export function withoutRepeatedHeading(text: string, title: string): string | null {
  const { fmText, body } = splitFrontmatter(text);
  const lines = body.split("\n");
  const blank = (i: number) => (lines[i] ?? "").trim() === "";
  const at = lines.findIndex((_, i) => !blank(i));
  const m = HEADING_RE.exec(lines[at] ?? "");
  if (m?.[2] !== "#") return null;
  const heading = folded(m[3] ?? "");
  if (heading !== folded(title) && heading !== folded(plainTitleText(title))) return null;
  // The blank lines that set the heading apart from the text under it go with it.
  let end = at + 1;
  while (end < lines.length && blank(end)) end++;
  lines.splice(at, end - at);
  return fmText + lines.join("\n");
}
