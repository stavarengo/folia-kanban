import { describe, it, expect } from "vitest";
import {
  isMine,
  latestCommentTimestamp,
  normalizeAuthor,
  unreadComments,
  type CommentMark,
} from "../src/model/unread";

const at = (timestamp: string, author: string | null = null): CommentMark => ({
  timestamp,
  author,
});

describe("normalizeAuthor", () => {
  it("drops a leading @ and replaces the characters that delimit the line prefix", () => {
    expect(normalizeAuthor("  @rafa ")).toBe("rafa");
    expect(normalizeAuthor("Ana Maria")).toBe("Ana-Maria");
    expect(normalizeAuthor("a:b_c")).toBe("a-b-c");
    expect(normalizeAuthor("")).toBe("");
  });
});

describe("isMine", () => {
  it("matches case-insensitively, and never matches when either side is unknown", () => {
    expect(isMine("Rafa", "rafa")).toBe(true);
    expect(isMine("rafa", "@Rafa")).toBe(true);
    expect(isMine("agent", "rafa")).toBe(false);
    expect(isMine(null, "rafa")).toBe(false);
    expect(isMine("rafa", "")).toBe(false);
  });
});

describe("latestCommentTimestamp", () => {
  it("is the newest stamp, and empty for a card with none", () => {
    expect(latestCommentTimestamp([])).toBe("");
    expect(latestCommentTimestamp([at("2026-06-13 10:00"), at("2026-06-13 12:00")])).toBe(
      "2026-06-13 12:00",
    );
    expect(latestCommentTimestamp([at("")])).toBe("");
  });
});

describe("unreadComments", () => {
  it("counts nothing on a card with no comments", () => {
    expect(unreadComments([], undefined, "rafa")).toEqual({ kind: "none", indices: [] });
  });

  it("treats a card that was never opened as all-unread", () => {
    const r = unreadComments([at("2026-06-13 10:00"), at("2026-06-13 11:00")], undefined, "");
    expect(r).toEqual({ kind: "unread", indices: [0, 1] });
  });

  it("only counts what is newer than the seen marker", () => {
    const comments = [at("2026-06-13 10:00"), at("2026-06-13 11:00"), at("2026-06-13 12:00")];
    expect(unreadComments(comments, "2026-06-13 11:00", "")).toEqual({
      kind: "unread",
      indices: [2],
    });
    expect(unreadComments(comments, "2026-06-13 12:00", "")).toEqual({ kind: "none", indices: [] });
  });

  it("never reports your own comments as unread", () => {
    const comments = [at("2026-06-13 10:00", "rafa"), at("2026-06-13 11:00", "agent")];
    expect(unreadComments(comments, undefined, "rafa").indices).toEqual([1]);
    expect(unreadComments([at("2026-06-13 10:00", "rafa")], undefined, "rafa")).toEqual({
      kind: "none",
      indices: [],
    });
  });

  it("calls it a reply when an unread comment lands after one of yours", () => {
    const comments = [
      at("2026-06-13 09:00", "agent"),
      at("2026-06-13 10:00", "rafa"),
      at("2026-06-13 11:00", "agent"),
    ];
    expect(unreadComments(comments, "2026-06-13 09:00", "rafa")).toEqual({
      kind: "reply",
      indices: [2],
    });
  });

  it("stays a plain unread when nothing of yours came first", () => {
    const comments = [at("2026-06-13 09:00", "agent"), at("2026-06-13 10:00", "rafa")];
    expect(unreadComments(comments, undefined, "rafa")).toEqual({ kind: "unread", indices: [0] });
  });

  it("without a name set, nothing is yours — so a reply can never be detected", () => {
    const comments = [at("2026-06-13 10:00", "rafa"), at("2026-06-13 11:00", "agent")];
    expect(unreadComments(comments, undefined, "")).toEqual({ kind: "unread", indices: [0, 1] });
  });

  it("never flags a bullet with no parsable timestamp — it cannot be ordered against the marker", () => {
    expect(unreadComments([at("")], undefined, "")).toEqual({ kind: "none", indices: [] });
  });
});
