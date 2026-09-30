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

/**
 * A column edit patch. Unlike `Partial<ColumnDef>`, each key may be explicitly `undefined` to
 * CLEAR that field (the column editor sets a cleared color/limit/filter/hover to `undefined`).
 * `applyColumnPatch` in App.tsx merges this onto the current def and drops the cleared keys.
 */
export type ColumnPatch = { [K in keyof ColumnDef]?: ColumnDef[K] | undefined };

/** What the "Edit column" dialog holds while it is open, in the shape its controls hold it. */
export interface ColumnDraft {
  title: string;
  color: string | undefined;
  /** As typed; "" is no limit. */
  limit: string;
  filter: string;
  group: ColumnGroup;
  sort: ColumnSort;
  /** 0.1–1. */
  opacity: number;
  /** 0–1, or undefined while nobody has set it: a column then reveals to full on hover, and a save
   *  must not write the slider's resting position into a note that never asked for one. */
  hoverOpacity: number | undefined;
  parked: boolean;
}

export function columnDraft(c: ColumnDef): ColumnDraft {
  return {
    title: c.title,
    color: c.color,
    limit: c.limit != null ? String(c.limit) : "",
    filter: c.filter ?? "",
    group: c.group ?? "none",
    sort: c.sort ?? "manual",
    opacity: typeof c.opacity === "number" ? c.opacity : 1,
    hoverOpacity: typeof c.hoverOpacity === "number" ? c.hoverOpacity : undefined,
    parked: c.parked === true,
  };
}

/**
 * The one patch a save writes. `null` for a blank title, which the dialog refuses and stays open
 * over. Default-valued and blank fields are pruned by `serializeColumns` on the way to the note.
 */
export function columnPatch(d: ColumnDraft): ColumnPatch | null {
  const title = d.title.trim();
  if (!title) return null;
  const limit =
    d.limit.trim() === "" ? undefined : Math.max(0, Math.floor(Number(d.limit) || 0)) || undefined;
  const hover = d.hoverOpacity === undefined ? undefined : Math.min(1, Math.max(0, d.hoverOpacity));
  return {
    title,
    color: d.color,
    limit,
    filter: d.filter.trim() || undefined,
    group: d.group,
    sort: d.sort,
    opacity: Math.min(1, Math.max(0, d.opacity)),
    hoverOpacity: Number.isFinite(hover) ? hover : undefined,
    parked: d.parked,
  };
}

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
/** A YAML scalar as text. Mappings, lists, `null` and `undefined` come back as "" rather than
 *  as "[object Object]" or "null", so a malformed frontmatter value is rejected, not adopted.
 *  Unquoted YAML yields numbers and booleans for things people typed as text, so those are kept. */
export function scalarText(value: unknown): string {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" ? String(value) : "";
}

export function normalizeColumns(raw: unknown): ColumnDef[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_COLUMNS;
  const cols: ColumnDef[] = [];
  for (const c of raw) {
    const col = readColumn(c);
    if (col) cols.push(col);
  }
  return cols.length ? cols : DEFAULT_COLUMNS;
}

function readColumn(c: unknown): ColumnDef | null {
  if (typeof c === "string") return c.trim() ? { id: c, title: titleCase(c) } : null;
  if (c === null || typeof c !== "object") return null; // skip null / number / other malformed entries
  const obj = c as Record<string, unknown>;
  // A hand-written `id:` may come back as a number or a boolean; anything with a shape (a
  // mapping, a list) is corruption, and stringifying it would produce "[object Object]".
  const id = scalarText(obj["id"]);
  if (id.trim() === "") return null; // a column needs a usable id
  const col: ColumnDef = {
    id,
    title: typeof obj["title"] === "string" && obj["title"] ? obj["title"] : titleCase(id),
  };
  readContentFields(obj, col);
  readViewFields(obj, col);
  return col;
}

/** The fields that say what a column holds, each kept only when it is usable. */
function readContentFields(obj: Record<string, unknown>, col: ColumnDef): void {
  if (typeof obj["color"] === "string") col.color = obj["color"];
  if (typeof obj["limit"] === "number" && Number.isFinite(obj["limit"])) col.limit = obj["limit"];
  if (typeof obj["filter"] === "string" && obj["filter"].trim()) col.filter = obj["filter"];
}

/** The fields that shape how a column shows its cards, each kept only when it is not the default. */
function readViewFields(obj: Record<string, unknown>, col: ColumnDef): void {
  const group = asGroup(obj["group"]);
  if (group && group !== COLUMN_DEFAULTS.group) col.group = group;
  const sort = asSort(obj["sort"]);
  if (sort && sort !== COLUMN_DEFAULTS.sort) col.sort = sort;
  const opacity = clamp01(obj["opacity"]);
  if (opacity !== undefined && opacity !== COLUMN_DEFAULTS.opacity) col.opacity = opacity;
  const hoverOpacity = clamp01(obj["hoverOpacity"]);
  if (hoverOpacity !== undefined) col.hoverOpacity = hoverOpacity;
  if (obj["parked"] === true) col.parked = true;
}

/**
 * Serialize ColumnDefs to the plain objects written to board-note frontmatter.
 * Emits a key ONLY when it carries a non-default value, so a board with none of the new
 * fields produces `{id,title[,color][,limit]}` — byte-identical to the pre-feature shape.
 */
export function serializeColumns(columns: ColumnDef[]): Record<string, unknown>[] {
  return columns.map((c) => {
    const out: Record<string, unknown> = { id: c.id, title: c.title };
    if (c["color"]) out["color"] = c["color"];
    if (typeof c["limit"] === "number") out["limit"] = c["limit"];
    if (typeof c["filter"] === "string" && c["filter"].trim()) out["filter"] = c["filter"];
    writeViewFields(c, out);
    return out;
  });
}

/** The non-default view fields, written after the rest and in this order: it is the note's key order. */
function writeViewFields(c: ColumnDef, out: Record<string, unknown>): void {
  if (c["group"] && c["group"] !== COLUMN_DEFAULTS.group) out["group"] = c["group"];
  if (c["sort"] && c["sort"] !== COLUMN_DEFAULTS.sort) out["sort"] = c["sort"];
  if (typeof c["opacity"] === "number" && c["opacity"] !== COLUMN_DEFAULTS.opacity)
    out["opacity"] = c["opacity"];
  if (typeof c["hoverOpacity"] === "number") out["hoverOpacity"] = c["hoverOpacity"];
  if (c["parked"] === true) out["parked"] = true;
}
