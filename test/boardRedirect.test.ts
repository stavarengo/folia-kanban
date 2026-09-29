import { describe, it, expect } from "vitest";
import type { CachedMetadata } from "obsidian";
import { markdownTabOutcome, type MarkdownTabFacts } from "../src/obsidian/boardRedirect";

const board: CachedMetadata = { frontmatter: { "folia-board": true } } as CachedMetadata;
const facts = (o: Partial<MarkdownTabFacts>): MarkdownTabFacts => ({
  cache: board,
  fallback: "board",
  keptAsMarkdown: false,
  alreadyDecided: false,
  editingSurface: true,
  ...o,
});

describe("markdownTabOutcome — whether a Markdown tab becomes the board", () => {
  it("swaps a board note in a main-area tab", () => {
    expect(markdownTabOutcome(facts({}))).toBe("board");
  });

  it("leaves ordinary notes alone", () => {
    expect(markdownTabOutcome(facts({ cache: {} as CachedMetadata }))).toBe("stay");
  });

  it("honours the setting and the note's own folia-view", () => {
    expect(markdownTabOutcome(facts({ fallback: "markdown" }))).toBe("stay");
    const override = { frontmatter: { "folia-board": true, "folia-view": "board" } };
    expect(
      markdownTabOutcome(facts({ cache: override as CachedMetadata, fallback: "markdown" })),
    ).toBe("board");
  });

  it("never overrides a tab the user sent to the editor, nor a sidebar", () => {
    expect(markdownTabOutcome(facts({ keptAsMarkdown: true }))).toBe("stay");
    expect(markdownTabOutcome(facts({ editingSurface: false }))).toBe("stay");
  });

  it("does not treat coming back to a tab as an open", () => {
    expect(markdownTabOutcome(facts({ alreadyDecided: true }))).toBe("stay");
  });

  it("asks again once a cold metadata cache has read the note", () => {
    expect(markdownTabOutcome(facts({ cache: null }))).toBe("retry");
    // A kept or sidebar tab stays put whatever the cache later says.
    expect(markdownTabOutcome(facts({ cache: null, keptAsMarkdown: true }))).toBe("stay");
  });
});
