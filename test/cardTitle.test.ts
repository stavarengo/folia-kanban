import { describe, expect, it } from "vitest";
import {
  TITLE_SOURCE_LABEL,
  asTitleMode,
  looksLikeSlug,
  looksLikeTitle,
  resolveTitle,
  setHeadingTitle,
  type TitleStep,
} from "../src/model/cardTitle";
import type { TitleMode } from "../src/model/types";

const slugNote = `---
status: todo
---

# Fix the export path on Windows

Some context.

## Subtasks
- [ ] one
`;

describe("looksLikeSlug", () => {
  it("treats numbered or dash/underscore-joined names as slugs", () => {
    for (const s of [
      "01-fix-the-export-path",
      "02_rename_widget_helpers",
      "fix-the-export-path",
      "widget_helpers",
      "2026-08-24 meeting notes",
      "42",
    ])
      expect(looksLikeSlug(s), s).toBe(true);
  });
  it("treats spaced names and single words as names", () => {
    for (const s of ["Fix the export path", "Groceries", "Review PR - accessibility", "Plan v1.0"])
      expect(looksLikeSlug(s), s).toBe(false);
  });
});

describe("looksLikeTitle", () => {
  it("accepts headings with the breadth of a title", () => {
    for (const s of ["Fix the export path", "Groceries list", "Rename the widget helpers"])
      expect(looksLikeTitle(s), s).toBe(true);
  });
  it("rejects section-label shapes without a word list", () => {
    for (const s of ["Question", "Answer", "To Do", "Notes", "Subtasks", "Bug report"])
      expect(looksLikeTitle(s), s).toBe(false);
  });
});

describe("asTitleMode", () => {
  it("accepts the three modes and falls back to auto for anything else", () => {
    expect(asTitleMode("heading")).toBe("heading");
    expect(asTitleMode("filename")).toBe("filename");
    expect(asTitleMode("auto")).toBe("auto");
    expect(asTitleMode("headings")).toBe("auto");
    expect(asTitleMode(undefined)).toBe("auto");
    expect(asTitleMode(3)).toBe("auto");
  });
});

describe("resolveTitle", () => {
  it("auto: a slug file name takes the first title-shaped heading", () => {
    expect(resolveTitle("01-fix-export", {}, slugNote, "auto")).toMatchObject({
      title: "Fix the export path on Windows",
      source: "heading",
    });
  });
  it("auto: a real file name keeps the file name even when a heading exists", () => {
    expect(resolveTitle("Fix export", {}, slugNote, "auto")).toMatchObject({
      title: "Fix export",
      source: "filename",
    });
  });
  it("auto: skips label-shaped headings and keeps looking, whatever their level", () => {
    const text = "## Question\n\nWhy?\n\n### Answer\n\n## Rename the widget factory helpers\n";
    expect(resolveTitle("03-rename-helpers", {}, text, "auto").title).toBe(
      "Rename the widget factory helpers",
    );
  });
  it("auto: falls back to the file name when no heading looks like a title", () => {
    const text = "## Question\n\nWhy?\n\n## Answer\n";
    expect(resolveTitle("03-rename-helpers", {}, text, "auto")).toMatchObject({
      title: "03-rename-helpers",
      source: "filename",
    });
  });
  it("heading: uses the first heading even when it is a single word", () => {
    expect(resolveTitle("Fix export", {}, "# Draft\n", "heading")).toMatchObject({
      title: "Draft",
      source: "heading",
    });
  });
  it("heading: falls back to the file name when the note has no heading", () => {
    expect(resolveTitle("Fix export", {}, "just text\n", "heading").source).toBe("filename");
  });
  it("filename: ignores headings", () => {
    expect(resolveTitle("01-fix-export", {}, slugNote, "filename").title).toBe("01-fix-export");
  });
  it("the card's own `title` key wins in every mode", () => {
    for (const mode of ["auto", "filename", "heading"] as const)
      expect(resolveTitle("01-fix-export", { title: "From YAML" }, slugNote, mode)).toMatchObject({
        title: "From YAML",
        source: "frontmatter",
      });
  });
  it("a blank `title` key is ignored", () => {
    expect(resolveTitle("Fix export", { title: "  " }, slugNote, "auto").source).toBe("filename");
  });
  it("ignores headings inside code fences and strips inline markup", () => {
    const text = "```\n# not a heading at all\n```\n# **Fix** the [[export|export path]]\n";
    expect(resolveTitle("01-fix", {}, text, "auto").title).toBe("Fix the export path");
  });
  it("a fence closes only on its own marker, so `~~~` inside a ``` block stays code", () => {
    const text = "```\n~~~\n# Definitely not a title\n```\n\n# The real card title here\n";
    expect(resolveTitle("01-fix", {}, text, "auto").title).toBe("The real card title here");
    expect(resolveTitle("01-fix", {}, text, "heading").title).toBe("The real card title here");
  });
  it("a fence closes only on a bare marker line, so ```still-code keeps the block open", () => {
    const text = "```\n```still code\n# Definitely not a title\n```\n\n# The real card title\n";
    expect(resolveTitle("01-fix", {}, text, "auto").title).toBe("The real card title");
  });
  it("accepts an ATX heading indented by up to three spaces, as CommonMark does", () => {
    expect(resolveTitle("01-fix", {}, "   # Fix the export path\n", "auto").title).toBe(
      "Fix the export path",
    );
    expect(setHeadingTitle("   # Fix the export path\n", "01-fix", "auto", "Fix it later")).toBe(
      "   # Fix it later\n",
    );
  });
  it("never takes a title from the parser's own section headings", () => {
    const text = "## Subtasks\n- [ ] [[Child]]\n\n## Comments\n\n## History\n";
    expect(resolveTitle("01-fix", {}, text, "heading")).toMatchObject({
      title: "01-fix",
      source: "filename",
    });
    expect(resolveTitle("01-fix", {}, text, "auto").source).toBe("filename");
  });
});

describe("setHeadingTitle", () => {
  it("rewrites only the selected heading line, keeping its marker and every other byte", () => {
    const out = setHeadingTitle(slugNote, "01-fix-export", "auto", "Fix the export path on macOS");
    expect(out).toBe(slugNote.replace("on Windows", "on macOS"));
  });
  it("targets the same heading the mode would display", () => {
    const text = "## Question\n\n## Rename the widget helpers\n";
    expect(setHeadingTitle(text, "03-rename", "auto", "Rename the widget factory")).toBe(
      "## Question\n\n## Rename the widget factory\n",
    );
    expect(setHeadingTitle(text, "03-rename", "heading", "Context")).toBe(
      "## Context\n\n## Rename the widget helpers\n",
    );
  });
  it("leaves the text alone when the mode selects no heading", () => {
    expect(setHeadingTitle(slugNote, "Fix export", "auto", "x")).toBe(slugNote);
    expect(setHeadingTitle(slugNote, "01-fix", "filename", "x")).toBe(slugNote);
  });
  it("leaves the parser's section headings untouched", () => {
    const text = "## Subtasks\n- [ ] [[Child]]\n";
    expect(setHeadingTitle(text, "01-fix", "heading", "Plan release")).toBe(text);
  });
  it("keeps the heading's closing hashes but not a hash inside the text", () => {
    expect(setHeadingTitle("## Old title goes here ##\n", "01-fix", "heading", "New title")).toBe(
      "## New title ##\n",
    );
    expect(setHeadingTitle("# Fix the C# export path\n", "01-x", "auto", "New title here")).toBe(
      "# New title here\n",
    );
  });
  it("keeps a CRLF line ending on the edited line", () => {
    const text = "# Old title here\r\n\r\nbody\r\n";
    expect(setHeadingTitle(text, "01-x", "auto", "New title here")).toBe(
      "# New title here\r\n\r\nbody\r\n",
    );
  });
});

describe("the trace resolveTitle returns with its answer", () => {
  const trace = (basename: string, fm: Record<string, unknown>, text: string, mode: TitleMode) =>
    resolveTitle(basename, fm, text, mode).trace;
  /** The winning step, which is always the last one: the decision stops when a source answers. */
  const winner = (steps: readonly TitleStep[]) => steps[steps.length - 1]!;

  it("stops at the override and says so", () => {
    const steps = trace("01-fix-export", { title: "Chosen" }, slugNote, "auto");
    expect(steps).toHaveLength(1);
    expect(winner(steps)).toEqual({
      source: "frontmatter",
      value: "Chosen",
      outcome: "won",
      reason: "Taken from the override, which wins over every other source.",
    });
  });

  it("names the slug-shaped file name as the reason a heading was read", () => {
    const steps = trace("01-fix-export", {}, slugNote, "auto");
    expect(steps.map((s) => [s.source, s.outcome])).toEqual([
      ["frontmatter", "empty"],
      ["heading", "won"],
    ]);
    expect(winner(steps).value).toBe("Fix the export path on Windows");
    expect(winner(steps).reason).toBe(
      "Taken from the note's first heading, because the file name reads like a slug.",
    );
  });

  it("names the board's mode as the reason a heading was read", () => {
    const steps = trace("Notes", {}, slugNote, "heading");
    expect(winner(steps).reason).toBe(
      "Taken from the note's first heading, because this board titles cards by heading.",
    );
  });

  it("falls to the file name for three different reasons, and says which", () => {
    expect(winner(trace("Notes", {}, slugNote, "filename")).reason).toBe(
      "Taken from the file name, because this board titles cards by file name.",
    );
    expect(winner(trace("Notes", {}, slugNote, "auto")).reason).toBe(
      "Taken from the file name, because it already reads as a name.",
    );
    expect(winner(trace("01-fix-export", {}, "\n# Notes\n", "auto")).reason).toBe(
      "Taken from the file name, because no heading in the note could supply a title.",
    );
  });

  it("records the step that was skipped, and the one that had nothing to offer", () => {
    const skipped = trace("Notes", {}, slugNote, "filename")[1]!;
    expect(skipped).toMatchObject({ source: "heading", outcome: "skipped", value: null });
    expect(skipped.reason).toBe("This board titles cards by file name, so no heading is read.");
    const empty = trace("01-fix-export", {}, "\n# Notes\n", "auto")[1]!;
    expect(empty).toMatchObject({ source: "heading", outcome: "empty" });
    expect(empty.reason).toBe(
      "The file name reads like a slug, but no heading in the note reads as a title.",
    );
  });

  it("labels every source it can decide by", () => {
    expect(TITLE_SOURCE_LABEL).toEqual({
      frontmatter: "Override card title",
      heading: "First heading in the note",
      filename: "File name",
    });
  });
});
