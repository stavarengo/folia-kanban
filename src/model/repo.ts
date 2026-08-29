// The contract the UI depends on. The Obsidian implementation lives in vaultRepo.ts;
// tests use an in-memory fake. Keeping the UI behind this interface is what lets us
// verify board behaviour headlessly.

import type {
  Board,
  CardBody,
  CardFrontmatter,
  ColumnDef,
  ContextConfig,
  RelationType,
} from "./types";
import type { CardMutation } from "./board";
import type { FileOp } from "./pathOps";

export interface CardRepository {
  /**
   * Read the board config note + all cards, return the assembled board. When the card folder is
   * merely worth a remark — it doesn't exist yet, or the setting reads as two existing folders —
   * the board still loads and carries `cardFolderWarning` instead of failing; see
   * {@link Board.cardFolderWarning}.
   */
  loadBoard(): Promise<Board>;
  /**
   * Scan the card folder's immediate subfolders for contexts (#14), keyed by subfolder name.
   * Each subfolder is a context; an optional `_context.md` note supplies its name/color/label/body
   * (missing note → name = folder, no color/label, empty body). Read-only.
   */
  loadContexts(): Promise<Record<string, ContextConfig>>;
  /** Parse a card's body for the detail panel. */
  readBody(path: string): Promise<CardBody>;

  /**
   * Apply a drag result: the card's status + order frontmatter, or — for an inline todo, which has
   * no frontmatter of its own — the `[status:: …]` field and checkbox of its checklist line in the
   * note named by `mutation.path`. Plus a history line when one is given.
   */
  applyMove(mutation: CardMutation): Promise<void>;

  setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void>;
  /** Remove a single frontmatter key (byte-stable for the other keys + their order). */
  unsetFrontmatterKey(path: string, key: string): Promise<void>;
  setDescription(path: string, description: string): Promise<void>;
  addComment(path: string, text: string): Promise<void>;
  /** Replace the text of the index-th comment, keeping its timestamp + every other byte. */
  updateComment(path: string, index: number, text: string): Promise<void>;
  /** Delete the index-th comment line only. */
  removeComment(path: string, index: number): Promise<void>;
  addTodo(path: string, text: string): Promise<void>;
  toggleSubtask(path: string, index: number, done: boolean): Promise<void>;
  removeSubtask(path: string, index: number): Promise<void>;

  /**
   * Declare a relationship of `type` (a key of the board's vocabulary, `BoardConfig.relations`)
   * FROM this card TO `target` (a wikilink target, e.g. another card's file name). Only the
   * declaring end is written — the inverse is derived when the board loads,
   * so a link written here has no second copy anywhere to fall out of step with. A relationship
   * the card already declares is a no-op, and so is one naming the card itself.
   */
  addRelation(path: string, type: RelationType, target: string): Promise<void>;
  /**
   * Drop one relationship this card declares, naming every form its list writes it in (a note can
   * spell the same link more than once). One write, one history line. Targets it does not declare
   * are a no-op — in particular, a card cannot remove a link the OTHER note declared about it,
   * which is why the panel does not offer the button in that case.
   */
  removeRelation(path: string, type: RelationType, targets: readonly string[]): Promise<void>;

  /** Create a new top-level card in a column. Returns its path. */
  createCard(title: string, status: string): Promise<string>;
  /** Create a child card and link it from the parent's checklist. Returns child path. */
  addSubcard(parentPath: string, title: string): Promise<string>;
  /** Move a card's note to the trash. */
  deleteCard(path: string): Promise<void>;
  /**
   * Retitle a card by writing to whichever source its title currently comes from (see
   * `Card.titleSource`): the `title` frontmatter key, the heading line, or the `.md` file name.
   * A file rename goes through Obsidian's link-aware rename so every inbound `[[wikilink]]`
   * (e.g. a parent's `## Subtasks` link) is rewritten to follow. Returns the card's (possibly
   * new) path. A blank/unchanged title is a no-op that returns the original path.
   */
  renameCard(path: string, newTitle: string): Promise<string>;
  /**
   * Rename the card's FILE, whatever source its displayed title happens to come from. This is the
   * card's identity moving, so the rename is link-aware: every inbound `[[wikilink]]` follows.
   * Returns the card's new path, or the original one when the name is blank, unchanged, or
   * unchanged once it has been made safe to use as a file name.
   */
  renameFile(path: string, newBasename: string): Promise<string>;

  /** Persist column definitions to the board note frontmatter. */
  setColumns(columns: ColumnDef[]): Promise<void>;

  /**
   * Fold priority values into the board note's remembered vocabulary, so a value set through the
   * UI survives the last card that used it. Additive on purpose: the note's current list wins on
   * order and is
   * never shrunk, so two edits in flight at once cannot drop each other's value. Writes nothing
   * when every value is already remembered. Pruning the list stays a hand edit of the note.
   */
  rememberPriorities(values: string[]): Promise<void>;

  /**
   * The card note's path on the device's filesystem, or `null` where the vault has none — a vault
   * on mobile, or any other storage that is not a plain folder on disk. Read-only; the plugin never
   * touches a file through it.
   */
  absolutePath(path: string): string | null;

  /** Open a card note in the workspace. */
  openCard(path: string): Promise<void>;

  /**
   * Render markdown into `el` using the host's engine (Obsidian's MarkdownRenderer in the vault
   * adapter; plain text in tests). `sourcePath` resolves links/embeds relative to that note.
   * Returns a cleanup function the caller runs on unmount / before re-rendering.
   */
  renderMarkdown(el: HTMLElement, markdown: string, sourcePath: string): () => void;

  /** Subscribe to external changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;

  /**
   * Subscribe to file renames/moves/deletes, whoever made them — the file explorer, another
   * plugin, an edit straight on disk, or one of this repository's own actions (an in-app rename is
   * a vault rename like any other, and is reported as one). Separate from {@link onChange}, which
   * only says "something changed, reload": path-keyed UI state (the selection, and the per-card
   * maps in plugin data) has to know WHICH path became which, and a reload cannot tell it.
   *
   * Consumers must therefore be idempotent: an in-app rename reaches them here AND through the
   * action's own follow-up, in either order.
   *
   * A folder operation arrives as one op naming the folder, the way the vault reports it — never
   * one per file inside it — so consumers must treat a path as covered by its ancestors too.
   *
   * Returns an unsubscribe function.
   */
  onFileOp(cb: (op: FileOp) => void): () => void;
}
