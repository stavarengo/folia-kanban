import { describe, expect, it } from "vitest";
import {
  addTodo,
  frontmatterYaml,
  parseSubtasks,
  setDescription,
  splitFrontmatter,
} from "../src/model/card";
import { ContextFrontmatterSchema, decode } from "../src/model/schemas";
import { parseFrontmatter } from "../src/obsidian/frontmatter";
import { obsidianReader } from "./obsidianFake";

// The model splits where Obsidian's metadata reader does, since that reader is where the
// properties Folia shows come from; `obsidianReader` is a copy of its rule.
/** The model's split, in the reader's terms: its YAML without the last line ending, and where its closing `---` ends. */
function modelSplit(raw: string): { yaml: string; end: number } | null {
  const yaml = frontmatterYaml(raw);
  if (yaml === null) return null;
  const closeEnd = splitFrontmatter(raw).fmText.replace(/\r?\n?$/, "").length;
  const normalize = (s: string) => s.replace(/\r\n|\r/g, "\n");
  return {
    yaml: normalize(yaml).replace(/\n$/, ""),
    end: normalize(raw.slice(0, closeEnd)).length,
  };
}

describe("the model splits frontmatter where Obsidian's metadata reader does", () => {
  it.each([
    ["LF", "---\na: 1\n---\nbody"],
    ["CRLF", "---\r\na: 1\r\n---\r\nbody"],
    ["closing fence at end of file", "---\na: 1\n---"],
    ["trailing space on the closing fence", "---\na: 1\n--- \nbody"],
    ["four dashes as the closing fence", "---\na: 1\n----\nbody"],
    ["empty block", "---\n---\nbody"],
    ["empty block at end of file", "---\n---"],
    ["empty block, then a thematic break", "---\n---\nbody\n---\nmore"],
    ["no closing fence", "---\na: 1\nbody"],
    ["byte order mark before the opening fence", "﻿---\na: 1\n---\nbody"],
  ])("%s", (_, text) => {
    expect(modelSplit(text)).toEqual(obsidianReader(text));
  });

  it("agrees with the reader on 20,000 random notes with LF and CRLF line endings", () => {
    const pieces = ["---", "-", "\n", "\r\n", " ", "a: 1", "x", "\n---", "\r\n---", "\n--- "];
    let seed = 95;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 20_000; i++) {
      let text = random() < 0.8 ? "---\n" : "";
      const n = 1 + Math.floor(random() * 12);
      for (let j = 0; j < n; j++) text += pieces[Math.floor(random() * pieces.length)] ?? "";
      expect(modelSplit(text), JSON.stringify(text)).toEqual(obsidianReader(text));
    }
  });

  it("reads an empty block followed by a thematic break as no fields, not corruption", () => {
    expect(parseFrontmatter("---\n---\nbody\n---\nmore")).toEqual({});
  });

  it.each([
    ["a trailing space", "---\nstatus: todo\n--- \n# Card X\n"],
    ["a fourth dash", "---\nstatus: todo\n----\n# Card X\n"],
    ["text", "---\nstatus: todo\n---foo\n# Card X\n"],
    ["a trailing space and CRLF", "---\r\nstatus: todo\r\n--- \r\n# Card X\r\n"],
  ])("leaves a closing line carrying %s byte for byte when a todo is added", (_, text) => {
    const out = addTodo(text, "Ship");
    expect(out.startsWith(text)).toBe(true);
  });

  it.each([
    ["an empty note", "", "D", "\nD\n"],
    ["a block closing at the end of the file", "---\na: 1\n---", "D", "---\na: 1\n---\nD\n"],
    ["an empty block closing at the end of the file", "---\n---", "D", "---\n---\nD\n"],
  ])("writes a description into %s with no extra line", (_, text, description, out) => {
    expect(setDescription(text, description)).toBe(out);
  });

  it("adds a todo to an empty note with no line before it", () => {
    expect(addTodo("", "Ship")).toBe("## Subtasks\n- [ ] Ship\n");
  });

  it.each([
    ["an empty block", "---\n---", "---\n---\n"],
    ["a CRLF block", "---\r\na: 1\r\n---", "---\r\na: 1\r\n---\r\n"],
  ])(
    "gives %s closing at the end of the file a line ending before new body text",
    (_, text, fm) => {
      const out = addTodo(text, "Ship");
      expect(splitFrontmatter(out).fmText).toBe(fm);
      expect(parseSubtasks(out).map((s) => s.text)).toEqual(["Ship"]);
    },
  );
});

// These pin how the YAML values Obsidian's parser is most likely to read differently arrive in
// Folia. They run against the test fake's `parseYaml`, which is the `yaml` package with default
// options (YAML 1.2 core schema); that is what Obsidian 1.10.6 through 1.13.7 bundle, but they cannot
// tell which `yaml` release a given build carries.
describe("values another YAML parser would read differently", () => {
  it("keeps an unquoted date a string, not a Date", () => {
    expect(parseFrontmatter("---\ndue: 2026-10-01\n---\n")["due"]).toBe("2026-10-01");
  });

  it("keeps yes/no strings, not YAML 1.1 booleans", () => {
    const fm = parseFrontmatter("---\na: yes\nb: no\nc: true\n---\n");
    expect(fm).toEqual({ a: "yes", b: "no", c: true });
  });

  it("reads a bare # as a comment, so the value is null", () => {
    expect(parseFrontmatter("---\ncolor: #\n---\n")).toEqual({ color: null });
  });

  it("a _context.md holding all three keeps the strings and drops only the colour", () => {
    const fm = parseFrontmatter("---\ncontext-name: 2026-10-01\nlabel: no\ncolor: #\n---\n");
    expect(decode(ContextFrontmatterSchema, fm, "context")).toEqual({
      "context-name": "2026-10-01",
      label: "no",
      color: undefined,
    });
  });
});
