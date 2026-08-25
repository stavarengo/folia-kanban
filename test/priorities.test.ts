import { describe, it, expect } from "vitest";
import {
  normalizePriorities,
  serializePriorities,
  priorityIndex,
  dedupePriorities,
  DEFAULT_PRIORITIES,
} from "../src/model/priorities";

describe("normalizePriorities — reading the board note's vocabulary", () => {
  it("reads a list of strings, dropping blanks and case-insensitive repeats", () => {
    expect(normalizePriorities(["A", " B ", "", "a", "B"])).toEqual(["A", "B"]);
  });

  it("degrades anything that is not a usable list to no vocabulary, never throwing", () => {
    expect(normalizePriorities(undefined)).toEqual([]);
    expect(normalizePriorities("A, B")).toEqual([]);
    expect(normalizePriorities([1, null, { a: 1 }])).toEqual([]);
  });
});

describe("serializePriorities — writing it back", () => {
  it("returns null when there is nothing to remember, so an untouched note gains no key", () => {
    expect(serializePriorities([])).toBeNull();
    expect(serializePriorities(["  "])).toBeNull();
  });

  it("writes the vocabulary in order, once per value", () => {
    expect(serializePriorities(["a", "A", "b"])).toEqual(["a", "b"]);
  });
});

describe("dedupePriorities / priorityIndex", () => {
  it("keeps the first spelling of a value and its incoming order", () => {
    expect(dedupePriorities(["urgent", "Urgent", "low"])).toEqual(["urgent", "low"]);
  });

  it("finds a value case-insensitively and ignores surrounding space", () => {
    expect(priorityIndex(["A", "B"], " b ")).toBe(1);
    expect(priorityIndex(["A", "B"], "c")).toBe(-1);
  });
});

describe("DEFAULT_PRIORITIES", () => {
  it("is the todo.txt convention, not a word scale of the plugin's own invention", () => {
    expect(DEFAULT_PRIORITIES).toEqual(["A", "B", "C"]);
  });
});
