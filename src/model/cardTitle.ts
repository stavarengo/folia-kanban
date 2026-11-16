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

// Every control character but the ones that are white space, which become a space instead.
// eslint-disable-next-line no-control-regex -- control characters are what is being removed
const CONTROL_RE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;

/**
 * A title as it is stored: one line, single spaces, no control characters (a pasted bell or
 * separator is invisible on the board and unwanted in the note), and composed characters. The
 * last is what lets a title be compared with a file name: macOS hands `é` back as `e` plus an
 * accent, and a title typed either way must read as the same title.
 */
export function normalizeTitle(raw: string): string {
  return raw.replace(CONTROL_RE, "").replace(/\s+/g, " ").trim().normalize("NFC");
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
    // Device names Windows will not let a file have, whatever follows the first dot. A port is
    // named with a digit or with one of the superscripts ¹ ² ³.
    .replace(/^(con|prn|aux|nul|conin\$|conout\$|com[\d¹²³]|lpt[\d¹²³])(?=\.|$)/i, "$1 card");
  return base || "Untitled card";
}

/** The longest name a card's file is given from its title; a longer title keeps its whole text in `title`. */
export const FILE_NAME_CHARS = 100;
// A file name is at most 255 bytes on Linux, macOS and Android. This is the most a card's whole
// file name takes, `.md` and the number that tells two notes apart included.
const FILE_NAME_BYTES = 200;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** A string as the characters a person counts, so a cut never lands inside an emoji or an accent. */
function characters(s: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)).map(
    (g) => g.segment,
  );
}

/** How long a name may be: in characters, in UTF-8 bytes, and in the UTF-16 units Windows counts a path in. */
interface NameLimits {
  chars?: number;
  bytes?: number;
  units?: number;
}

/**
 * Cut a name to its limits, at a word boundary when one is near. A cut never lands inside a
 * character, whichever limit asked for it.
 */
export function fitFileName(
  name: string,
  { chars = FILE_NAME_CHARS, bytes = FILE_NAME_BYTES, units = Infinity }: NameLimits = {},
): string {
  const fits = (s: string, count: number) =>
    count <= chars && s.length <= units && utf8Length(s) <= bytes;
  const all = characters(name);
  if (fits(name, all.length)) return name;
  const kept = all.slice(0, Math.max(chars, 0));
  let cut = kept.join("");
  while (kept.length > 0 && !fits(cut, kept.length)) {
    kept.pop();
    cut = kept.join("");
  }
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
// One level of brackets inside the label and inside the address, which is as far as a typed
// label or a pasted URL goes in practice.
const MARKDOWN_LINK_RE = /!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\(((?:[^()\s]|\([^()]*\))*)[^)]*\)/g;
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

/**
 * The whole file name of a card titled `title`. `n` is 0 for the name itself and counts up for
 * each name already taken. Every limit is on the name as the file system gets it, `.md` and number
 * included: 200 bytes, and `room` UTF-16 units, which is what the folder's own path leaves of the
 * longest path this computer allows.
 */
export function cardFileName(title: string, n = 0, room = Infinity): string {
  const tail = `${n > 0 ? ` ${n}` : ""}.md`;
  const name = fitFileName(titleFileName(title), {
    bytes: FILE_NAME_BYTES - utf8Length(tail),
    units: room - tail.length,
  });
  return name + tail;
}

/** Whether a title carries Markdown that draws differently from its source text. */
export function hasInlineMarkdown(title: string): boolean {
  // `test` on a global expression remembers where it stopped; `search` does not.
  return plainTitleText(title) !== title.trim() || title.search(BARE_URL_RE) !== -1;
}

/**
 * Where the backslash escape or the code span that starts at `i` ends, or `i` when neither starts
 * there. Both are read as one piece: nothing inside them is markup.
 */
function atomEnd(s: string, i: number): number {
  if (s[i] === "\\") return Math.min(i + 2, s.length);
  if (s[i] !== "`") return i;
  let open = i;
  while (s[open] === "`") open++;
  for (let j = open; j < s.length; ) {
    if (s[j] !== "`") {
      j++;
      continue;
    }
    let close = j;
    while (s[close] === "`") close++;
    // A code span closes on a run of backticks as long as the one that opened it.
    if (close - j === open - i) return close;
    j = close;
  }
  // Backticks that never close are text.
  return open;
}

/** The index of the bracket closing the one at `open`, counting the pairs nested inside it. */
function closingBracket(s: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < s.length; ) {
    const end = atomEnd(s, i);
    if (end > i) {
      i = end;
      continue;
    }
    if (s[i] === opener) depth++;
    else if (s[i] === closer && --depth === 0) return i;
    i++;
  }
  return -1;
}

/** The inline link `[label](address …)` whose label opens at `open`, or null when none does. */
function inlineLinkAt(
  s: string,
  open: number,
): { label: string; inside: string; end: number } | null {
  const labelEnd = closingBracket(s, open, "[", "]");
  if (labelEnd === -1 || s[labelEnd + 1] !== "(") return null;
  const end = closingBracket(s, labelEnd + 1, "(", ")");
  if (end === -1) return null;
  return {
    label: s.slice(open + 1, labelEnd),
    inside: s.slice(labelEnd + 2, end),
    end: end + 1,
  };
}

// `<https://…>` and `<name@host>`: links, and the only uses of `<…>` a title keeps as markup.
const AUTOLINK_AT_RE = /^<(?:[a-z][a-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/i;
// What follows a `<` that opens a tag, a comment or a declaration.
const HTML_AFTER_RE = /^[a-z/!?]/i;

/** A stretch of a title as it goes to the renderer, and where reading goes on after it. */
interface Piece {
  text: string;
  end: number;
}

/** An escape or a code span, kept as it is. */
function atomAt(s: string, i: number): Piece | null {
  const end = atomEnd(s, i);
  return end > i ? { text: s.slice(i, end), end } : null;
}

/** An embed or an image, written as the link it wraps. */
function embedAt(s: string, i: number): Piece | null {
  if (!s.startsWith("![", i)) return null;
  // `![[note]]`: without its mark it is the wikilink, which is read on from here.
  if (s.startsWith("[[", i + 1) && s.includes("]]", i + 3)) return { text: "", end: i + 1 };
  const image = inlineLinkAt(s, i + 1);
  if (!image) return null;
  const address = /^<([^>]*)>|^\S*/.exec(image.inside.trim());
  const label = inlineOnly(image.label) || (address?.[1] ?? address?.[0] ?? "");
  return { text: `[${label}](${image.inside})`, end: image.end };
}

/** A `<`: kept with what it opens when that is a link's, escaped when it would open HTML. */
function angleAt(s: string, i: number, before: string): Piece | null {
  if (s[i] !== "<") return null;
  const rest = s.slice(i);
  // An address in angle brackets, `[label](<a b.md>)`, is the link's and is kept whole.
  const kept = before.endsWith("](") ? /^<[^<>]*>/.exec(rest) : AUTOLINK_AT_RE.exec(rest);
  if (kept) return { text: kept[0], end: i + kept[0].length };
  return HTML_AFTER_RE.test(rest.slice(1, 2)) ? { text: "\\<", end: i + 1 } : null;
}

/** Obsidian's `%%`, which hides what follows it. */
function commentAt(s: string, i: number): Piece | null {
  return s.startsWith("%%", i) ? { text: "\\%\\%", end: i + 2 } : null;
}

/**
 * One line of a title with everything that is not inline text taken out of the renderer's reach.
 * An image or an embed is written as the link it wraps, raw HTML is escaped so it shows as typed,
 * and so is Obsidian's `%%`. Code spans and escapes are kept as they are.
 */
function inlineOnly(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const piece = atomAt(s, i) ??
      embedAt(s, i) ??
      angleAt(s, i, out) ??
      commentAt(s, i) ?? { text: s.charAt(i), end: i + 1 };
    out += piece.text;
    i = piece.end;
  }
  return out;
}

// What would open a block when it starts a line: a heading, a quote, a list, a rule, a code or
// math fence. A numbered list is told apart below, since its marker is escaped after the number.
const BLOCK_START_RE =
  /^(?:#{1,6}(?:\s|$)|>|[-+*](?:\s|$)|`{3,}|~{3,}|\$\$|([-*_])(?:\s*\1){2,}\s*$)/;
// A link reference definition or a footnote: a whole line that draws nothing where it stands.
const DEFINITION_RE = /^\[[^\]]+\]:/;

/**
 * A title as the Markdown handed to the renderer. A title is one line of inline text, so what
 * would open a block is escaped and shows as typed, raw HTML shows as typed, and an image or an
 * embed (`![](image)`, `![[note]]`), which would draw a picture or a whole note inside a tile, is
 * read as the link it wraps.
 */
export function titleMarkdown(title: string): string {
  const line = inlineOnly(title.replace(/\s+/g, " ").trim());
  if (BLOCK_START_RE.test(line) || DEFINITION_RE.test(line)) return `\\${line}`;
  return line.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
}

/**
 * `title` with each `[[wikilink]]` to a note that `moved` names pointed at `to` instead, the
 * way a link-aware rename rewrites one in a note's text: its `#heading`, its `|alias` and its
 * embed mark are kept. A link typed inside a code span is text, and stays.
 */
export function retargetTitleLinks(
  title: string,
  moved: (linkpath: string) => boolean,
  to: string,
): string {
  let out = "";
  for (let i = 0; i < title.length; ) {
    const atom = atomEnd(title, i);
    const close = atom === i && title.startsWith("[[", i) ? title.indexOf("]]", i + 2) : -1;
    if (close === -1) {
      const next = Math.max(atom, i + 1);
      out += title.slice(i, next);
      i = next;
      continue;
    }
    const inner = title.slice(i + 2, close);
    const rest = inner.search(/[#|]/);
    const linkpath = rest === -1 ? inner : inner.slice(0, rest);
    out += moved(linkpath.trim())
      ? `[[${to}${rest === -1 ? "" : inner.slice(rest)}]]`
      : `[[${inner}]]`;
    i = close + 2;
  }
  return out;
}

/** Normalize a raw `card-title` frontmatter value; anything but `heading` means the file name. */
export function asTitleMode(raw: unknown): TitleMode {
  return typeof raw === "string" && (TITLE_MODES as readonly string[]).includes(raw)
    ? (raw as TitleMode)
    : "filename";
}

// CommonMark shape, because that is what Obsidian renders: an ATX heading may be indented by up
// to three spaces, and a run of hashes closes it only when white space comes before the run, so
// `# C#` is the heading "C#". The last group is that closing run with the space around it.
const HEADING_RE = /^( {0,3})(#{1,6})[ \t]+(.*?)((?:[ \t]+|(?<=[ \t]))#+[ \t]*|[ \t]*)\r?$/;

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
 * How rewriting the heading a card's title is read from went: the note's new text, or why the
 * heading could not take the title. `moved` is a heading that is gone or says something else than
 * the title being replaced (`found` is what it says now); `unreadable` is a title the board would
 * not read back from the heading (`readsAs` is what it would read instead).
 */
export type HeadingRetitle =
  | { text: string }
  | { refused: "moved"; found: string | null }
  | { refused: "unreadable"; readsAs: string | null };

/** The heading line `line` with `text` for its words: its indent, marker and closing hashes kept. */
function withHeadingText(line: string, text: string): string {
  const m = HEADING_RE.exec(line);
  if (!m) return line;
  const [, indent = "", marker = "#", , suffix = ""] = m;
  return `${indent}${marker} ${text}${suffix}${line.endsWith("\r") ? "\r" : ""}`;
}

const headingText = (heading: Heading | null) => (heading === null ? null : heading.text);

/**
 * Rewrite the text of the note's first heading from the title `from` to the title `to`, keeping
 * its `#` marker and every other byte. Refused, with the note left as it is, when that heading is
 * no longer the one `from` was read from, and when the heading written would not be read back as
 * `to`: either way the card would not end up with the title that was asked for.
 */
export function retitleHeading(text: string, from: string, to: string): HeadingRetitle {
  const { fmText, body } = splitFrontmatter(text);
  const heading = firstHeading(body);
  if (heading === null || !sameTitle(heading.text, from))
    return { refused: "moved", found: headingText(heading) };
  const wanted = to.replace(/[\r\n]+/g, " ").trim();
  const lines = body.split("\n");
  lines[heading.line] = withHeadingText(lines[heading.line] ?? "", wanted);
  const written = lines.join("\n");
  const readBack = firstHeading(written);
  if (readBack === null || readBack.line !== heading.line || !sameTitle(readBack.text, wanted))
    return { refused: "unreadable", readsAs: headingText(readBack) };
  return { text: fmText + written };
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
