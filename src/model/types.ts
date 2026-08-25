// Domain types for the Folia Kanban model. Everything here is plain data so the
// model layer stays pure and unit-testable with no Obsidian dependency.

import type { CommentMark } from "./unread";

/** The board-level `card-title` property. `auto` = guess per card from the file name's shape. */
export type TitleMode = "auto" | "filename" | "heading";

/**
 * Which source produced a card's title (and which one a rename must write to).
 *
 * `subtask` belongs to the synthetic cards the board builds for inline todos placed in their own
 * column: their title is a checklist line, not a file, so there is nothing for a rename to write
 * to — the write paths refuse it rather than guess.
 */
export type TitleSource = "filename" | "heading" | "frontmatter" | "subtask";

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
  /**
   * The column this line claims for itself, from an inline `[status:: doing]` field on the line.
   * Absent when the line carries no such field, which means "wherever my parent is" — the way
   * every checklist line behaved before subitems could be placed. Only read for `kind === "todo"`:
   * a subcard link is a file, and a file's own `status` frontmatter is its single source of truth.
   */
  status?: string;
  /** 0-based position among checklist items in the Subtasks section (stable edit handle). */
  index: number;
}

// Only referenced by CardBody below (not imported elsewhere), so kept module-private.
interface Comment {
  timestamp: string;
  text: string;
  /**
   * Who wrote it, from the optional `@name` inside the line's italic prefix
   * (`- _2026-08-21 11:49 @rafa:_ text`). `null` when the line carries none — every comment written
   * before authorship existed, and every one written by someone who set no name.
   */
  author: string | null;
}

interface HistoryEntry {
  timestamp: string;
  text: string;
  /**
   * Always `null` for anything the plugin wrote — `appendHistory` never signs a line. It exists
   * because the reader is shared with `## Comments`, so a hand-signed history line is carried
   * rather than quietly dropped, and the type says what the reader actually returns.
   */
  author: string | null;
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
  /**
   * Each comment reduced to its timestamp + author, in document order — everything the unread
   * markers need without carrying comment text onto the board. Same length as `comments`.
   */
  commentMarks: CommentMark[];
  /**
   * The outstanding plain todos in document order. `index` is the `SubItem.index` (0-based among
   * ALL checklist lines) so a rendered row can be toggled later.
   *
   * Deliberately NOT capped here. `buildBoard` removes the ones standing in a column of their own,
   * and a cap applied before that removal could empty the list of a card whose first few todos
   * happen to be placed while others are still waiting. The render layer takes the first N.
   */
  nextTodos: { text: string; index: number }[];
}

/** How aggressively non-move mutations append `## History` lines. Default `'moves'`. */
export type HistoryScope = "moves" | "structural" | "all";

/**
 * The relationship vocabulary: a typed, NON-hierarchical link between two cards (parentage stays
 * the `## Subtasks` checklist and is not a relationship type). Only `blocks` exists today; every
 * link carries its type so a second one is additive rather than a reshape of what this version
 * writes into people's notes.
 */
export type RelationType = "blocks";

/**
 * Where a link was declared, which decides whether the card showing it may also remove it.
 *
 * `own` — this card's own frontmatter holds it, and nothing else does, so removing it is one write
 * to this note and the relationship is gone.
 * `inverse` — the OTHER card declared it, so it is shown here but only that note can drop it.
 * `both` — each note states it from its own end. Removing either alone would leave the other to
 * re-derive it on the next load, so neither side offers a button that could not keep its promise.
 */
type RelationSource = "own" | "inverse" | "both";

/** One end of a relationship, as one card sees it. */
export interface RelationLink {
  type: RelationType;
  /** The link text as the declaring note first writes it — what a row shows. */
  target: string;
  /**
   * Every way that note writes this one link, `target` first. A hand-edited note can spell the
   * same relationship more than once — `[[B]]` and `[[Tasks/B]]` both name one card — and clearing
   * it has to clear all of them, or the row it showed comes back on the next load.
   */
  targets: string[];
  /** Vault path of the card the target resolves to, or `null` when no card on the board matches. */
  path: string | null;
  source: RelationSource;
}

// Only referenced by Card below (not imported elsewhere), so kept module-private.
/** Both directions of a card's relationships, already resolved against the board. */
interface CardRelations {
  /** Cards this one blocks (outgoing) — the direction that is written to frontmatter. */
  blocks: RelationLink[];
  /** Cards blocking this one (incoming) — derived at load time, never written. */
  blockedBy: RelationLink[];
}

/** A card as the board needs it: identity + frontmatter + the child links it declares. */
export interface Card {
  /** Vault-relative path, e.g. "Cards/My task.md". */
  path: string;
  /** Filename without extension — the card's identity and the `[[link]]` target. */
  basename: string;
  /** What people see, search and sort by. Equals `basename` unless a heading or `title` key won. */
  title: string;
  /** Which source produced `title`; a rename writes back to that same source. */
  titleSource: TitleSource;
  frontmatter: CardFrontmatter;
  /** Link targets of the card-subtasks (the `[[...]]` checklist items), in order. */
  childLinks: string[];
  /**
   * The card's parsed `## Subtasks` checklist, when the loader read the body. `buildBoard` needs it
   * to see which inline todos claim a column of their own (`SubItem.status`); nothing else does.
   */
  subItems?: SubItem[];
  /**
   * Set ONLY on the synthetic cards `buildBoard` mints for an inline todo that sits in its own
   * column: the file that owns the checklist line, the line's `SubItem.index` inside it, and the
   * `[status:: …]` value that line literally carries. Its `path` is synthetic (see `makeTodoPath`)
   * and names no file, so every write path must route through the parent named here instead of
   * treating `Card.path` as a vault path.
   *
   * `claim` is the line's own words, NOT where the tile renders — a checked line sits in the done
   * column whatever it claims. A picker must show the claim, or choosing the column it already
   * displays would silently rewrite the line to something else.
   */
  todoRef?: { parentPath: string; index: number; claim: string };
  /** Optional precomputed display stats (ignored by board logic). */
  stats?: CardStats;
  /**
   * Context (#14): the immediate subfolder of the board's card folder this card lives under
   * (`<cardFolder>/<context>/Foo.md` → `<context>`). Path-derived, NOT written to frontmatter —
   * a card directly in the card folder has no context. Fed by `deriveContext` during load.
   */
  context?: string;
  /**
   * Typed relationships to other cards, both directions, resolved against the board. Filled by
   * `buildBoard` from the `blocks` / `blocked-by` frontmatter keys — derived, never written back
   * as a whole (only the outgoing `blocks` list is ever written, by the card that declares it).
   */
  relations?: CardRelations;
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
  /**
   * Vault path of the folder holding the card files: the single already-resolved value every
   * consumer shares. The adapter derives it once from the board note's `card-folder` property,
   * which may name it from the vault root or relative to the board note, so this is never the raw
   * property text — and never the vault root, which is refused rather than resolved.
   */
  cardFolder: string;
  /** Where card titles come from (`card-title` in the board note). Default `auto`. */
  titleMode: TitleMode;
  /**
   * The priority values this board remembers (`priorities` in the board note), in the order the
   * board note lists them. This is the board's own vocabulary, not a fixed scale the plugin
   * imposes: it is what the priority field offers as suggestions, and it outlives the cards that
   * introduced each value. Empty for a board that has never had a priority set through the UI —
   * the values its cards currently carry are still offered, they are just not remembered yet.
   */
  priorities: string[];
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
  /**
   * The subitems standing in a column of their own — inline todos and subcard files alike — mapped
   * to the card they belong to. A path is present here exactly when it renders as a tile in a column
   * yet is somebody's subitem, which is what makes it the right source for the `↳ parent` reference:
   * `parentOf` also links the members of a subcard cycle to each other, and those render top-level.
   */
  placedOf: Record<string, string>;
  /** Context configs keyed by subfolder name (#14). Empty when the board has no subfolders. */
  contexts: Record<string, ContextConfig>;
  /**
   * Set when the card folder needs a word said about it while the board still loads normally.
   * Two situations qualify:
   *
   * - `config.cardFolder` doesn't currently exist — a typo, a folder that moved, or a board that
   *   never got its first card yet (the `Tasks` default, or an explicit `card-folder` nobody
   *   created). No cards can live in a folder that isn't there, so the board comes out empty and
   *   the UI says why instead of looking genuinely empty; adding the first card still creates
   *   the folder, same as before.
   * - `card-folder` reads as two different existing folders (one from the vault root, one beside
   *   the board note) and the board had to pick one. Nothing is broken, but the other folder is
   *   sitting right there, so the choice is named rather than left to look like an empty board.
   *
   * A `card-folder` that resolves to something other than a folder (e.g. a file already sits
   * there), or to no usable folder at all, has no such self-heal path, so those cases fail the
   * load outright instead of setting this field.
   */
  cardFolderWarning?: string;
}
