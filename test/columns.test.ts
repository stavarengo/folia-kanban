import { describe, it, expect } from "vitest";
import {
  normalizeColumns,
  serializeColumns,
  DEFAULT_COLUMNS,
  COLUMN_DEFAULTS,
  titleCase,
} from "../src/model/columns";
import type { ColumnDef } from "../src/model/types";

describe("normalizeColumns — reading the board frontmatter", () => {
  it("falls back to the default seven columns when raw is missing / empty / malformed", () => {
    expect(normalizeColumns(undefined)).toBe(DEFAULT_COLUMNS);
    expect(normalizeColumns([])).toBe(DEFAULT_COLUMNS);
    expect(normalizeColumns("not a list")).toBe(DEFAULT_COLUMNS);
    expect(normalizeColumns([null, 3, {}])).toBe(DEFAULT_COLUMNS); // every entry unusable → default
  });

  it("accepts bare string columns and title-cases the id", () => {
    expect(normalizeColumns(["todo", "in-progress"])).toEqual([
      { id: "todo", title: "Todo" },
      { id: "in-progress", title: "In Progress" },
    ]);
  });

  it("reads the existing object fields (id, title, color, limit)", () => {
    expect(normalizeColumns([{ id: "doing", title: "Doing", color: "#abc", limit: 3 }])).toEqual([
      { id: "doing", title: "Doing", color: "#abc", limit: 3 },
    ]);
  });

  it("reads the new vocabulary fields and ignores defaults", () => {
    const cols = normalizeColumns([
      {
        id: "research",
        title: "Research",
        filter: "area:research status:todo",
        group: "due",
        sort: "priority",
        opacity: 0.5,
        hoverOpacity: 0.9,
        parked: true,
      },
    ]);
    expect(cols[0]).toEqual({
      id: "research",
      title: "Research",
      filter: "area:research status:todo",
      group: "due",
      sort: "priority",
      opacity: 0.5,
      hoverOpacity: 0.9,
      parked: true,
    });
  });

  it("drops fields set to their default value (so they don't pollute the def)", () => {
    const cols = normalizeColumns([
      { id: "c", title: "C", group: "none", sort: "manual", opacity: 1, parked: false },
    ]);
    expect(cols[0]).toEqual({ id: "c", title: "C" });
  });

  it("gracefully ignores invalid enum/filter values and clamps opacity to [0,1]", () => {
    const cols = normalizeColumns([
      // opacity:5 clamps to 1, which equals the default → dropped. hoverOpacity:-2 clamps to 0 (kept).
      {
        id: "c",
        title: "C",
        group: "weekly",
        sort: "alpha",
        filter: "   ",
        opacity: 5,
        hoverOpacity: -2,
      },
    ]);
    expect(cols[0]).toEqual({ id: "c", title: "C", hoverOpacity: 0 });
  });

  it("keeps a clamped opacity that lands on a non-default value", () => {
    expect(normalizeColumns([{ id: "c", title: "C", opacity: 0.3 }])[0]).toEqual({
      id: "c",
      title: "C",
      opacity: 0.3,
    });
  });

  it("skips entries without a usable id", () => {
    expect(normalizeColumns([{ title: "no id" }, { id: "  " }, { id: "ok", title: "OK" }])).toEqual(
      [{ id: "ok", title: "OK" }],
    );
  });
});

describe("serializeColumns — byte-stability protection", () => {
  it("emits ONLY id+title for plain columns (no new keys leak in)", () => {
    const out = serializeColumns([{ id: "todo", title: "Todo" }]);
    expect(out).toEqual([{ id: "todo", title: "Todo" }]);
    expect(Object.keys(out[0])).toEqual(["id", "title"]);
  });

  it("emits color + limit when present, in a stable shape", () => {
    expect(serializeColumns([{ id: "doing", title: "Doing", color: "#abc", limit: 3 }])).toEqual([
      { id: "doing", title: "Doing", color: "#abc", limit: 3 },
    ]);
  });

  it("does NOT emit a key whose value equals its default", () => {
    const out = serializeColumns([
      {
        id: "c",
        title: "C",
        group: COLUMN_DEFAULTS.group,
        sort: COLUMN_DEFAULTS.sort,
        opacity: 1,
        parked: false,
      },
    ]);
    expect(out).toEqual([{ id: "c", title: "C" }]);
  });

  it("emits each new field only when it differs from default", () => {
    const out = serializeColumns([
      {
        id: "research",
        title: "Research",
        filter: "area:research",
        group: "due",
        sort: "priority",
        opacity: 0.5,
        hoverOpacity: 0.9,
        parked: true,
      },
    ]);
    expect(out).toEqual([
      {
        id: "research",
        title: "Research",
        filter: "area:research",
        group: "due",
        sort: "priority",
        opacity: 0.5,
        hoverOpacity: 0.9,
        parked: true,
      },
    ]);
  });
});

describe("round-trip: normalize(serialize(x)) is identity on the def shape", () => {
  it("(a) a board with none of the new keys round-trips to the same shape", () => {
    const original: ColumnDef[] = [
      { id: "todo", title: "Todo" },
      { id: "doing", title: "Doing", color: "#abc", limit: 5 },
      { id: "done", title: "Done" },
    ];
    expect(normalizeColumns(serializeColumns(original))).toEqual(original);
  });

  it("(b) each new field persists and reloads correctly through a round-trip", () => {
    const original: ColumnDef[] = [
      {
        id: "research",
        title: "Research",
        filter: "area:research status:todo",
        group: "due",
        sort: "priority",
        opacity: 0.5,
        hoverOpacity: 0.9,
        parked: true,
      },
      { id: "todo", title: "Todo" },
    ];
    expect(normalizeColumns(serializeColumns(original))).toEqual(original);
  });
});

describe("updateColumn write path is byte-stable (#8 — the modal patch must not leak defaults)", () => {
  // The exact patch ColumnEditModal.save() builds for a NO-OP save on a plain {id,title} column.
  // FakeRepo.setColumns doesn't round-trip through serialize, so this guards the real risk: the
  // editor sneaking an all-defaults patch that serializeColumns would still emit (invariant 5).
  const noopPatch = {
    title: "Todo",
    color: undefined,
    limit: undefined,
    filter: undefined,
    group: "none" as const,
    sort: "manual" as const,
    opacity: 1,
    hoverOpacity: undefined,
    parked: false,
  };

  it("a no-op save on a plain column serializes back to exactly {id,title}", () => {
    const merged: ColumnDef = { id: "todo", ...noopPatch };
    expect(serializeColumns([merged])).toEqual([{ id: "todo", title: "Todo" }]);
  });

  it("a no-op save round-trips to the original plain def (no key churn)", () => {
    const original: ColumnDef = { id: "todo", title: "Todo" };
    // updateColumn merges patch onto the existing def: { ...c, ...patch }. The patch wins.
    const merged: ColumnDef = { id: original.id, ...noopPatch };
    expect(normalizeColumns(serializeColumns([merged]))).toEqual([original]);
  });

  it("non-default edits persist exactly through the same write path", () => {
    const merged: ColumnDef = {
      id: "research",
      title: "Research",
      color: undefined,
      limit: 3,
      filter: "area:research status:todo",
      group: "due",
      sort: "priority",
      opacity: 0.5,
      hoverOpacity: 0.8,
      parked: true,
    };
    expect(normalizeColumns(serializeColumns([merged]))).toEqual([
      {
        id: "research",
        title: "Research",
        limit: 3,
        filter: "area:research status:todo",
        group: "due",
        sort: "priority",
        opacity: 0.5,
        hoverOpacity: 0.8,
        parked: true,
      },
    ]);
  });
});

describe("titleCase", () => {
  it("turns ids into human titles", () => {
    expect(titleCase("in-progress")).toBe("In Progress");
    expect(titleCase("todo")).toBe("Todo");
  });
});
