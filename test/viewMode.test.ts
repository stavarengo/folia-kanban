import { describe, it, expect } from "vitest";
import type { FrontMatterCache } from "obsidian";
import { isBoardFrontmatter, resolveBoardViewMode } from "../src/viewMode";

const fm = (o: Record<string, unknown>): FrontMatterCache => o as FrontMatterCache;

describe("isBoardFrontmatter — what counts as a board", () => {
  it("accepts only the literal boolean true", () => {
    expect(isBoardFrontmatter(fm({ "folia-board": true }))).toBe(true);
    expect(isBoardFrontmatter(fm({ "folia-board": "true" }))).toBe(false);
    expect(isBoardFrontmatter(fm({ "folia-board": 1 }))).toBe(false);
    expect(isBoardFrontmatter(fm({ "folia-board": false }))).toBe(false);
  });

  it("says no for a note with no frontmatter at all", () => {
    expect(isBoardFrontmatter(undefined)).toBe(false);
    expect(isBoardFrontmatter(fm({}))).toBe(false);
  });
});

describe("resolveBoardViewMode — which view a note opens in", () => {
  it("leaves every non-board note alone", () => {
    expect(resolveBoardViewMode(undefined, "board")).toBeNull();
    expect(resolveBoardViewMode(fm({}), "board")).toBeNull();
    expect(resolveBoardViewMode(fm({ title: "Groceries" }), "board")).toBeNull();
    // Close but not a board: the flag has to be the boolean, not a lookalike.
    expect(resolveBoardViewMode(fm({ "folia-board": "true" }), "board")).toBeNull();
    expect(resolveBoardViewMode(fm({ "folia-view": "board" }), "board")).toBeNull();
  });

  it("uses the vault-wide setting when the note says nothing", () => {
    const board = fm({ "folia-board": true });
    expect(resolveBoardViewMode(board, "board")).toBe("board");
    expect(resolveBoardViewMode(board, "markdown")).toBe("markdown");
  });

  it("lets a note override the setting in either direction", () => {
    expect(
      resolveBoardViewMode(fm({ "folia-board": true, "folia-view": "markdown" }), "board"),
    ).toBe("markdown");
    expect(
      resolveBoardViewMode(fm({ "folia-board": true, "folia-view": "board" }), "markdown"),
    ).toBe("board");
  });

  it("falls back to the setting when the override is not a mode we understand", () => {
    for (const bad of ["split", "BOARD", "", true, 3, null, ["board"]]) {
      expect(resolveBoardViewMode(fm({ "folia-board": true, "folia-view": bad }), "markdown")).toBe(
        "markdown",
      );
    }
  });
});
