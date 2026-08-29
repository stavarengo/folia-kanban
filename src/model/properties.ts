// The frontmatter keys Folia Kanban gives a meaning of its own — the note format the README
// documents — written down once. Everything that used to keep its own copy of this knowledge reads
// it from here: the keys a relationship type may not take over (`relationships.ts`), the keys the
// detail panel edits through a dedicated control (`ui/CardDetail.tsx`), the keys an agent is
// refused when it writes properties by hand (`mcp/cardTools.ts`), and the typed fields of
// `CardFrontmatter` (`types.ts`, checked against this list by the compiler).
//
// It is also what the detail panel's property-name suggestions offer first: the plugin's own
// vocabulary, before the board's and the vault's. A key that only some of those places knew about
// was a key the others silently ignored, which is the drift this list exists to end.

/** Where a key is written: on a card note, or on the board note that lists the cards. */
type PropertyScope = "card" | "board";

/** One key Folia Kanban understands, with everything the plugin knows about it. */
interface FoliaProperty {
  key: string;
  scope: PropertyScope;
  /**
   * True when the card detail panel edits this key through a control of its own. Such a key is
   * never added as a generic property row — there would be two conflicting ways to write it.
   */
  panelField?: boolean;
  /**
   * Why a tool must not set this key through a generic `properties` map, phrased for the agent
   * that tried and naming what it should have used instead. Absent when nothing refuses the key.
   */
  toolRefusal?: string;
}

/**
 * The vocabulary. Card keys come first in the order the README's example note lists them, because
 * that order is what the panel's suggestions show.
 */
const FOLIA_PROPERTIES = [
  {
    key: "status",
    scope: "card",
    panelField: true,
    toolRefusal: "a card's column is set by move_card, which also records the move in its history",
  },
  {
    key: "order",
    scope: "card",
    panelField: true,
    toolRefusal: "a card's position in its column is set by move_card",
  },
  {
    key: "priority",
    scope: "card",
    panelField: true,
    toolRefusal: "use update_card's own `priority` field, so the board remembers the value",
  },
  {
    key: "due",
    scope: "card",
    panelField: true,
    toolRefusal: "use update_card's own `due` field",
  },
  {
    key: "title",
    scope: "card",
    panelField: true,
    // Written by hand, this retitles the card in the frontmatter and nowhere else: the file keeps
    // its old name and every `[[wikilink]]` pointing at it — a parent's checklist line included —
    // still names the card that no longer exists under that title.
    toolRefusal:
      "use update_card's own `title` field, which renames the note and its inbound links",
  },
  { key: "type", scope: "card", panelField: true },
  { key: "created", scope: "card", panelField: true },
  { key: "area", scope: "card" },
  { key: "tags", scope: "card" },
  { key: "context", scope: "card" },
  {
    key: "folia-board",
    scope: "board",
    toolRefusal:
      "that flag is what makes a note a board, not a card — setting it on a card would hand agents a second, broken board",
  },
  { key: "card-folder", scope: "board" },
  { key: "card-title", scope: "board" },
  { key: "folia-view", scope: "board" },
  { key: "columns", scope: "board" },
  { key: "priorities", scope: "board" },
  { key: "relations", scope: "board" },
] as const satisfies readonly FoliaProperty[];

/** Every key this module declares, as a union — what the compiler checks other files against. */
export type FoliaPropertyKey = (typeof FOLIA_PROPERTIES)[number]["key"];

/**
 * The card keys, in the order above. A relationship type may not take any of them over, and the
 * detail panel suggests them before anything the board or the vault happens to use.
 */
export const FOLIA_CARD_KEYS: readonly string[] = FOLIA_PROPERTIES.filter(
  (p) => p.scope === "card",
).map((p) => p.key);

/**
 * The card keys the detail panel edits through a dedicated control, so its generic property rows
 * never offer a second, conflicting way to write them.
 */
export const PANEL_FIELD_KEYS: readonly string[] = FOLIA_PROPERTIES.filter(
  (p) => p.scope === "card" && "panelField" in p,
).map((p) => p.key);

/** Key → why a tool is refused when it writes that key through a generic `properties` map. */
export const TOOL_REFUSALS: Readonly<Record<string, string>> = Object.fromEntries(
  FOLIA_PROPERTIES.filter((p) => "toolRefusal" in p).map((p) => [
    p.key,
    (p as { toolRefusal: string }).toolRefusal,
  ]),
);

/** Which of the three lists a suggested property name came from, in the order they are offered. */
type PropertyGroup = "folia" | "board" | "vault";

/** One suggested property name, and the list it came from. */
export interface PropertySuggestion {
  key: string;
  group: PropertyGroup;
  /**
   * True for a name the detail panel edits through a control of its own. It is still offered —
   * `Priority` typed beside an existing `priority` is exactly the mistake worth catching, and the
   * answer to it is the name spelled the way the plugin reads it — but the popup says where that
   * name is really edited, so nobody picks it expecting a new property row.
   */
  editedInPanel?: boolean;
}

/**
 * The property names to offer for what has been typed so far, in three groups and in this order:
 * the plugin's own vocabulary, then the keys used by notes in this board's card folder, then every
 * other key used anywhere in the vault. A key offered by an earlier group is never repeated by a
 * later one, and `exclude` drops the keys the form cannot add — the ones this card already carries,
 * matched without regard to case so a vault-wide `Area` is not offered to a card that has `area`.
 *
 * Matching is a case-insensitive substring, so `pri` finds `priority` and `PRIORITY` finds it too:
 * the point of the list is to catch a key typed in the wrong case before it becomes a second,
 * silently ignored property. An empty query offers everything, the way Obsidian's own property
 * suggestions do.
 */
export function propertySuggestions(
  query: string,
  lists: {
    folia: readonly string[];
    board: readonly string[];
    vault: readonly string[];
    exclude: ReadonlySet<string>;
    /** Names that have a control of their own in the panel, so the popup can say so. */
    editedInPanel: ReadonlySet<string>;
  },
): PropertySuggestion[] {
  const needle = query.trim().toLowerCase();
  const excluded = new Set([...lists.exclude].map((key) => key.toLowerCase()));
  const edited = new Set([...lists.editedInPanel].map((key) => key.toLowerCase()));
  const seen = new Set<string>();
  const out: PropertySuggestion[] = [];
  const take = (keys: readonly string[], group: PropertyGroup): void => {
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (seen.has(lower) || excluded.has(lower)) continue;
      seen.add(lower);
      if (needle && !lower.includes(needle)) continue;
      out.push(edited.has(lower) ? { key, group, editedInPanel: true } : { key, group });
    }
  };
  take(lists.folia, "folia");
  take(lists.board, "board");
  take(lists.vault, "vault");
  return out;
}
