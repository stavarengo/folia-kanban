import { describe, it, expect } from "vitest";
import {
  isMine,
  seenMarker,
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
    expect(normalizeAuthor("a:b_c")).toBe("a-b_c"); // `_` is legal in a name; `:` is not
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

describe("seenMarker", () => {
  it("is the newest stamp plus how many comments carry it", () => {
    expect(seenMarker([])).toBe("");
    expect(seenMarker([at("2026-06-13 10:00"), at("2026-06-13 12:00")])).toBe("2026-06-13 12:00#1");
    expect(seenMarker([at("2026-06-13 12:00"), at("2026-06-13 12:00")])).toBe("2026-06-13 12:00#2");
  });

  it("is empty when no comment carries a timestamp, so nothing is stored", () => {
    expect(seenMarker([at("")])).toBe("");
  });
});

describe("unreadComments", () => {
  it("counts nothing on a card with no comments", () => {
    expect(unreadComments([], undefined, "rafa")).toEqual({
      kind: "none",
      indices: [],
      replyIndex: null,
    });
  });

  it("treats a card that was never opened as all-unread", () => {
    const r = unreadComments([at("2026-06-13 10:00"), at("2026-06-13 11:00")], undefined, "");
    expect(r).toEqual({ kind: "unread", indices: [0, 1], replyIndex: null });
  });

  it("only counts what is newer than the seen marker", () => {
    const comments = [at("2026-06-13 10:00"), at("2026-06-13 11:00"), at("2026-06-13 12:00")];
    expect(unreadComments(comments, "2026-06-13 11:00#1", "")).toEqual({
      kind: "unread",
      indices: [2],
      replyIndex: null,
    });
    expect(unreadComments(comments, "2026-06-13 12:00#1", "")).toEqual({
      kind: "none",
      indices: [],
      replyIndex: null,
    });
  });

  it("never reports your own comments as unread", () => {
    const comments = [at("2026-06-13 10:00", "rafa"), at("2026-06-13 11:00", "agent")];
    expect(unreadComments(comments, undefined, "rafa").indices).toEqual([1]);
    expect(unreadComments([at("2026-06-13 10:00", "rafa")], undefined, "rafa")).toEqual({
      kind: "none",
      indices: [],
      replyIndex: null,
    });
  });

  it("calls it a reply when an unread comment lands after one of yours", () => {
    const comments = [
      at("2026-06-13 09:00", "agent"),
      at("2026-06-13 10:00", "rafa"),
      at("2026-06-13 11:00", "agent"),
    ];
    expect(unreadComments(comments, "2026-06-13 09:00#1", "rafa")).toEqual({
      kind: "reply",
      indices: [2],
      replyIndex: 2,
    });
  });

  it("stays a plain unread when nothing of yours came first", () => {
    const comments = [at("2026-06-13 09:00", "agent"), at("2026-06-13 10:00", "rafa")];
    expect(unreadComments(comments, undefined, "rafa")).toEqual({
      kind: "unread",
      indices: [0],
      replyIndex: null,
    });
  });

  it("without a name set, nothing is yours — so a reply can never be detected", () => {
    const comments = [at("2026-06-13 10:00", "rafa"), at("2026-06-13 11:00", "agent")];
    expect(unreadComments(comments, undefined, "")).toEqual({
      kind: "unread",
      indices: [0, 1],
      replyIndex: null,
    });
  });

  it("never flags a bullet with no parsable timestamp — it cannot be ordered against the marker", () => {
    expect(unreadComments([at("")], undefined, "")).toEqual({
      kind: "none",
      indices: [],
      replyIndex: null,
    });
  });
});

describe("unreadComments — the marker's count, and which comment is the reply", () => {
  it("still flags a comment that lands in the minute the marker was written", () => {
    const two = [at("2026-06-13 10:00", "agent"), at("2026-06-13 10:00", "agent")];
    // Read the first one only; a second arrives in the same minute.
    expect(unreadComments(two, seenMarker([two[0] as CommentMark]), "rafa").indices).toEqual([1]);
    // Read both, and nothing is left.
    expect(unreadComments(two, seenMarker(two), "rafa").indices).toEqual([]);
  });

  it("reads a legacy bare-timestamp marker as 'all of that minute was seen'", () => {
    const two = [at("2026-06-13 10:00", "agent"), at("2026-06-13 10:00", "agent")];
    expect(unreadComments(two, "2026-06-13 10:00", "rafa").indices).toEqual([]);
  });

  it("tags the comment that followed yours, not merely the first unread one", () => {
    const comments = [
      at("2026-06-13 09:00", "agent"), // unread, but nothing of yours came before it
      at("2026-06-13 10:00", "rafa"),
      at("2026-06-13 11:00", "agent"), // the actual reply
    ];
    expect(unreadComments(comments, undefined, "rafa")).toEqual({
      kind: "reply",
      indices: [0, 2],
      replyIndex: 2,
    });
  });
});
