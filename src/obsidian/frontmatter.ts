import { parseYaml } from "obsidian";
import { frontmatterRecord, frontmatterYaml } from "../model/card";
import { DataCorruptionError } from "../model/schemas";

/** A note's frontmatter, parsed by Obsidian's own YAML parser: `{}` when there is none. */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const yaml = frontmatterYaml(text);
  if (yaml == null) return {};
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch (e) {
    // §17: malformed YAML is corruption, not "no frontmatter" — surface it, don't hide it
    // behind an empty object (which would silently drop the card's status/order/etc.).
    throw new DataCorruptionError("Card frontmatter is not valid YAML", { cause: e });
  }
  return frontmatterRecord(data);
}

/** Whether two parsed YAML values say the same thing. Key order in a mapping is not a difference. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return sameList(a, b);
  return isMapping(a) && isMapping(b) && sameMapping(a, b);
}

function sameList(a: unknown, b: unknown): boolean {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((x, i) => sameValue(x, b[i]))
  );
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sameMapping(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && sameValue(a[k], b[k]));
}
