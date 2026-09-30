import { describe, expect, it } from "vitest";
import { frontmatterTagValues, tagValues } from "../src/model/tags";
import type { Card } from "../src/model/types";

/** Hand-written YAML can hold anything under a key, whatever the typed keys say. */
function card(frontmatter: Record<string, unknown>, bodyTags?: string[]): Card {
  return {
    path: "Tasks/A.md",
    basename: "A",
    title: "A",
    titleSource: "filename",
    frontmatter: frontmatter as Card["frontmatter"],
    childLinks: [],
    ...(bodyTags ? { bodyTags } : {}),
  };
}

describe("frontmatterTagValues", () => {
  it("reads `area` first, then `tags` as a list or a single value", () => {
    expect(frontmatterTagValues(card({ area: "ops", tags: ["red", "blue"] }))).toEqual([
      "ops",
      "red",
      "blue",
    ]);
    expect(frontmatterTagValues(card({ tags: "red" }))).toEqual(["red"]);
    expect(frontmatterTagValues(card({}))).toEqual([]);
  });

  it("skips empty and non-string values", () => {
    expect(frontmatterTagValues(card({ area: "", tags: ["", 3, null, "red"] }))).toEqual(["red"]);
    expect(frontmatterTagValues(card({ area: 7, tags: 7 }))).toEqual([]);
  });

  it("keeps each value as written: untrimmed, spaces and a leading `#` included", () => {
    expect(frontmatterTagValues(card({ tags: [" red ", "a b", "#blue", "x, y"] }))).toEqual([
      " red ",
      "a b",
      "#blue",
      "x, y",
    ]);
  });

  it("reads only the lowercase `tags` key", () => {
    expect(frontmatterTagValues(card({ Tags: ["red"], tag: "blue" }))).toEqual([]);
  });
});

describe("tagValues", () => {
  it("adds the body's tags after the frontmatter's, without repeating one in another case", () => {
    expect(
      tagValues(card({ area: "ops", tags: ["Home"] }, ["home", "errands", "ERRANDS"])),
    ).toEqual(["ops", "Home", "errands"]);
  });
});
