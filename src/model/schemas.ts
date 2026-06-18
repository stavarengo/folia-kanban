// Runtime validation at the vault boundary (blueprint §11/§16/§17). Markdown frontmatter is
// untrusted external input: it is hand-editable, so its shape can drift or be corrupted. These
// schemas decode it into typed values and surface corruption instead of silently swallowing it.

import { z } from "zod";

/**
 * Thrown when persisted vault data cannot be decoded. The board's load path lets this surface to
 * the user (App shows the message) rather than hiding bad data behind an empty default (§17).
 */
export class DataCorruptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataCorruptionError";
  }
}

/**
 * A card's frontmatter is free-form — users add arbitrary keys (tags, aliases, custom fields) —
 * so we validate structure only: it must be a string-keyed mapping (not a list or scalar). The
 * board narrows the specific fields it reads (status/order/priority/area/due) at the point of use.
 */
export const FrontmatterSchema = z.record(z.string(), z.unknown());

/** The board definition note's config frontmatter. `card-folder` + `columns` drive the board. */
export const BoardFrontmatterSchema = z.looseObject({
  "card-folder": z.string().optional(),
  card_folder: z.string().optional(),
  columns: z.unknown().optional(),
});

/** A context's `_context.md` frontmatter (#14). All display-only and optional. */
export const ContextFrontmatterSchema = z.looseObject({
  "context-name": z.string().optional(),
  color: z.string().optional(),
  label: z.string().optional(),
});

/**
 * Decode untrusted vault data through a schema. On failure throws DataCorruptionError with a
 * readable, path-qualified message — never a silent default (§11/§17).
 */
export function decode<T>(schema: z.ZodType<T>, raw: unknown, source: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new DataCorruptionError(`Invalid ${source}: ${detail}`, { cause: result.error });
  }
  return result.data;
}
