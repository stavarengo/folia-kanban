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
