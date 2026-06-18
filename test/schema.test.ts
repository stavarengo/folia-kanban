// Runtime decode tests for the vault boundary schemas (blueprint §11/§16/§17). This is what
// `pnpm schema:check` runs: it proves the schemas accept real vault data and reject corruption,
// and that malformed persisted data surfaces instead of being silently swallowed.

import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/model/card";
import {
  BoardFrontmatterSchema,
  ContextFrontmatterSchema,
  DataCorruptionError,
  FrontmatterSchema,
  decode,
} from "../src/model/schemas";

describe("FrontmatterSchema (card frontmatter is a free-form mapping)", () => {
  it("accepts an object with arbitrary keys", () => {
    const fm = decode(FrontmatterSchema, { status: "todo", order: 1, tags: ["x"] }, "card");
    expect(fm["status"]).toBe("todo");
    expect(fm["tags"]).toEqual(["x"]);
  });

  it("rejects a list (corruption, not a mapping)", () => {
    expect(() => decode(FrontmatterSchema, ["a", "b"], "card")).toThrow(DataCorruptionError);
  });

  it("rejects a scalar", () => {
    expect(() => decode(FrontmatterSchema, "just a string", "card")).toThrow(DataCorruptionError);
  });
});

describe("BoardFrontmatterSchema (board config note)", () => {
  it("accepts a valid config and keeps unknown keys", () => {
    const fm = decode(
      BoardFrontmatterSchema,
      { "card-folder": "Cards", columns: ["todo", "done"], "folia-board": true },
      "board",
    );
    expect(fm["card-folder"]).toBe("Cards");
    expect(fm["folia-board"]).toBe(true);
  });

  it("accepts a config with no fields (board with defaults)", () => {
    expect(() => decode(BoardFrontmatterSchema, {}, "board")).not.toThrow();
  });

  it("rejects a non-string card-folder", () => {
    expect(() => decode(BoardFrontmatterSchema, { "card-folder": 123 }, "board")).toThrow(
      DataCorruptionError,
    );
  });
});

describe("ContextFrontmatterSchema (_context.md)", () => {
  it("accepts valid display fields", () => {
    const fm = decode(
      ContextFrontmatterSchema,
      { "context-name": "Research", color: "#4c9aff" },
      "context",
    );
    expect(fm["context-name"]).toBe("Research");
  });

  it("rejects a non-string color", () => {
    expect(() => decode(ContextFrontmatterSchema, { color: 5 }, "context")).toThrow(
      DataCorruptionError,
    );
  });
});

describe("decode() error messages name the source", () => {
  it("includes the source label in the thrown message", () => {
    expect(() =>
      decode(BoardFrontmatterSchema, { "card-folder": 1 }, "board config (Board.md)"),
    ).toThrow(/board config \(Board\.md\)/);
  });
});

describe("parseFrontmatter surfaces corruption (§17)", () => {
  it("parses a valid frontmatter block", () => {
    const fm = parseFrontmatter("---\nstatus: todo\norder: 2\n---\nbody");
    expect(fm["status"]).toBe("todo");
    expect(fm["order"]).toBe(2);
  });

  it("returns {} when there is no frontmatter block", () => {
    expect(parseFrontmatter("just a body, no frontmatter")).toEqual({});
  });

  it("returns {} for an empty frontmatter block", () => {
    expect(parseFrontmatter("---\n---\nbody")).toEqual({});
  });

  it("THROWS on malformed YAML instead of silently returning {}", () => {
    expect(() => parseFrontmatter("---\nfoo: [unclosed\n---\nbody")).toThrow(DataCorruptionError);
  });

  it("THROWS when the frontmatter block is a list, not a mapping", () => {
    expect(() => parseFrontmatter("---\n- a\n- b\n---\nbody")).toThrow(DataCorruptionError);
  });
});
