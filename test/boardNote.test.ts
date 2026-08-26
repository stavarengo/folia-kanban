import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { FrontMatterCache } from "obsidian";
import {
  NEW_BOARD_BASENAME,
  applyBoardFrontmatter,
  boardNoteContent,
  cardFolderPathFor,
  uniqueNotePath,
} from "../src/boardNote";
import { isBoardFrontmatter, resolveBoardViewMode } from "../src/viewMode";

/** The frontmatter of a note, read the way Obsidian reads it: the block only counts when it opens
 *  on the very first line. Returns undefined otherwise, exactly as a note without one would. */
function frontmatterOf(note: string): FrontMatterCache | undefined {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(note);
  if (!match?.[1]) return undefined;
  return parse(match[1]) as FrontMatterCache;
}

describe("boardNoteContent — the note a guided create writes", () => {
  const note = boardNoteContent("Board");

  it("opens with the frontmatter block, which is the mistake this feature exists to remove", () => {
    expect(note.startsWith("---\n")).toBe(true);
    expect(note.indexOf("---")).toBe(0);
  });

  it("is a board as far as the plugin's own detector is concerned", () => {
    const frontmatter = frontmatterOf(note);
    expect(isBoardFrontmatter(frontmatter)).toBe(true);
    expect(resolveBoardViewMode(frontmatter, "board")).toBe("board");
  });

  it("names a card folder and columns the board can actually load", () => {
    expect(frontmatterOf(note)).toMatchObject({
      "folia-board": true,
      "card-folder": "./Cards",
      columns: ["todo", "doing", "done"],
    });
  });

  it("carries the note's own title as its heading", () => {
    expect(boardNoteContent("Roadmap")).toContain("\n# Roadmap\n");
  });

  it("writes nothing the board has a working default for", () => {
    const keys = Object.keys(frontmatterOf(note) ?? {});
    expect(keys).toEqual(["folia-board", "card-folder", "columns"]);
  });
});

describe("applyBoardFrontmatter — turning an existing note into a board", () => {
  it("fills in everything a note with no frontmatter needs", () => {
    const frontmatter: Record<string, unknown> = {};
    expect(applyBoardFrontmatter(frontmatter)).toBe(true);
    expect(frontmatter).toEqual({
      "folia-board": true,
      "card-folder": "./Cards",
      columns: ["todo", "doing", "done"],
    });
  });

  it("leaves the note's own properties exactly as they were", () => {
    const frontmatter: Record<string, unknown> = { title: "Groceries", tags: ["home"] };
    applyBoardFrontmatter(frontmatter);
    expect(frontmatter).toMatchObject({ title: "Groceries", tags: ["home"] });
  });

  it("keeps a card folder the note already names, in either spelling", () => {
    const dashed: Record<string, unknown> = { "card-folder": "Projects/Acme/Tasks" };
    expect(applyBoardFrontmatter(dashed)).toBe(false);
    expect(dashed["card-folder"]).toBe("Projects/Acme/Tasks");

    const underscored: Record<string, unknown> = { card_folder: "Tasks" };
    expect(applyBoardFrontmatter(underscored)).toBe(false);
    // Adding the dashed key too would give the note two answers to one question.
    expect(underscored["card-folder"]).toBeUndefined();
  });

  it("reports the default folder as its own, so the caller can create it", () => {
    expect(applyBoardFrontmatter({ "card-folder": "./Cards" })).toBe(true);
  });

  it("keeps columns the note already has, and replaces a value the board could not use", () => {
    const own: Record<string, unknown> = { columns: ["backlog", "shipped"] };
    applyBoardFrontmatter(own);
    expect(own["columns"]).toEqual(["backlog", "shipped"]);

    for (const unusable of [[], "todo", null, 3]) {
      const frontmatter: Record<string, unknown> = { columns: unusable };
      applyBoardFrontmatter(frontmatter);
      expect(frontmatter["columns"]).toEqual(["todo", "doing", "done"]);
    }
  });

  it("treats an empty card-folder as no card folder at all", () => {
    const frontmatter: Record<string, unknown> = { "card-folder": "   " };
    expect(applyBoardFrontmatter(frontmatter)).toBe(true);
    expect(frontmatter["card-folder"]).toBe("./Cards");
  });

  it("changes nothing the second time — converting a board again is a no-op", () => {
    const frontmatter: Record<string, unknown> = { title: "Roadmap" };
    applyBoardFrontmatter(frontmatter);
    const once = structuredClone(frontmatter);
    applyBoardFrontmatter(frontmatter);
    expect(frontmatter).toEqual(once);
  });
});

describe("cardFolderPathFor", () => {
  it("puts the cards beside the board note", () => {
    expect(cardFolderPathFor("Projects/Acme")).toBe("Projects/Acme/Cards");
  });

  it("handles a board note sitting at the vault root", () => {
    expect(cardFolderPathFor("")).toBe("Cards");
    expect(cardFolderPathFor("/")).toBe("Cards");
  });
});

describe("uniqueNotePath", () => {
  const taken =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p);

  it("uses the plain name when nothing occupies it", () => {
    expect(uniqueNotePath("Projects", NEW_BOARD_BASENAME, taken())).toBe("Projects/Board.md");
  });

  it("counts up past every name already taken", () => {
    expect(
      uniqueNotePath("Projects", "Board", taken("Projects/Board.md", "Projects/Board 1.md")),
    ).toBe("Projects/Board 2.md");
  });

  it("writes a vault-root path without a leading slash", () => {
    expect(uniqueNotePath("/", "Board", taken())).toBe("Board.md");
    expect(uniqueNotePath("", "Board", taken("Board.md"))).toBe("Board 1.md");
  });
});
