// A title is one line of inline Markdown. This is the reading of that line the renderer is handed,
// and the rewrite of the `[[links]]` in it when the note they name is renamed. Both read the line
// the same way: an escape, a code span, a wikilink and an inline link are each one piece.

// The characters Markdown lets a backslash escape: written `\*`, a `*` is read as itself.
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/** Whether the backslash at `i` escapes the character after it. */
const escapes = (s: string, i: number) =>
  s[i] === "\\" && i + 1 < s.length && ESCAPABLE.includes(s.charAt(i + 1));

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

/** The index of the `]` closing the `[` at `open`, counting the pairs nested inside it. */
function labelEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; ) {
    const end = atomEnd(s, i);
    if (end > i) {
      i = end;
      continue;
    }
    if (s[i] === "[") depth++;
    else if (s[i] === "]" && --depth === 0) return i;
    i++;
  }
  return -1;
}

const skipSpaces = (s: string, i: number) => {
  while (s[i] === " " || s[i] === "\t") i++;
  return i;
};

/** Where the `<address>` opening at `i` ends, or -1 when it never closes. */
function angleAddressEnd(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    if (escapes(s, j)) j++;
    else if (s[j] === ">") return j + 1;
    else if (s[j] === "<") return -1;
  }
  return -1;
}

/** Where the address starting at `i` ends: at white space, or at the `)` that closes the link. */
function bareAddressEnd(s: string, i: number): number {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    if (escapes(s, j)) {
      j++;
      continue;
    }
    const c = s.charAt(j);
    if (c <= " " || c === "\u007f") break;
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  return depth === 0 ? j : -1;
}

/** Where the link's caption (`"…"`, `'…'` or `(…)`) opening at `i` ends, or -1 when it never does. */
function captionEnd(s: string, i: number): number {
  const opener = s.charAt(i);
  const closer = opener === "(" ? ")" : opener;
  for (let j = i + 1; j < s.length; j++) {
    if (escapes(s, j)) j++;
    else if (s[j] === closer) return j + 1;
    else if (opener === "(" && s[j] === "(") return -1;
  }
  return -1;
}

/**
 * Where the `(address "caption")` of an inline link ends, given the index of its `(`, or -1 when
 * what stands there is not one. Read the way CommonMark reads it, because a parenthesis is only
 * structure outside an `<address>` and outside a caption: `(<a(b.png>)` and `(a.png "see (1")`
 * are each one whole link.
 */
function linkTailEnd(s: string, open: number): number {
  let i = skipSpaces(s, open + 1);
  i = s[i] === "<" ? angleAddressEnd(s, i) : bareAddressEnd(s, i);
  if (i === -1) return -1;
  const spaced = skipSpaces(s, i);
  if (spaced > i && spaced < s.length && "\"'(".includes(s.charAt(spaced))) {
    const captioned = captionEnd(s, spaced);
    if (captioned === -1) return -1;
    i = skipSpaces(s, captioned);
  } else {
    i = spaced;
  }
  return s[i] === ")" ? i + 1 : -1;
}

/** An inline link, `[label](address "caption")`, as the parts a rewrite keeps apart. */
interface InlineLink {
  label: string;
  /** Everything between the parentheses, kept as typed. */
  inside: string;
  end: number;
}

/** The inline link whose label opens at `open`, or null when none does. */
function inlineLinkAt(s: string, open: number): InlineLink | null {
  // `[[note]]` is a wikilink, whatever follows it.
  if (s[open] !== "[" || wikilinkEnd(s, open) !== -1) return null;
  const close = labelEnd(s, open);
  if (close === -1 || s[close + 1] !== "(") return null;
  const end = linkTailEnd(s, close + 1);
  if (end === -1) return null;
  return { label: s.slice(open + 1, close), inside: s.slice(close + 2, end - 1), end };
}

/** Where the `[[wikilink]]` opening at `i` ends, or -1 when none opens there. */
function wikilinkEnd(s: string, i: number): number {
  if (!s.startsWith("[[", i)) return -1;
  const close = s.indexOf("]]", i + 2);
  return close === -1 ? -1 : close + 2;
}

/** Whether `s` holds an inline link anywhere in it. A link cannot hold another one. */
function holdsLink(s: string): boolean {
  for (let i = 0; i < s.length; ) {
    const end = atomEnd(s, i);
    if (end > i) i = end;
    else if (inlineLinkAt(s, i)) return true;
    else i++;
  }
  return false;
}

// `<https://…>` and `<name@host>`: links, and the only uses of `<…>` a title keeps as markup.
const AUTOLINK_AT_RE = /^<(?:[a-z][a-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/i;
/** A web address typed bare, as the renderer links it: from its scheme to the next white space. */
export const BARE_URL_SOURCE = String.raw`https?:\/\/[^\s<>"]+`;
const BARE_URL_AT_RE = new RegExp(`^${BARE_URL_SOURCE}`, "i");

/**
 * Where the web address standing at `i` ends, written `<address>` or bare, or `i` when none
 * stands there. It is one piece, like a code span: a `[[` inside it is part of the address.
 */
function addressEnd(s: string, i: number): number {
  const c = s.charAt(i);
  if (c !== "<" && c !== "h" && c !== "H") return i;
  const found = (c === "<" ? AUTOLINK_AT_RE : BARE_URL_AT_RE).exec(s.slice(i));
  return found ? i + found[0].length : i;
}
// What follows a `<` that opens a tag, a comment or a declaration.
const HTML_AFTER_RE = /^[a-z/!?]/i;
// What would end a label early or draw something inside one, in an address shown as the label.
const LABEL_UNSAFE_RE = /[\\[\]<>`!]/g;

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

/**
 * What stands between a link's parentheses, as it goes to the renderer. An `<address>` is kept to
 * the letter. Anywhere else a `<` that could open a tag is escaped, which reads the same inside a
 * link and shows as typed should the renderer not take the whole for a link (it refuses a
 * `javascript:` address, for one).
 */
function linkInside(inside: string): string {
  const start = skipSpaces(inside, 0);
  const kept = inside[start] === "<" ? angleAddressEnd(inside, start) : start;
  let out = inside.slice(0, kept);
  for (let i = kept; i < inside.length; ) {
    const open =
      !escapes(inside, i) && inside[i] === "<" && HTML_AFTER_RE.test(inside.charAt(i + 1));
    const end = escapes(inside, i) ? i + 2 : i + 1;
    out += open ? "\\<" : inside.slice(i, end);
    i = end;
  }
  return out;
}

/**
 * An inline link, or an image written as the link it wraps. A label that holds a link of its own
 * makes the outer brackets text, as the renderer reads them, so what follows is read on as text
 * too.
 */
function linkAt(s: string, i: number): Piece | null {
  const image = s.startsWith("![", i);
  const open = image ? i + 1 : i;
  const link = inlineLinkAt(s, open);
  if (!link) return null;
  const address = /^<([^>]*)>|^\S*/.exec(link.inside.trim());
  const named = (address?.[1] ?? address?.[0] ?? "").replace(LABEL_UNSAFE_RE, "\\$&");
  const label = inlineOnly(link.label) || (image ? named : "");
  if (holdsLink(label)) return { text: `[${label}]`, end: open + link.label.length + 2 };
  return { text: `[${label}](${linkInside(link.inside)})`, end: link.end };
}

/** `![[note]]`: without its mark it is the wikilink, which is read on from here. */
function embedMarkAt(s: string, i: number): Piece | null {
  return s[i] === "!" && wikilinkEnd(s, i + 1) !== -1 ? { text: "", end: i + 1 } : null;
}

/** A `<`: kept with what it opens when that is an autolink, escaped when it would open HTML. */
function angleAt(s: string, i: number): Piece | null {
  if (s[i] !== "<") return null;
  const rest = s.slice(i);
  const kept = AUTOLINK_AT_RE.exec(rest);
  if (kept) return { text: kept[0], end: i + kept[0].length };
  return HTML_AFTER_RE.test(rest.slice(1, 2)) ? { text: "\\<", end: i + 1 } : null;
}

/** Obsidian's `%%`, which hides what follows it. */
function commentAt(s: string, i: number): Piece | null {
  return s.startsWith("%%", i) ? { text: "\\%\\%", end: i + 2 } : null;
}

/** Whether `out` ends in a `!` that no backslash escapes. */
function endsInBang(out: string): boolean {
  if (!out.endsWith("!")) return false;
  let slashes = 0;
  while (out[out.length - 2 - slashes] === "\\") slashes++;
  return slashes % 2 === 0;
}

/**
 * One line of a title with everything that is not inline text taken out of the renderer's reach.
 * An image or an embed is written as the link it wraps, raw HTML is escaped so it shows as typed,
 * and so is Obsidian's `%%`. Code spans and escapes are kept as they are.
 *
 * Two rules hold whatever the pieces were read as, so that a line read differently by the
 * renderer still draws nothing but text: a `!` never stands bare before a `[`, which is the only
 * way an image or an embed opens; and a `<` that could open a tag stands bare only as the address
 * of a link this reading and the renderer's agree on.
 */
function inlineOnly(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const piece = atomAt(s, i) ??
      embedMarkAt(s, i) ??
      linkAt(s, i) ??
      angleAt(s, i) ??
      commentAt(s, i) ?? { text: s.charAt(i), end: i + 1 };
    if (piece.text.startsWith("[") && endsInBang(out)) out = `${out.slice(0, -1)}\\!`;
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

/** A wikilink's inside, `linkpath#heading|alias`, pointed at `to`. */
function retargeted(inner: string, to: string): string {
  const rest = inner.search(/[#|]/);
  const linkpath = rest === -1 ? inner : inner.slice(0, rest);
  const tail = rest === -1 ? "" : inner.slice(rest);
  // A link that had to be given its folder would show the folder. It is given the alias the
  // plain link read as, unless it already says how it reads or was written with a folder before.
  const reads =
    to.includes("/") && !linkpath.includes("/") && !tail.includes("|")
      ? `|${to.slice(to.lastIndexOf("/") + 1)}${tail.replace(/#/g, " > ")}`
      : "";
  return `${to}${tail}${reads}`;
}

/**
 * `title` with each `[[wikilink]]` to a note that `moved` names pointed at `to` instead, the
 * way a link-aware rename rewrites one in a note's text: its `#heading`, its `|alias` and its
 * embed mark are kept. A link typed inside a code span is text, and stays; so does the address
 * and the caption of a Markdown link, and a web address typed as `<address>` or bare, where `[[`
 * is part of the address.
 */
export function retargetTitleLinks(
  title: string,
  moved: (linkpath: string) => boolean,
  to: string,
): string {
  let out = "";
  for (let i = 0; i < title.length; ) {
    const atom = atomEnd(title, i);
    const link = atom === i ? inlineLinkAt(title, i) : null;
    const close = atom === i ? wikilinkEnd(title, i) : -1;
    if (link) {
      out += `[${retargetTitleLinks(link.label, moved, to)}](${link.inside})`;
      i = link.end;
    } else if (close !== -1) {
      const inner = title.slice(i + 2, close - 2);
      const linkpath = inner.split(/[#|]/, 1)[0] ?? "";
      out += `[[${moved(linkpath.trim()) ? retargeted(inner, to) : inner}]]`;
      i = close;
    } else {
      const next = Math.max(atom, addressEnd(title, i), i + 1);
      out += title.slice(i, next);
      i = next;
    }
  }
  return out;
}
