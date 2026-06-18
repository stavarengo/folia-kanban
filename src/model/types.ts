// Domain types for the Folia Kanban model. Everything here is plain data so the
// model layer stays pure and unit-testable with no Obsidian dependency.

export interface CardFrontmatter {
  status?: string;
  /** Position within its column / parent. Fractional ranks allow single-card moves. */
  order?: number;
  priority?: string;
  area?: string;
  due?: string;
  [key: string]: unknown;
}

type SubItemKind = "todo" | "card";

/** One line of a card's `## Subtasks` checklist: either a plain todo or a link to a
 *  child card (a subcard). The link target is the single source of truth for parentage. */
export interface SubItem {
  kind: SubItemKind;
  /** Raw text after the checkbox. For a card, this is the full `[[link]]` text. */
  text: string;
  done: boolean;
  /** For kind === "card": the resolved link target (basename or path inside `[[ ]]`). */
  link?: string;
  /** 0-based position among checklist items in the Subtasks section (stable edit handle). */
  index: number;
}

export interface Comment {
  timestamp: string;
  text: string;
}

export interface HistoryEntry {
  timestamp: string;
  text: string;
}

/** Read-only parse of a card markdown body, for display. */
export interface CardBody {
  title: string;
  description: string;
  subtasks: SubItem[];
  comments: Comment[];
  history: HistoryEntry[];
}

/** Cheap display counters, precomputed while bodies are read during load. */
export interface CardStats {
  /** Every `## Subtasks` checklist line — plain todos AND subcard-links — counted by line. */
  checklist: number;
  /** Of those checklist lines, how many are checked. */
  checklistDone: number;
  /** Subcard-link checklist lines only (git-branch info). */
  subcards: number;
  comments: number;
  /** The undone plain todos in document order, capped at the first 5 (inline display). `index` is
   *  the `SubItem.index` (0-based among ALL checklist lines) so a rendered row can be toggled later. */
  nextTodos: { text: string; index: number }[];
}

/** How aggressively non-move mutations append `## History` lines. Default `'moves'`. */
export type HistoryScope = "moves" | "structural" | "all";

/** A card as the board needs it: identity + frontmatter + the child links it declares. */
export interface Card {
  /** Vault-relative path, e.g. "Cards/My task.md". */
  path: string;
  /** Filename without extension — used as the `[[link]]` target and display title. */
  basename: string;
  frontmatter: CardFrontmatter;
  /** Link targets of the card-subtasks (the `[[...]]` checklist items), in order. */
  childLinks: string[];
  /** Optional precomputed display stats (ignored by board logic). */
  stats?: CardStats;
  /**
   * Context (#14): the immediate subfolder of the board's card folder this card lives under
   * (`<cardFolder>/<context>/Foo.md` → `<context>`). Path-derived, NOT written to frontmatter —
   * a card directly in the card folder has no context. Fed by `deriveContext` during load.
   */
  context?: string;
}

/**
 * A context (#14): a user-defined grouping that maps to an immediate subfolder of the board's
 * card folder. Optionally configured by a `_context.md` note inside that subfolder. Plain data,
 * read-only for the plugin — the note is rendered, never rewritten.
 */
export interface ContextConfig {
  /** Display name (`context-name` in `_context.md`, defaults to the folder name). */
  name: string;
  /** Accent color used for the card grouping marker (`color`). */
  color?: string;
  /** Short badge text shown on member cards (`label`). */
  label?: string;
  /** The `_context.md` body markdown (the context's "home page"); empty when no note exists. */
  body: string;
  /** The subfolder name (= the key cards derive their `context` from). */
  folder: string;
}

/** How cards inside a column are grouped before rendering (#6). `none` = no grouping. */
export type ColumnGroup = "none" | "due";

/** How cards inside a (group of a) column are ordered (#6). `manual` = the board's fractional order. */
export type ColumnSort = "manual" | "priority" | "due";

export interface ColumnDef {
  id: string;
  title: string;
  color?: string;
  /** Soft work-in-progress limit. The board nudges (does not block) when exceeded. */
  limit?: number;
  /**
   * Auto-population rule for the column (#1). A filter-grammar query string (see cardView
   * `parseFilter`/`matchCard`), e.g. `"area:research status:todo"`. When set, the render layer shows
   * only matching cards. Absent = the column shows whatever has its `status` (current behavior).
   */
  filter?: string;
  /** Grouping of cards within the column (#6). Default `"none"` = current behavior. */
  group?: ColumnGroup;
  /** Sort of cards within the column / its groups (#6). Default `"manual"` = board fractional order. */
  sort?: ColumnSort;
  /** Resting opacity 0–1 for de-emphasis (#10). Default `1` (fully opaque). Clamped to [0,1]. */
  opacity?: number;
  /** Opacity 0–1 to reveal on hover when the column is faded (#10). Clamped to [0,1]. */
  hoverOpacity?: number;
  /**
   * "Park aside" (#10): when true the render layer shoves the column to the far right with a
   * large left margin and (typically) fades it, so a rabbit-hole column hides off-screen.
   * Default `false`.
   */
  parked?: boolean;
}

export interface BoardConfig {
  /** Path of the board definition note. */
  path: string;
  columns: ColumnDef[];
  /** Vault folder that holds the card files. */
  cardFolder: string;
}

export interface Board {
  config: BoardConfig;
  /** Top-level card paths per column id, sorted by order. */
  columns: Record<string, string[]>;
  /** path -> card */
  cards: Record<string, Card>;
  /** path -> parent path (only for subcards). */
  parentOf: Record<string, string>;
  /** parent path -> ordered child paths; subcards are rendered nested, not in columns. */
  childrenOf: Record<string, string[]>;
  /** Context configs keyed by subfolder name (#14). Empty when the board has no subfolders. */
  contexts: Record<string, ContextConfig>;
}
