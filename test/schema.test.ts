// Runtime decode tests for the vault boundary schemas (blueprint §11/§16/§17). This is what
// `pnpm schema:check` runs: it proves the schemas accept real vault data and reject corruption,
// and that malformed persisted data surfaces instead of being silently swallowed.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/model/card";
import {
  BoardFrontmatterSchema,
  ContextFrontmatterSchema,
  DataCorruptionError,
  FrontmatterSchema,
  decode,
} from "../src/model/schemas";

/** Every committed `.md` in the example vaults (excluding Obsidian's own plugin data). */
function exampleMarkdownFiles(): string[] {
  const root = join(process.cwd(), "examples");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === ".obsidian") return [];
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith(".md") ? [p] : [];
    });
  return walk(root);
}

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

  it("coerces a non-string card-folder to absent (graceful, not corruption)", () => {
    // A defaultable config field must not crash a real board; the adapter falls back to "Tasks".
    const fm = decode(BoardFrontmatterSchema, { "card-folder": 123 }, "board");
    expect(fm["card-folder"]).toBeUndefined();
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

  it("treats a YAML null color (unquoted '#hex' comment) as absent, not corruption", () => {
    // `color: #4c9aff` (unquoted) → YAML reads `#` as a comment → color is null. Must degrade to
    // "no color", exactly as the adapter did before schemas — NOT throw and break board load.
    const fm = parseFrontmatter("---\ncontext-name: Research\ncolor: #4c9aff\n---\n");
    const ctx = decode(ContextFrontmatterSchema, fm, "context");
    expect(ctx["context-name"]).toBe("Research");
    expect(ctx["color"]).toBeUndefined();
  });

  it("coerces a non-string color to absent", () => {
    const fm = decode(ContextFrontmatterSchema, { color: 5 }, "context");
    expect(fm["color"]).toBeUndefined();
  });
});

describe("decode() error messages name the source", () => {
  it("includes the source label when structural corruption is rejected", () => {
    // A list where a mapping is required is genuine corruption — and the message names the source.
    expect(() => decode(FrontmatterSchema, ["not", "a", "map"], "board config (Board.md)")).toThrow(
      /board config \(Board\.md\)/,
    );
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

// The real ground truth: the committed example vaults must decode without a false-positive
// DataCorruptionError. This is the §16 "decode real persisted data" gate — it catches a schema
// that is too strict for actual vault frontmatter (which `tsc` and synthetic cases cannot).
describe("example vaults decode without false-positive corruption (§16)", () => {
  const files = exampleMarkdownFiles();

  it("finds example markdown to validate", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("parseFrontmatter does not throw on %s", (file) => {
    expect(() => parseFrontmatter(readFileSync(file, "utf8"))).not.toThrow();
  });

  it("every board note decodes through BoardFrontmatterSchema", () => {
    const boards = files.filter((f) => readFileSync(f, "utf8").includes("folia-board"));
    expect(boards.length).toBeGreaterThan(0);
    for (const f of boards) {
      const fm = parseFrontmatter(readFileSync(f, "utf8"));
      expect(() => decode(BoardFrontmatterSchema, fm, f)).not.toThrow();
    }
  });

  it("every _context.md decodes through ContextFrontmatterSchema", () => {
    const contexts = files.filter((f) => f.endsWith("_context.md"));
    expect(contexts.length).toBeGreaterThan(0);
    for (const f of contexts) {
      const fm = parseFrontmatter(readFileSync(f, "utf8"));
      expect(() => decode(ContextFrontmatterSchema, fm, f)).not.toThrow();
    }
  });

  it("every card note's frontmatter decodes structurally", () => {
    for (const f of files) {
      const fm = parseFrontmatter(readFileSync(f, "utf8"));
      expect(() => decode(FrontmatterSchema, fm, f)).not.toThrow();
    }
  });
});
