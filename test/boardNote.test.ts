import { describe, expect, it } from "vitest";
import type { FrontMatterCache } from "obsidian";
import {
  NEW_BOARD_BASENAME,
  applyBoardFrontmatter,
  boardNoteBody,
  cardFolderFor,
  uniqueNotePath,
} from "../src/boardNote";
import { isBoardFrontmatter, resolveBoardViewMode } from "../src/viewMode";
import { BoardFrontmatterSchema, decode } from "../src/model/schemas";
import { normalizeColumns } from "../src/model/columns";
import { resolveCardFolder } from "../src/model/board";

/** The frontmatter a guided setup leaves on a note that started with `before`. */
function converted(
  before: Record<string, unknown>,
  cardFolder = "./Cards",
): Record<string, unknown> {
  const frontmatter = { ...before };
  applyBoardFrontmatter(frontmatter, cardFolder);
  return frontmatter;
}

describe("applyBoardFrontmatter — the properties a guided setup writes", () => {
  it("writes exactly the three the board needs, and nothing it has a default for", () => {
    const frontmatter = converted({});
    expect(frontmatter).toEqual({
      "folia-board": true,
      "card-folder": "./Cards",
      columns: ["todo", "doing", "done"],
    });
  });

  // The whole point of the feature: what it writes has to be a board to the code that decides what
  // a board is, and has to load through the same path a hand-written board note takes.
  it("produces a note the plugin's own detector and loader accept", () => {
    const frontmatter = converted({}) as FrontMatterCache;
    expect(isBoardFrontmatter(frontmatter)).toBe(true);
    expect(resolveBoardViewMode(frontmatter, "board")).toBe("board");

    const config = decode(BoardFrontmatterSchema, frontmatter, "board note");
    expect(normalizeColumns(config.columns).map((c) => c.id)).toEqual(["todo", "doing", "done"]);
  });

  it("names a card folder that resolves to the folder the caller was told to create", () => {
    const { property, path } = cardFolderFor("Projects/Acme", () => false);
    const config = decode(BoardFrontmatterSchema, converted({}, property), "board note");
    const resolved = resolveCardFolder(
      "Projects/Acme/Board.md",
      String(config["card-folder"]),
      () => false,
    );
    expect(resolved?.path).toBe(path);
  });

  it("leaves the note's own properties exactly as they were", () => {
    expect(converted({ title: "Groceries", tags: ["home"] })).toMatchObject({
      title: "Groceries",
      tags: ["home"],
    });
  });

  it("keeps a card folder the note already names, in either spelling, and says it did not write one", () => {
    const dashed: Record<string, unknown> = { "card-folder": "Projects/Acme/Tasks" };
    expect(applyBoardFrontmatter(dashed, "./Cards")).toBe(false);
    expect(dashed["card-folder"]).toBe("Projects/Acme/Tasks");

    const underscored: Record<string, unknown> = { card_folder: "Tasks" };
    expect(applyBoardFrontmatter(underscored, "./Cards")).toBe(false);
    // Adding the dashed key too would give the note two answers to one question.
    expect(underscored["card-folder"]).toBeUndefined();
  });

  it("treats an empty card-folder as no card folder at all", () => {
    const frontmatter: Record<string, unknown> = { "card-folder": "   " };
    expect(applyBoardFrontmatter(frontmatter, "./Cards")).toBe(true);
    expect(frontmatter["card-folder"]).toBe("./Cards");
  });

  it("keeps columns the note already has, and only fills in a list that says nothing", () => {
    expect(converted({ columns: ["backlog", "shipped"] })["columns"]).toEqual([
      "backlog",
      "shipped",
    ]);
    expect(converted({ columns: [] })["columns"]).toEqual(["todo", "doing", "done"]);
    // Not a list the board can use — but it is the user's, and the board says so itself rather than
    // having it quietly replaced here.
    for (const own of ["todo", 3, { todo: 1 }]) {
      expect(converted({ columns: own })["columns"]).toEqual(own);
    }
  });

  it("changes nothing the second time — converting a board again is a no-op", () => {
    const once = converted({ title: "Roadmap" });
    expect(converted(once)).toEqual(once);
  });
});

describe("boardNoteBody", () => {
  it("is the note's heading and nothing else — no hand-built YAML", () => {
    expect(boardNoteBody("Roadmap")).toBe("# Roadmap\n");
  });
});

describe("cardFolderFor", () => {
  it("puts the cards beside the board note, note-relative so they travel together", () => {
    expect(cardFolderFor("Projects/Acme", () => false)).toEqual({
      property: "./Cards",
      path: "Projects/Acme/Cards",
    });
  });

  it("handles a board note sitting at the vault root", () => {
    expect(cardFolderFor("", () => false)).toEqual({ property: "./Cards", path: "Cards" });
    expect(cardFolderFor("/", () => false)).toEqual({ property: "./Cards", path: "Cards" });
  });

  it("steps past a name already taken, so two boards in one folder do not share their cards", () => {
    const taken =
      (...paths: string[]) =>
      (p: string) =>
        paths.includes(p);
    expect(cardFolderFor("Projects", taken("Projects/Cards"))).toEqual({
      property: "./Cards 1",
      path: "Projects/Cards 1",
    });
    expect(cardFolderFor("Projects", taken("Projects/Cards", "Projects/Cards 1"))).toEqual({
      property: "./Cards 2",
      path: "Projects/Cards 2",
    });
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
