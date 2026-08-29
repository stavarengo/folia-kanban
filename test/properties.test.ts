// The one list of keys Folia Kanban knows, and the suggestions built from it.
//
// The first suite is the consolidation's proof: three places used to keep their own copy of this
// knowledge, and each is now derived. The literals below are those copies as they stood before the
// merge, so a change to `properties.ts` that quietly changes what the panel refuses, what a
// relationship type may take over, or what an agent is told, fails here rather than in a vault.

import { describe, expect, it } from "vitest";
import {
  FOLIA_CARD_KEYS,
  PANEL_FIELD_KEYS,
  TOOL_REFUSALS,
  propertySuggestions,
} from "../src/model/properties";
import type { CardFrontmatter } from "../src/model/types";

describe("the keys Folia Kanban knows", () => {
  it("reserves for itself exactly the card keys a relationship type could never take over", () => {
    expect([...FOLIA_CARD_KEYS].sort()).toEqual(
      [
        "status",
        "order",
        "priority",
        "area",
        "due",
        "tags",
        "title",
        "context",
        "type",
        "created",
      ].sort(),
    );
  });

  it("hands the detail panel exactly the keys it edits through a control of its own", () => {
    expect([...PANEL_FIELD_KEYS].sort()).toEqual(
      ["status", "priority", "due", "order", "type", "created", "title"].sort(),
    );
  });

  it("refuses an agent exactly the keys a tool or a field owns, in the words it used before", () => {
    expect(Object.keys(TOOL_REFUSALS).sort()).toEqual(
      ["status", "order", "priority", "due", "title", "folia-board"].sort(),
    );
    expect(TOOL_REFUSALS["priority"]).toBe(
      "use update_card's own `priority` field, so the board remembers the value",
    );
  });

  it("declares every field CardFrontmatter spells out", () => {
    // The compiler already refuses a typed field this list does not know (see `types.ts`); this is
    // the same statement read from the other end, so the pairing is visible in a test too.
    const typed: (keyof CardFrontmatter)[] = ["status", "order", "priority", "area", "due"];
    for (const key of typed) expect(FOLIA_CARD_KEYS).toContain(key);
  });
});

describe("what the property-name field offers", () => {
  const lists = {
    folia: ["status", "priority", "due"],
    board: ["energy", "priority", "sprint"],
    vault: ["energy", "reviewer"],
    exclude: new Set<string>(),
    editedInPanel: new Set(["status", "priority", "due"]),
  };

  it("offers the plugin's own keys, then the board's, then the vault's", () => {
    expect(propertySuggestions("", lists)).toEqual([
      // Marked, because the panel edits these three itself: the popup says where they live rather
      // than letting someone pick a name the Add button will refuse.
      { key: "status", group: "folia", editedInPanel: true },
      { key: "priority", group: "folia", editedInPanel: true },
      { key: "due", group: "folia", editedInPanel: true },
      { key: "energy", group: "board" },
      { key: "sprint", group: "board" },
      { key: "reviewer", group: "vault" },
    ]);
  });

  it("marks a name with a field of its own however either side spells it", () => {
    const shouty = { ...lists, board: ["Sprint"], editedInPanel: new Set(["SPRINT"]) };
    expect(propertySuggestions("sprint", shouty)).toEqual([
      { key: "Sprint", group: "board", editedInPanel: true },
    ]);
  });

  it("never offers one name twice, whichever lists hold it", () => {
    const keys = propertySuggestions("", lists).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches anywhere in the name and ignores case, so a misspelt key finds its original", () => {
    expect(propertySuggestions("PRIO", lists).map((s) => s.key)).toEqual(["priority"]);
    expect(propertySuggestions("ner", lists).map((s) => s.key)).toEqual(["energy"]);
  });

  it("leaves out the keys the card already carries, whichever list they came from", () => {
    const withExcluded = { ...lists, exclude: new Set(["priority", "energy"]) };
    expect(propertySuggestions("", withExcluded).map((s) => s.key)).toEqual([
      "status",
      "due",
      "sprint",
      "reviewer",
    ]);
  });

  it("treats an excluded key as excluded however it is spelled", () => {
    const withExcluded = { ...lists, exclude: new Set(["Priority"]) };
    expect(propertySuggestions("", withExcluded).map((s) => s.key)).not.toContain("priority");
  });

  it("offers nothing for a query no key holds", () => {
    expect(propertySuggestions("zzz", lists)).toEqual([]);
  });
});
