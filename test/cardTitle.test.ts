import { describe, expect, it } from "vitest";
import {
  FILE_NAME_CHARS,
  asTitleMode,
  fitFileName,
  hasInlineMarkdown,
  normalizeTitle,
  plainTitleText,
  resolveTitle,
  sameTitle,
  sanitizeFilename,
  setHeadingTitle,
  titleFileName,
  titleMarkdown,
  withoutRepeatedHeading,
} from "../src/model/cardTitle";

const slugNote = `---
status: todo
---

# Fix the export path on Windows

Some context.

## Subtasks
- [ ] one
`;

// "é" as one character, and as "e" followed by a combining accent: what macOS hands back.
const NFC = "Café";
const NFD = "Café";

describe("normalizeTitle and sameTitle", () => {
  it("stores a title as one line with single spaces", () => {
    expect(normalizeTitle("  Fix \t the\n export  ")).toBe("Fix the export");
  });
  it("composes accented characters, so a title typed either way is one title", () => {
    expect(normalizeTitle(NFD)).toBe(NFC);
    expect(sameTitle(NFD, NFC)).toBe(true);
    expect(sameTitle("plan", "Plan")).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("drops what a file name or a wikilink cannot hold", () => {
    expect(sanitizeFilename('a\\b/c:d*e?f"g<h>i|j#k^l[m]n')).toBe("abcdefghijklmn");
  });
  it("drops control characters", () => {
    expect(sanitizeFilename("tab\there\u0000 and\u007f bell\u0007")).toBe("tab here and bell");
  });
  it("drops leading dots, which would hide the file", () => {
    expect(sanitizeFilename("...hidden")).toBe("hidden");
    expect(sanitizeFilename(". .env")).toBe("env");
  });
  it("drops trailing dots and spaces, which Windows removes from a name", () => {
    expect(sanitizeFilename("Ship it. . ")).toBe("Ship it");
  });
  it("renames a Windows device name, whatever its case or what follows the first dot", () => {
    expect(sanitizeFilename("CON")).toBe("CON card");
    expect(sanitizeFilename("nul")).toBe("nul card");
    expect(sanitizeFilename("Com1")).toBe("Com1 card");
    expect(sanitizeFilename("LPT9.backup")).toBe("LPT9 card.backup");
    expect(sanitizeFilename("Console")).toBe("Console");
    expect(sanitizeFilename("CON artist")).toBe("CON artist");
  });
  it("falls back to a name when nothing usable is left", () => {
    expect(sanitizeFilename("???")).toBe("Untitled card");
    expect(sanitizeFilename(" . ")).toBe("Untitled card");
  });
});

describe("fitFileName", () => {
  it("leaves a name that fits untouched", () => {
    expect(fitFileName("Fix the export path")).toBe("Fix the export path");
    expect(fitFileName("x".repeat(FILE_NAME_CHARS))).toHaveLength(FILE_NAME_CHARS);
  });
  it("cuts a long name at a word boundary within 100 characters", () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const cut = fitFileName(long);
    expect(cut.length).toBeLessThanOrEqual(FILE_NAME_CHARS);
    expect(long.startsWith(cut + " ")).toBe(true);
  });
  it("cuts mid-word when no word boundary is near", () => {
    expect(fitFileName("x".repeat(250))).toBe("x".repeat(FILE_NAME_CHARS));
  });
  it("keeps a name within 200 bytes of UTF-8, however few characters that is", () => {
    const cut = fitFileName("語".repeat(90));
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(200);
    expect(cut).toBe("語".repeat(66));
  });
  it("never cuts inside an emoji or an accented character", () => {
    const family = "👨‍👩‍👧‍👦";
    const cut = fitFileName(family.repeat(20));
    expect(cut.length % family.length).toBe(0);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(200);
    expect(fitFileName(`${"a".repeat(9)}éz`, 10)).toBe(`${"a".repeat(9)}é`);
  });
  it("honours a tighter limit, for a folder whose path leaves little room", () => {
    expect(fitFileName("Fix the export path on Windows today", 25)).toBe("Fix the export path on");
  });
  it("leaves no trailing dot or space where it cut", () => {
    expect(fitFileName(`${"a".repeat(98)}. bcd`)).toBe("a".repeat(98));
  });
});

describe("plainTitleText", () => {
  it("reads a link as its label", () => {
    expect(plainTitleText("monitor [MR130903](https://gitlab.example/mr/130903)")).toBe(
      "monitor MR130903",
    );
    expect(plainTitleText("[a](https://example.com/a_(b))")).toBe("a");
    expect(plainTitleText("see <https://example.com/x>")).toBe("see https://example.com/x");
  });
  it("reads a wikilink as its alias, or its target", () => {
    expect(plainTitleText("Follow up on [[Release plan|the plan]]")).toBe("Follow up on the plan");
    expect(plainTitleText("Follow up on [[Release plan]]")).toBe("Follow up on Release plan");
  });
  it("reads an embed as the link it wraps", () => {
    expect(plainTitleText("![[Diagram]] review")).toBe("Diagram review");
    expect(plainTitleText("![chart](img/chart.png)")).toBe("chart");
    expect(plainTitleText("![](img/chart.png)")).toBe("img/chart.png");
  });
  it("reads emphasis, strikethrough, highlight and code as their words", () => {
    expect(plainTitleText("**Fix** the *export* __path__ _now_")).toBe("Fix the export path now");
    expect(plainTitleText("~~old~~ ==new== `code`")).toBe("old new code");
  });
  it("leaves alone what Markdown itself reads as plain text", () => {
    expect(plainTitleText("rename snake_case_name")).toBe("rename snake_case_name");
    expect(plainTitleText("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(plainTitleText("a == b")).toBe("a == b");
    expect(plainTitleText("Fix the export path")).toBe("Fix the export path");
  });
  it("keeps the markup characters typed inside code", () => {
    expect(plainTitleText("call `a*b*c` and `x_y_z`")).toBe("call a*b*c and x_y_z");
  });
  it("leaves an icon-font glyph from the private-use area exactly as typed", () => {
    // Escapes are set aside while the markup is read; a glyph must never be taken for one.
    expect(plainTitleText("\ue000 \ue0a0 main \\*kept\\* **bold**")).toBe(
      "\ue000 \ue0a0 main *kept* bold",
    );
  });
  it("reads an escaped character as itself", () => {
    expect(plainTitleText("\\*not emphasis\\*")).toBe("*not emphasis*");
    expect(plainTitleText("\\[not a link\\](x)")).toBe("[not a link](x)");
  });
});

describe("titleFileName", () => {
  it("is the title itself when a file name can hold it", () => {
    expect(titleFileName("Fix the export path")).toBe("Fix the export path");
  });
  it("names the file with what the title reads as", () => {
    expect(titleFileName("monitor [MR130903](https://gitlab.example/mr/130903)")).toBe(
      "monitor MR130903",
    );
    expect(titleFileName("**Ship** it: v2?")).toBe("Ship it v2");
  });
  it("names a web address by its host and path, not by its letters run together", () => {
    expect(titleFileName("https://example.com/abc?x=d")).toBe("example.com abc");
    expect(titleFileName("https://www.github.com/stavarengo/folia-kanban/issues/137#top")).toBe(
      "github.com stavarengo folia-kanban issues 137",
    );
    expect(titleFileName("Read https://example.com/a%20b/c today")).toBe(
      "Read example.com a b c today",
    );
    expect(titleFileName("http://localhost:8080")).toBe("localhost");
  });
  it("still has a name for a title that is all markup", () => {
    expect(titleFileName("[](#)")).toBe("Untitled card");
  });
});

describe("hasInlineMarkdown", () => {
  it("is true for a title that draws differently from its source", () => {
    for (const t of [
      "[MR](https://x.example)",
      "[[Note]]",
      "**bold**",
      "`code`",
      "see https://example.com",
      "![[Embed]]",
    ])
      expect(hasInlineMarkdown(t), t).toBe(true);
  });
  it("is false for plain text, block markers included", () => {
    for (const t of [
      "Fix the export path",
      "snake_case_name",
      "# Not a heading",
      "- item",
      "2 * 3",
    ])
      expect(hasInlineMarkdown(t), t).toBe(false);
  });
  it("answers the same every time it is asked", () => {
    const t = "see https://example.com";
    expect([hasInlineMarkdown(t), hasInlineMarkdown(t), hasInlineMarkdown(t)]).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("titleMarkdown", () => {
  it("hands inline Markdown to the renderer as typed", () => {
    expect(titleMarkdown("monitor [MR](https://x.example) **now**")).toBe(
      "monitor [MR](https://x.example) **now**",
    );
  });
  it("turns an embed into the link it wraps, so no note or image is drawn in a title", () => {
    expect(titleMarkdown("![[Diagram]] review")).toBe("[[Diagram]] review");
    expect(titleMarkdown("![chart](img/chart.png) review")).toBe("[chart](img/chart.png) review");
    expect(titleMarkdown("![](img/chart.png)")).toBe("[img/chart.png](img/chart.png)");
  });
  it("escapes what would open a block, so it shows as typed", () => {
    expect(titleMarkdown("# Fix **now**")).toBe("\\# Fix **now**");
    expect(titleMarkdown("> quote *this*")).toBe("\\> quote *this*");
    expect(titleMarkdown("- [ ] `task`")).toBe("\\- [ ] `task`");
    expect(titleMarkdown("+ plus *one*")).toBe("\\+ plus *one*");
    expect(titleMarkdown("1. first **thing**")).toBe("1\\. first **thing**");
    expect(titleMarkdown("2) second **thing**")).toBe("2\\) second **thing**");
    expect(titleMarkdown("--- **x**")).toBe("--- **x**");
    expect(titleMarkdown("---")).toBe("\\---");
    expect(titleMarkdown("```js `x`")).toBe("\\```js `x`");
    expect(titleMarkdown("$$x$$ and **y**")).toBe("\\$$x$$ and **y**");
  });
  it("leaves a line that only looks like a block start alone", () => {
    expect(titleMarkdown("#tag and **bold**")).toBe("#tag and **bold**");
    expect(titleMarkdown("-5 degrees **cold**")).toBe("-5 degrees **cold**");
    expect(titleMarkdown("*emphasis* first")).toBe("*emphasis* first");
    expect(titleMarkdown("2026 plan **draft**")).toBe("2026 plan **draft**");
  });
  it("is one line, whatever it was given", () => {
    expect(titleMarkdown("one\n# two **three**")).toBe("one # two **three**");
  });
});

describe("asTitleMode", () => {
  it("reads `heading`, and takes anything else for the file name", () => {
    expect(asTitleMode("heading")).toBe("heading");
    expect(asTitleMode("filename")).toBe("filename");
    // `auto` guessed per card from the shape of the file name. It is gone: a board still set to
    // it titles its cards by file name.
    expect(asTitleMode("auto")).toBe("filename");
    expect(asTitleMode("headings")).toBe("filename");
    expect(asTitleMode(undefined)).toBe("filename");
    expect(asTitleMode(3)).toBe("filename");
  });
});

describe("resolveTitle", () => {
  it("is the file name, whatever the note's headings say", () => {
    expect(resolveTitle("Fix export", {}, slugNote, "filename")).toEqual({
      title: "Fix export",
      source: "filename",
    });
  });
  it("does not guess from the shape of a file name: a slug-named card is titled by its slug", () => {
    for (const basename of ["01-fix-export", "fix-the-export-path", "2026-08-24 notes", "42"])
      expect(resolveTitle(basename, {}, slugNote, "filename"), basename).toEqual({
        title: basename,
        source: "filename",
      });
  });
  it("is the `title` key when the note has one, in either mode", () => {
    for (const mode of ["filename", "heading"] as const)
      expect(resolveTitle("01-fix-export", { title: "From YAML" }, slugNote, mode)).toEqual({
        title: "From YAML",
        source: "frontmatter",
      });
  });
  it("keeps the `title` key's Markdown as typed", () => {
    const title = "monitor [MR130903](https://gitlab.example/mr/130903)";
    expect(resolveTitle("monitor MR130903", { title }, "", "filename").title).toBe(title);
  });
  it("ignores a `title` key that is blank or not text", () => {
    expect(resolveTitle("Fix export", { title: "  " }, slugNote, "filename").source).toBe(
      "filename",
    );
    expect(resolveTitle("Fix export", { title: 2024 }, slugNote, "filename").title).toBe(
      "Fix export",
    );
  });
  it("heading: uses the first heading even when it is a single word", () => {
    expect(resolveTitle("Fix export", {}, "# Draft\n", "heading")).toEqual({
      title: "Draft",
      source: "heading",
    });
  });
  it("heading: reads the first heading of any level, and keeps its Markdown", () => {
    const text = "## **Fix** the [[export|export path]]\n\n# Later\n";
    expect(resolveTitle("01-fix", {}, text, "heading").title).toBe(
      "**Fix** the [[export|export path]]",
    );
  });
  it("heading: falls back to the file name when the note has no heading", () => {
    expect(resolveTitle("Fix export", {}, "just text\n", "heading").source).toBe("filename");
  });
  it("heading: ignores headings inside code fences", () => {
    const text = "```\n# not a heading at all\n```\n# The real card title\n";
    expect(resolveTitle("01-fix", {}, text, "heading").title).toBe("The real card title");
  });
  it("heading: a fence closes only on its own marker, so `~~~` inside a ``` block stays code", () => {
    const text = "```\n~~~\n# Definitely not a title\n```\n\n# The real card title here\n";
    expect(resolveTitle("01-fix", {}, text, "heading").title).toBe("The real card title here");
  });
  it("heading: a fence closes only on a bare marker line, so ```still-code keeps it open", () => {
    const text = "```\n```still code\n# Definitely not a title\n```\n\n# The real card title\n";
    expect(resolveTitle("01-fix", {}, text, "heading").title).toBe("The real card title");
  });
  it("heading: accepts an ATX heading indented by up to three spaces, as CommonMark does", () => {
    expect(resolveTitle("01-fix", {}, "   # Fix the export path\n", "heading").title).toBe(
      "Fix the export path",
    );
  });
  it("heading: never takes a title from the parser's own section headings", () => {
    const text = "## Subtasks\n- [ ] [[Child]]\n\n## Comments\n\n## History\n";
    expect(resolveTitle("01-fix", {}, text, "heading")).toEqual({
      title: "01-fix",
      source: "filename",
    });
  });
});

describe("setHeadingTitle", () => {
  it("rewrites only the first heading's line, keeping its marker and every other byte", () => {
    expect(setHeadingTitle(slugNote, "Fix the export path on macOS")).toBe(
      slugNote.replace("on Windows", "on macOS"),
    );
  });
  it("targets the heading a heading board displays", () => {
    const text = "## Question\n\n## Rename the widget helpers\n";
    expect(setHeadingTitle(text, "Context")).toBe("## Context\n\n## Rename the widget helpers\n");
  });
  it("leaves a note with no heading alone", () => {
    expect(setHeadingTitle("just text\n", "x")).toBe("just text\n");
  });
  it("leaves the parser's section headings untouched", () => {
    const text = "## Subtasks\n- [ ] [[Child]]\n";
    expect(setHeadingTitle(text, "Plan release")).toBe(text);
  });
  it("keeps an indent, and the heading's closing hashes but not a hash inside the text", () => {
    expect(setHeadingTitle("   # Fix the export path\n", "Fix it later")).toBe(
      "   # Fix it later\n",
    );
    expect(setHeadingTitle("## Old title goes here ##\n", "New title")).toBe("## New title ##\n");
    expect(setHeadingTitle("# Fix the C# export path\n", "New title here")).toBe(
      "# New title here\n",
    );
  });
  it("keeps a CRLF line ending on the edited line", () => {
    expect(setHeadingTitle("# Old title here\r\n\r\nbody\r\n", "New title here")).toBe(
      "# New title here\r\n\r\nbody\r\n",
    );
  });
});

describe("withoutRepeatedHeading", () => {
  const fm = "---\nstatus: todo\n---\n";
  it("removes a top heading that repeats the title, and the blank lines under it", () => {
    expect(withoutRepeatedHeading(`${fm}# Fix export\n\nSome context.\n`, "Fix export")).toBe(
      `${fm}Some context.\n`,
    );
    expect(withoutRepeatedHeading(`${fm}\n# Fix export\n\n\nSome context.\n`, "Fix export")).toBe(
      `${fm}\nSome context.\n`,
    );
  });
  it("leaves a note that was nothing but the heading with an empty body", () => {
    expect(withoutRepeatedHeading(`${fm}# Fix export\n`, "Fix export")).toBe(fm);
    expect(withoutRepeatedHeading("# Fix export", "Fix export")).toBe("");
  });
  it("keeps every other byte, sections and line endings included", () => {
    const rest = "Some context.\r\n\r\n## Subtasks\r\n- [ ] one\r\n";
    expect(withoutRepeatedHeading(`# Fix export\r\n\r\n${rest}`, "Fix export")).toBe(rest);
  });
  it("reads a repeat through letter case, spacing and how accents are composed", () => {
    expect(withoutRepeatedHeading("#   fix   EXPORT  \nbody\n", "Fix export")).toBe("body\n");
    expect(withoutRepeatedHeading(`# ${NFD}\nbody\n`, NFC)).toBe("body\n");
    expect(withoutRepeatedHeading("# Fix export #\nbody\n", "Fix export")).toBe("body\n");
  });
  it("removes a heading that repeats the words of a title carrying a link", () => {
    const title = "monitor [MR130903](https://gitlab.example/mr/130903)";
    expect(withoutRepeatedHeading("# monitor MR130903\nbody\n", title)).toBe("body\n");
    expect(withoutRepeatedHeading(`# ${title}\nbody\n`, title)).toBe("body\n");
  });
  it("keeps a heading that says more than the title", () => {
    for (const text of [
      "# Fix export, properly\nbody\n",
      // The file name could not hold the `?`: the heading is the only place it is written.
      "# Fix export?\nbody\n",
      // The heading carries an address the title does not.
      "# [Fix export](https://example.com)\nbody\n",
    ])
      expect(withoutRepeatedHeading(text, "Fix export"), text).toBeNull();
  });
  it("only looks at the body's first line of text", () => {
    expect(withoutRepeatedHeading("Intro.\n\n# Fix export\n", "Fix export")).toBeNull();
    expect(withoutRepeatedHeading("## Fix export\nbody\n", "Fix export")).toBeNull();
    expect(withoutRepeatedHeading("```\n# Fix export\n```\n", "Fix export")).toBeNull();
    expect(withoutRepeatedHeading(fm, "Fix export")).toBeNull();
    expect(withoutRepeatedHeading("", "Fix export")).toBeNull();
  });
});
