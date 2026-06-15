// Domain types for the Markdown Kanban model. Everything here is plain data so the
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

export type SubItemKind = "todo" | "card";

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
  todos: number;
  todosDone: number;
  subcards: number;
  comments: number;
}

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
}

export interface ColumnDef {
  id: string;
  title: string;
  color?: string;
  /** Soft work-in-progress limit. The board nudges (does not block) when exceeded. */
  limit?: number;
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
}
