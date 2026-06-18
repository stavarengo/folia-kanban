// Pure column-definition (de)serialization. No Obsidian dependency: this is consumed by both
// the model (`buildBoard` via the board config) and the Obsidian adapter (`vaultRepo` reads the
// board-note frontmatter, then hands the raw `columns` value here). Keeping it pure lets the
// round-trip be unit-tested without Obsidian, and honors the "model stays pure" invariant.
//
// Byte-stability contract: `serializeColumns` emits ONLY keys that differ from their default.
// A board whose columns carry none of the new fields therefore serializes to exactly the same
// shape it did before this vocabulary existed — `processFrontMatter` then writes no extra keys.

import type { ColumnDef, ColumnGroup, ColumnSort } from "./types";

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: "todo", title: "Todo" },
  { id: "next", title: "Next" },
  { id: "doing", title: "Doing" },
  { id: "waiting", title: "Waiting" },
  { id: "parked", title: "Parked" },
  { id: "later", title: "Later" },
  { id: "done", title: "Done" },
];

/** Field defaults — the values that mean "behave exactly as before". */
export const COLUMN_DEFAULTS = {
  group: "none" as ColumnGroup,
  sort: "manual" as ColumnSort,
  opacity: 1,
  parked: false,
} as const;

const GROUPS: readonly ColumnGroup[] = ["none", "due"];
const SORTS: readonly ColumnSort[] = ["manual", "priority", "due"];

export function titleCase(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Clamp a finite number into [0,1]; return undefined for anything non-numeric / out of a usable range. */
function clamp01(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function asGroup(value: unknown): ColumnGroup | undefined {
  return typeof value === "string" && (GROUPS as readonly string[]).includes(value)
    ? (value as ColumnGroup)
    : undefined;
}

function asSort(value: unknown): ColumnSort | undefined {
  return typeof value === "string" && (SORTS as readonly string[]).includes(value)
    ? (value as ColumnSort)
    : undefined;
}

/**
 * Read + validate a raw `columns` frontmatter value into ColumnDefs.
 * Accepts an array of bare strings (`"todo"`) or objects (`{id,title,color?,limit?,...}`).
 * Bad / absent fields are gracefully dropped (or clamped); a malformed list falls back to the
 * default seven columns. Never throws.
 */
export function normalizeColumns(raw: unknown): ColumnDef[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_COLUMNS;
  const cols: ColumnDef[] = [];
  for (const c of raw) {
    if (typeof c === "string") {
      if (c.trim()) cols.push({ id: c, title: titleCase(c) });
      continue;
    }
    if (c === null || typeof c !== "object") continue; // skip null / number / other malformed entries
    const obj = c as Record<string, unknown>;
    if (obj.id == null || String(obj.id).trim() === "") continue; // a column needs a usable id
    const col: ColumnDef = {
      id: String(obj.id),
      title: typeof obj.title === "string" && obj.title ? obj.title : titleCase(String(obj.id)),
    };
    if (typeof obj.color === "string") col.color = obj.color;
    if (typeof obj.limit === "number" && Number.isFinite(obj.limit)) col.limit = obj.limit;

    if (typeof obj.filter === "string" && obj.filter.trim()) col.filter = obj.filter;
    const group = asGroup(obj.group);
    if (group && group !== COLUMN_DEFAULTS.group) col.group = group;
    const sort = asSort(obj.sort);
    if (sort && sort !== COLUMN_DEFAULTS.sort) col.sort = sort;
    const opacity = clamp01(obj.opacity);
    if (opacity !== undefined && opacity !== COLUMN_DEFAULTS.opacity) col.opacity = opacity;
    const hoverOpacity = clamp01(obj.hoverOpacity);
    if (hoverOpacity !== undefined) col.hoverOpacity = hoverOpacity;
    if (obj.parked === true) col.parked = true;

    cols.push(col);
  }
  return cols.length ? cols : DEFAULT_COLUMNS;
}

/**
 * Serialize ColumnDefs to the plain objects written to board-note frontmatter.
 * Emits a key ONLY when it carries a non-default value, so a board with none of the new
 * fields produces `{id,title[,color][,limit]}` — byte-identical to the pre-feature shape.
 */
export function serializeColumns(columns: ColumnDef[]): Record<string, unknown>[] {
  return columns.map((c) => {
    const out: Record<string, unknown> = { id: c.id, title: c.title };
    if (c.color) out.color = c.color;
    if (typeof c.limit === "number") out.limit = c.limit;
    if (typeof c.filter === "string" && c.filter.trim()) out.filter = c.filter;
    if (c.group && c.group !== COLUMN_DEFAULTS.group) out.group = c.group;
    if (c.sort && c.sort !== COLUMN_DEFAULTS.sort) out.sort = c.sort;
    if (typeof c.opacity === "number" && c.opacity !== COLUMN_DEFAULTS.opacity)
      out.opacity = c.opacity;
    if (typeof c.hoverOpacity === "number") out.hoverOpacity = c.hoverOpacity;
    if (c.parked === true) out.parked = true;
    return out;
  });
}
