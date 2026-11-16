import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import {
  FILE_NAME_CHARS,
  asTitleMode,
  cardFileName,
  fitFileName,
  hasInlineMarkdown,
  normalizeTitle,
  plainTitleText,
  resolveTitle,
  retitleHeading,
  sameTitle,
  sanitizeFilename,
  titleFileName,
  withoutRepeatedHeading,
} from "../src/model/cardTitle";
import { retargetTitleLinks, titleMarkdown } from "../src/model/titleMarkdown";

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
  it("drops control characters, which nobody can see or type on purpose", () => {
    expect(normalizeTitle("Bell\u0007and\ttab and\u001fUS control\u007f chars")).toBe(
      "Belland tab andUS control chars",
    );
    expect(normalizeTitle("next\u0085line \u009b and \u0000 nul")).toBe("nextline and nul");
    // What joins an emoji into one character is not a control character, and stays.
    expect(normalizeTitle("family 👨‍👩‍👧 photo")).toBe("family 👨‍👩‍👧 photo");
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
  it("renames the device names Windows spells with a superscript digit, and the console's two", () => {
    expect(sanitizeFilename("COM¹")).toBe("COM¹ card");
    expect(sanitizeFilename("lpt²")).toBe("lpt² card");
    expect(sanitizeFilename("Com³.log")).toBe("Com³ card.log");
    expect(sanitizeFilename("CONIN$")).toBe("CONIN$ card");
    expect(sanitizeFilename("conout$")).toBe("conout$ card");
    // Only ¹, ² and ³ name a port.
    expect(sanitizeFilename("COM⁴")).toBe("COM⁴");
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
    expect(fitFileName(`${"a".repeat(9)}éz`, { chars: 10 })).toBe(`${"a".repeat(9)}é`);
  });
  it("honours a tighter limit, for a folder whose path leaves little room", () => {
    expect(fitFileName("Fix the export path on Windows today", { chars: 25 })).toBe(
      "Fix the export path on",
    );
  });
  it("counts a limit on the path the way Windows does, in UTF-16 units, and still cuts at a character", () => {
    // Each of these is one character and two units.
    expect(fitFileName("😀".repeat(25), { units: 21 })).toBe("😀".repeat(10));
  });
  it("leaves no trailing dot or space where it cut", () => {
    expect(fitFileName(`${"a".repeat(98)}. bcd`)).toBe("a".repeat(98));
  });
  it("keeps the last word when the cut lands exactly at its end", () => {
    const title = "Investigate why the nightly build fails";
    // 27 units hold "Investigate why the nightly" to the letter: nothing was cut mid-word.
    expect(fitFileName(title, { units: 27 })).toBe("Investigate why the nightly");
    expect(fitFileName(title, { units: 26 })).toBe("Investigate why the");
    expect(fitFileName(title, { chars: 27 })).toBe("Investigate why the nightly");
    expect(fitFileName("語 ".repeat(40), { bytes: 7 })).toBe("語 語");
  });
});

describe("cardFileName", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it("is the title with its extension, and a number once the name is taken", () => {
    expect(cardFileName("Fix the export path")).toBe("Fix the export path.md");
    expect(cardFileName("Fix the export path", 2)).toBe("Fix the export path 2.md");
    expect(cardFileName("x".repeat(FILE_NAME_CHARS))).toBe(`${"x".repeat(FILE_NAME_CHARS)}.md`);
  });
  it("keeps the whole file name within 200 bytes, extension and number included", () => {
    // 66 of these are 198 bytes: with `.md` that is one over.
    expect(cardFileName("語".repeat(90))).toBe(`${"語".repeat(65)}.md`);
    expect(cardFileName("語".repeat(66))).toBe(`${"語".repeat(65)}.md`);
    for (const n of [0, 1, 9, 10, 123])
      expect(bytes(cardFileName("😀".repeat(51), n)), String(n)).toBeLessThanOrEqual(200);
    expect(cardFileName("😀".repeat(51), 1)).toBe(`${"😀".repeat(48)} 1.md`);
  });
  it("keeps the whole file name within the room a folder leaves, extension and number included", () => {
    const title = "Fix the export path on Windows before the release";
    expect(cardFileName(title, 0, 30)).toBe("Fix the export path on.md");
    for (const n of [0, 1, 12])
      expect(cardFileName(title, n, 30).length, String(n)).toBeLessThanOrEqual(30);
    // Counted as Windows counts a path: two units for each of these.
    expect(cardFileName("😀".repeat(25), 0, 30)).toBe(`${"😀".repeat(13)}.md`);
    expect(cardFileName("😀".repeat(25), 3, 30)).toBe(`${"😀".repeat(12)} 3.md`);
  });
  it("fills the room a folder leaves to the last character when a word ends there", () => {
    const name = cardFileName("Investigate why the nightly build fails", 0, 30);
    expect(name).toBe("Investigate why the nightly.md");
    expect(name).toHaveLength(30);
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
  it("reads a label that holds brackets of its own", () => {
    expect(plainTitleText("**x** ![a [b]](image.png)")).toBe("x a [b]");
    expect(plainTitleText("[see [1]](https://example.com)")).toBe("see [1]");
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
  it("turns an image into a link whatever its label holds", () => {
    expect(titleMarkdown("**x** ![a [b]](image.png)")).toBe("**x** [a [b]](image.png)");
    expect(titleMarkdown("![a `]` b](image.png) **x**")).toBe("[a `]` b](image.png) **x**");
    expect(titleMarkdown("![one ![two](2.png)](1.png)")).toBe("[one [two](2.png)](1.png)");
    expect(titleMarkdown('![a](<my image.png> "t") **x**')).toBe('[a](<my image.png> "t") **x**');
    expect(titleMarkdown("![[a] b](c.png)")).toBe("[[a] b](c.png)");
  });
  it("escapes an exclamation mark before a bracket it opens no image with, which reads the same", () => {
    expect(titleMarkdown("Wait![1] is **this** right")).toBe("Wait\\![1] is **this** right");
    expect(titleMarkdown("\\![[Diagram]] **x**")).toBe("\\![[Diagram]] **x**");
    expect(titleMarkdown("![[never closed **x**")).toBe("\\![[never closed **x**");
    // A second mark would otherwise be left standing before the link the first one wrapped.
    expect(titleMarkdown("!![[Diagram]] **x**")).toBe("\\![[Diagram]] **x**");
    expect(titleMarkdown("Really! [yes](https://x.example)")).toBe(
      "Really! [yes](https://x.example)",
    );
  });
  it("leaves a code span exactly as typed", () => {
    expect(titleMarkdown("see `![[note]]` and `![a](b.png)`")).toBe(
      "see `![[note]]` and `![a](b.png)`",
    );
    expect(titleMarkdown("``a ` ![[b]]`` then ![[c]]")).toBe("``a ` ![[b]]`` then [[c]]");
    expect(titleMarkdown("`<b>` and `%%x%%`")).toBe("`<b>` and `%%x%%`");
  });
  it("shows raw HTML as typed instead of handing it to the renderer", () => {
    expect(titleMarkdown('**x** <img src="a.png">')).toBe('**x** \\<img src="a.png">');
    expect(titleMarkdown("a <b>bold</b> **c**")).toBe("a \\<b>bold\\</b> **c**");
    expect(titleMarkdown("<!-- gone --> **c**")).toBe("\\<!-- gone --> **c**");
    expect(titleMarkdown("<div>**c**</div>")).toBe("\\<div>**c**\\</div>");
  });
  it("keeps an autolink, a bare `<` and an address written in angle brackets", () => {
    for (const t of [
      "see <https://example.com/x> **now**",
      "mail <someone@example.com> **now**",
      "a < b and **c**",
      "[a](<my file.md>) **c**",
    ])
      expect(titleMarkdown(t), t).toBe(t);
  });
  it("escapes what would make the whole line disappear", () => {
    // A link reference definition and a footnote draw nothing where they stand.
    expect(titleMarkdown("[JIRA-12]: https://jira.example/12")).toBe(
      "\\[JIRA-12]: https://jira.example/12",
    );
    expect(titleMarkdown("[^1]: a **note**")).toBe("\\[^1]: a **note**");
    // Obsidian hides everything after `%%`.
    expect(titleMarkdown("50%% off **today**")).toBe("50\\%\\% off **today**");
  });

  describe("as a CommonMark renderer reads it", () => {
    // Obsidian's renderer cannot run here. This one reads the same CommonMark, raw HTML switched
    // on as Obsidian has it, and stands in for the question the string alone cannot answer: is
    // anything drawn but one line of inline text?
    const md = new MarkdownIt({ html: true });
    const INLINE_BLOCKS = ["paragraph_open", "inline", "paragraph_close"];
    const drawn = (title: string) => {
      const tokens = md.parse(titleMarkdown(title), {});
      return {
        blocks: tokens.map((t) => t.type),
        inline: tokens.flatMap((t) => t.children ?? []).map((t) => t.type),
        code: tokens
          .flatMap((t) => t.children ?? [])
          .filter((t) => t.type === "code_inline")
          .map((t) => t.content),
      };
    };

    it("draws one paragraph of inline text, with no image and no HTML, whatever the title", () => {
      for (const title of [
        "**x** ![a [b]](image.png)",
        "![chart](img/chart.png) review",
        "![one ![two](2.png)](1.png)",
        '![a](<my image.png> "t") **x**',
        "![a `]` b](image.png) **x**",
        '**x** <img src="a.png" onerror="alert(1)">',
        "a <b>bold</b> **c**",
        "<div>**c**</div>",
        "<!-- gone --> **c**",
        "<script>alert(1)</script> **c**",
        "# Fix **now**",
        "> quote *this*",
        "- [ ] `task`",
        "1. first **thing**",
        "```js `x`",
        "[JIRA-12]: https://jira.example/12",
        "| a | **b** |",
        "    indented **code**",
      ]) {
        const { blocks, inline } = drawn(title);
        expect(blocks, title).toEqual(INLINE_BLOCKS);
        expect(inline, title).not.toContain("image");
        expect(inline, title).not.toContain("html_inline");
      }
    });

    it("draws no image whatever its address or caption holds", () => {
      for (const title of [
        "![a](<a(b.png>) **x**",
        '![a](a.png "caption (hi") **x**',
        "![a](a.png 'it (is') **x**",
        "![a](a.png (cap\\)tion)) **x**",
        "![a]( <a b.png> ) **x**",
        "![a](a\\).png) **x**",
        "![a <http://x]y> b](i.png) **x**",
        '![a <b title="]"> c](i.png) **x**',
        "![](<img src=q]>) **x**",
        "!![a](b.png) **x**",
        "![a](javascript:x) **x**",
      ]) {
        const { blocks, inline } = drawn(title);
        expect(blocks, title).toEqual(INLINE_BLOCKS);
        expect(inline, title).not.toContain("image");
        expect(inline, title).not.toContain("html_inline");
      }
    });

    it("draws no raw HTML from the address of a link that is not one", () => {
      for (const title of [
        "[a [b](c) d](<img src=q>)",
        "[![a](i.png)](<img src=q>)",
        '[a](javascript:x "<img src=q>")',
        "[a](x <img src=q>)",
        "[[x]](<img src=q>)",
      ]) {
        const { blocks, inline } = drawn(title);
        expect(blocks, title).toEqual(INLINE_BLOCKS);
        expect(inline, title).not.toContain("image");
        expect(inline, title).not.toContain("html_inline");
      }
    });

    it("draws nothing but inline text from any mix of the characters markup is made of", () => {
      const PARTS = [
        "!", "[", "]", "(", ")", "<", ">", '"', "'", "\\", "`", " ", "a", "b.png",
        "http://x", "[[", "]]", "img src=q", "/", "=", "javascript:", "|",
      ]; // prettier-ignore
      // A fixed sequence, so a failure names a title that fails again on the next run.
      let seed = 20261116;
      const next = (below: number) => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return Math.floor((seed / 4294967296) * below);
      };
      for (let n = 0; n < 6000; n++) {
        const title = Array.from({ length: 2 + next(12) }, () => PARTS[next(PARTS.length)]).join(
          "",
        );
        const { blocks, inline } = drawn(title);
        if (blocks.length > 0) expect(blocks, title).toEqual(INLINE_BLOCKS);
        expect(inline, title).not.toContain("image");
        expect(inline, title).not.toContain("html_inline");
      }
    });

    it("leaves the address of a link exactly as it was typed", () => {
      const href = (title: string) =>
        md
          .parse(titleMarkdown(title), {})
          .flatMap((t) => t.children ?? [])
          .find((t) => t.type === "link_open")
          ?.attrGet("href");
      expect(titleMarkdown("[Go]( <abc> ) **today**")).toBe("[Go]( <abc> ) **today**");
      expect(href("[Go]( <abc> ) **today**")).toBe("abc");
      expect(href("[Go](<a b.md>) **today**")).toBe("a%20b.md");
      expect(href('[Go]( <a(b.md> "why (now" ) **today**')).toBe("a(b.md");
      expect(href("[Go](a_(b).md 'it (is') **today**")).toBe("a_(b).md");
    });

    it("still draws a link where an image was typed", () => {
      expect(drawn("**x** ![a [b]](image.png)").inline).toContain("link_open");
      expect(drawn('![a](<my image.png> "t")').inline).toContain("link_open");
    });

    it("draws a code span with exactly what was typed inside it", () => {
      expect(drawn("see `![[note]]` and `![a](b.png)`").code).toEqual(["![[note]]", "![a](b.png)"]);
      expect(drawn("`<img src=x>` **y**").code).toEqual(["<img src=x>"]);
    });

    it("keeps an autolink a link", () => {
      expect(drawn("see <https://example.com/x> **now**").inline).toContain("link_open");
    });
  });
});

describe("retargetTitleLinks", () => {
  const moved = (linkpath: string) => linkpath === "Parent epic";
  const to = "Parent epic, the migration";

  it("points a wikilink at the note's new name", () => {
    expect(
      retargetTitleLinks(
        "Follow up on [[Parent epic]] and the [vendor quote](https://example.com/quote)",
        moved,
        to,
      ),
    ).toBe(
      "Follow up on [[Parent epic, the migration]] and the [vendor quote](https://example.com/quote)",
    );
  });
  it("keeps the alias, the heading and the embed mark a link was written with", () => {
    expect(retargetTitleLinks("see [[Parent epic|the epic]]", moved, to)).toBe(
      "see [[Parent epic, the migration|the epic]]",
    );
    expect(retargetTitleLinks("see [[Parent epic#Scope]]", moved, to)).toBe(
      "see [[Parent epic, the migration#Scope]]",
    );
    expect(retargetTitleLinks("see [[Parent epic#Scope|scope]]", moved, to)).toBe(
      "see [[Parent epic, the migration#Scope|scope]]",
    );
    expect(retargetTitleLinks("![[Parent epic]] review", moved, to)).toBe(
      "![[Parent epic, the migration]] review",
    );
  });
  it("leaves every other link, and a link typed as code, as it was", () => {
    for (const title of [
      "see [[Another note]] and [[Parent epics]]",
      "type `[[Parent epic]]` to link it",
      "no link to Parent epic here",
      "[[Parent epic never closed",
    ])
      expect(retargetTitleLinks(title, moved, to), title).toBe(title);
  });
  it("leaves a web address alone, though it spells a wikilink", () => {
    const plan = (linkpath: string) => linkpath === "Plan";
    for (const title of [
      "[query](https://example.com/[[Plan]])",
      '[query](https://example.com/x "see [[Plan]]")',
      "[query](<a [[Plan]] b.md>)",
      "![chart](img/[[Plan]].png) review",
    ])
      expect(retargetTitleLinks(title, plan, "Renamed"), title).toBe(title);
    // The label of such a link is text like any other, and a link typed in it follows the note.
    expect(
      retargetTitleLinks("[about [[Plan]]](https://example.com/[[Plan]])", plan, "Renamed"),
    ).toBe("[about [[Renamed]]](https://example.com/[[Plan]])");
    // What only looks like the start of a link is text, and the wikilink after it still follows.
    expect(retargetTitleLinks("[x](a b [[Plan]]", plan, "Renamed")).toBe("[x](a b [[Renamed]]");
  });
  it("leaves a web address typed without a label alone too", () => {
    const plan = (linkpath: string) => linkpath === "Plan";
    for (const title of [
      "See <https://example.com/[[Plan]]>",
      "See https://example.com/[[Plan]]",
      "See HTTP://example.com/a?b=[[Plan]]&c=1 today",
      "Write to <team+[[Plan]]@example.com>",
      "(https://example.com/[[Plan]])",
    ])
      expect(retargetTitleLinks(title, plan, "Renamed"), title).toBe(title);
    // The address ends where the renderer ends it, and a link typed after it follows the note.
    expect(retargetTitleLinks("<https://example.com/[[Plan]]> and [[Plan]]", plan, "Renamed")).toBe(
      "<https://example.com/[[Plan]]> and [[Renamed]]",
    );
    expect(retargetTitleLinks("https://example.com/x [[Plan]]", plan, "Renamed")).toBe(
      "https://example.com/x [[Renamed]]",
    );
    // A `<` that opens no address is text, and so is a word that only starts like a scheme.
    expect(retargetTitleLinks("a < b [[Plan]] > c, http [[Plan]]", plan, "Renamed")).toBe(
      "a < b [[Renamed]] > c, http [[Renamed]]",
    );
  });
  it("names the note in an alias when the link has to be written with its folder", () => {
    const pathTo = "Cards/Parent epic, the migration";
    expect(retargetTitleLinks("see [[Parent epic]]", moved, pathTo)).toBe(
      "see [[Cards/Parent epic, the migration|Parent epic, the migration]]",
    );
    expect(retargetTitleLinks("see [[Parent epic#Scope]]", moved, pathTo)).toBe(
      "see [[Cards/Parent epic, the migration#Scope|Parent epic, the migration > Scope]]",
    );
    // A link that already says how it reads keeps saying it.
    expect(retargetTitleLinks("see [[Parent epic|the epic]]", moved, pathTo)).toBe(
      "see [[Cards/Parent epic, the migration|the epic]]",
    );
    // One that was written with its folder showed the folder before, and still does.
    expect(
      retargetTitleLinks("see [[Old/Parent epic]]", (l) => l === "Old/Parent epic", pathTo),
    ).toBe("see [[Cards/Parent epic, the migration]]");
  });
  it("rewrites each link to the note, and only those", () => {
    expect(
      retargetTitleLinks("[[Parent epic]] before [[Other]] and [[Parent epic|it]]", moved, to),
    ).toBe("[[Parent epic, the migration]] before [[Other]] and [[Parent epic, the migration|it]]");
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
  it("heading: reads a hash that hugs the text as text; only hashes after a space close a heading", () => {
    expect(resolveTitle("x", {}, "# C#\n", "heading").title).toBe("C#");
    expect(resolveTitle("x", {}, "## Learn F# and C# ##\n", "heading").title).toBe(
      "Learn F# and C#",
    );
    expect(resolveTitle("x", {}, "# Fix it #\n", "heading").title).toBe("Fix it");
    expect(resolveTitle("x", {}, "# Fix it \\#\n", "heading").title).toBe("Fix it \\#");
    // A heading of nothing but its closing hashes has no text to be a title.
    expect(resolveTitle("x", {}, "# ##\n\n## Real title\n", "heading").title).toBe("Real title");
  });
  it("heading: never takes a title from the parser's own section headings", () => {
    const text = "## Subtasks\n- [ ] [[Child]]\n\n## Comments\n\n## History\n";
    expect(resolveTitle("01-fix", {}, text, "heading")).toEqual({
      title: "01-fix",
      source: "filename",
    });
  });
});

describe("retitleHeading", () => {
  const WAS = "Fix the export path on Windows";
  const written = (text: string, from: string, to: string) => {
    const outcome = retitleHeading(text, from, to);
    if (!("text" in outcome)) throw new Error(`refused: ${JSON.stringify(outcome)}`);
    return outcome.text;
  };

  it("rewrites only the first heading's line, keeping its marker and every other byte", () => {
    expect(written(slugNote, WAS, "Fix the export path on macOS")).toBe(
      slugNote.replace("on Windows", "on macOS"),
    );
  });
  it("targets the heading a heading board displays", () => {
    const text = "## Question\n\n## Rename the widget helpers\n";
    expect(written(text, "Question", "Context")).toBe(
      "## Context\n\n## Rename the widget helpers\n",
    );
  });
  it("keeps an indent, and the heading's closing hashes but not a hash inside the text", () => {
    expect(written("   # Fix the export path\n", "Fix the export path", "Fix it later")).toBe(
      "   # Fix it later\n",
    );
    expect(written("## Old title goes here ##\n", "Old title goes here", "New title")).toBe(
      "## New title ##\n",
    );
    expect(written("# Fix the C# export path\n", "Fix the C# export path", "New title here")).toBe(
      "# New title here\n",
    );
  });
  it("keeps a CRLF line ending on the edited line", () => {
    expect(written("# Old title here\r\n\r\nbody\r\n", "Old title here", "New title here")).toBe(
      "# New title here\r\n\r\nbody\r\n",
    );
  });
  it("writes a title that ends in a hash, which reads back whole", () => {
    expect(written("# Old\n", "Old", "C#")).toBe("# C#\n");
    expect(resolveTitle("x", {}, "# C#\n", "heading").title).toBe("C#");
  });
  it("refuses when the heading it was asked to replace is gone or says something else", () => {
    // Another writer got there first: nothing may be written over what the note says now.
    expect(retitleHeading("just text\n", "Old", "New")).toEqual({ refused: "moved", found: null });
    expect(retitleHeading("## Subtasks\n- [ ] [[Child]]\n", "Old", "New")).toEqual({
      refused: "moved",
      found: null,
    });
    expect(retitleHeading("# Edited elsewhere\n", "Old", "New")).toEqual({
      refused: "moved",
      found: "Edited elsewhere",
    });
  });
  it("refuses a title the heading would not read back as", () => {
    // A lone closing hash is the heading's own syntax, and a section name is the plugin's.
    expect(retitleHeading("# Old\n", "Old", "Fix it #")).toEqual({
      refused: "unreadable",
      readsAs: "Fix it",
    });
    expect(retitleHeading("# Old\n\nbody\n", "Old", "Subtasks")).toEqual({
      refused: "unreadable",
      readsAs: null,
    });
    expect(retitleHeading("# Old\n\n## Later\n", "Old", "comments")).toEqual({
      refused: "unreadable",
      readsAs: "Later",
    });
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
  it("keeps a heading whose text ends in a hash the title does not have", () => {
    // `# C#` is the heading "C#", not "C" with a closing hash.
    expect(withoutRepeatedHeading("# C#\nbody\n", "C")).toBeNull();
    expect(withoutRepeatedHeading("# C#\nbody\n", "C#")).toBe("body\n");
    expect(withoutRepeatedHeading("# C #\nbody\n", "C")).toBe("body\n");
  });
  it("only looks at the body's first line of text", () => {
    expect(withoutRepeatedHeading("Intro.\n\n# Fix export\n", "Fix export")).toBeNull();
    expect(withoutRepeatedHeading("## Fix export\nbody\n", "Fix export")).toBeNull();
    expect(withoutRepeatedHeading("```\n# Fix export\n```\n", "Fix export")).toBeNull();
    expect(withoutRepeatedHeading(fm, "Fix export")).toBeNull();
    expect(withoutRepeatedHeading("", "Fix export")).toBeNull();
  });
});
