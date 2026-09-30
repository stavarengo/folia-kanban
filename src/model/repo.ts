// The contract the UI depends on. The Obsidian implementation lives in vaultRepo.ts;
// tests use an in-memory fake. Keeping the UI behind this interface is what lets us
// verify board behaviour headlessly.

import type {
  Board,
  CardBody,
  CardFrontmatter,
  ColumnDef,
  ContextConfig,
  LineDrift,
  LineRef,
  RelationType,
  SubtaskRef,
} from "./types";
import type { CardMutation } from "./board";
import type { ColumnPatch } from "./columns";
import type { FileOp } from "./pathOps";

/**
 * A write that was refused because the note no longer reads the way the caller described it: the
 * line at that index is not the one it meant, so nothing was written at all. Reaches the person as
 * a notice and an agent as a tool failure, both of which say the same thing — read again, then act.
 */
export class StaleLineError extends Error {}

/** A checklist line's column claim, in words — `null` is a line that claims no column of its own. */
function claimWords(claim: string | null): string {
  return claim === null ? "no column of its own" : `"${claim}"`;
}

/** The refusal above, worded for whoever has to act on it. */
export function staleLine(
  kind: "subtask" | "comment",
  path: string,
  at: LineRef & Partial<SubtaskRef>,
  drift: LineDrift,
): StaleLineError {
  const where = `The ${kind} at index ${at.index} of "${path}"`;
  if (drift.what === "box") {
    const box = (ticked: boolean) => (ticked ? "ticked" : "unticked");
    return new StaleLineError(
      `${where} still reads "${at.text}", but its box is ${box(drift.found)} now where this write was decided on it ${box(!drift.found)} — the note changed since it was read, so nothing was written. Read it again and repeat the edit on what is there now.`,
    );
  }
  if (drift.what === "twin") {
    return new StaleLineError(
      `${where} still reads "${at.text}", but it is no longer the same one of the lines reading that — a line was added or removed above it since it was read, so nothing was written. Read it again and repeat the edit on what is there now.`,
    );
  }
  // A claim that moved leaves the line reading exactly as the caller described it, so saying it no
  // longer reads that way would be untrue. What the person needs is the two values: what the line
  // claims now, and the one this write was about to put in its place.
  if (drift.what === "claim" && at.claim !== undefined) {
    return new StaleLineError(
      `${where} still reads "${at.text}", but the line now claims ${claimWords(drift.found)} where this write replaces ${claimWords(at.claim)} — the note changed since it was read, so nothing was written. Read it again and repeat the edit on what is there now.`,
    );
  }
  return new StaleLineError(
    `${where} no longer reads "${at.text}", so that write was refused — the note changed since it was read. Read it again and repeat the edit on what is there now.`,
  );
}

/** What a confirm dialog says: its title, the consequence in a sentence, and the button's verb. */
export interface ConfirmRequest {
  title: string;
  message: string;
  cta: string;
}

/** A row of the host's menu that does something when picked. */
interface MenuAction {
  title: string;
  /** A Lucide icon id, the set the host's own menus draw from. */
  icon?: string;
  /** Present on a row that is one of a set of choices: whether it is the current one. */
  checked?: boolean;
  disabled?: boolean;
  /** Drawn as the host draws a destructive row. */
  warning?: boolean;
  onClick(evt: MouseEvent | KeyboardEvent): void;
}

/** One line of a host menu: an action, a heading over the rows after it, or a separator. */
export type MenuRow = MenuAction | { label: string } | "separator";

/**
 * Where a host menu opens: at the pointer that asked for it, or under an element when there is no
 * pointer to follow. Under an element, focus goes back to that element when the menu closes and
 * nothing else took it.
 */
export type MenuAnchor = { event: MouseEvent } | { below: HTMLElement };

/** Frontmatter keys already in use, split by where the notes carrying them live. */
export interface PropertyNamesInUse {
  /** Keys used by notes inside this board's card folder, alphabetically. */
  inCardFolder: string[];
  /** Keys used anywhere else in the vault, alphabetically, minus the ones above. */
  elsewhere: string[];
}

/** One row of a suggesting input's popup. */
export interface Suggestion {
  /** What the row says, what the typed text is matched against, and what picking it means. */
  text: string;
  /** A quieter second line: where the text comes from, or what it does. */
  note?: string;
}

/**
 * What a suggesting input offers and what it does with the answer. The host owns the popup and the
 * matching (fuzzy, highlighted, best match first); this owns the words, and their order before
 * anything is typed.
 */
export interface SuggestSource {
  /** Everything worth offering for `query`, before matching. */
  candidates(query: string): readonly Suggestion[];
  /**
   * The part of the field the suggestions are for. The whole value when absent; given, the host
   * also re-queries when the caret moves, since the popup itself only listens for typing and focus.
   */
  queryAt?(value: string, caret: number): string;
  /**
   * Whether `query` is free text, which is then offered first when no candidate spells it exactly:
   * the popup pre-selects its first row, and Enter must keep committing what was typed.
   */
  freeText?(query: string): boolean;
  /** The user picked a row, by pointer or by keyboard. */
  onPick(item: Suggestion): void;
}

/** The host's own search field, mounted into an element the caller renders. */
export interface SearchField {
  readonly input: HTMLInputElement;
  /** Show `value` without reporting it back as a change. */
  setValue(value: string): void;
  /** Take the field back out of its container. */
  remove(): void;
}

/**
 * One of the host's own controls, mounted into an element the caller renders. `el` is the element
 * the person sees and operates: the caller gives it its own classes, never the host's.
 */
export interface HostControl {
  readonly el: HTMLElement;
  /** Take the control back out of its container. */
  remove(): void;
}

/** How a mounted control treats the events around it. Read once, when it is mounted. */
export interface HostControlOptions {
  /** Events that stop at the control instead of reaching the elements around it. */
  stopPropagation?: readonly ("click" | "auxclick" | "pointerdown")[];
  /** A press leaves focus where it was, so pressing the control does not blur the field it serves. */
  keepFocus?: boolean;
}

/** The host's text button (Obsidian's `ButtonComponent`). */
export interface ButtonControl extends HostControl {
  setText(text: string): void;
  /** The call-to-action face, for the one button a form is about. */
  setCta(cta: boolean): void;
  setDisabled(disabled: boolean): void;
}

/** The host's icon button (Obsidian's `ExtraButtonComponent`), announced as a button. */
export interface IconButtonControl extends HostControl {
  /** A Lucide icon id, as the host names its icons. */
  setIcon(icon: string): void;
  /** The accessible name, which is also the tooltip. */
  setLabel(label: string): void;
  setDisabled(disabled: boolean): void;
}

export interface IconButtonOptions extends HostControlOptions {
  /** A middle click presses the button too, and stops there. */
  middleClick?: boolean;
}

export interface DropdownOption {
  value: string;
  label: string;
}

/** The host's dropdown (Obsidian's `DropdownComponent`). */
export interface DropdownControl extends HostControl {
  readonly el: HTMLSelectElement;
  /** Replace every option. The selection is the caller's to set again afterwards. */
  setOptions(options: readonly DropdownOption[]): void;
  /** Show `value` without reporting it back as a change. */
  setValue(value: string): void;
  setDisabled(disabled: boolean): void;
}

/** The host's progress bar (Obsidian's `ProgressBarComponent`), a picture with no role of its own. */
export interface ProgressBarControl extends HostControl {
  setValue(percent: number): void;
}

/**
 * Every write below leaves a note byte for byte as it was, history included, when what it would
 * store is what the note already holds. A history line records a change, so no change, no line.
 */
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
   *
   * A checklist line is named by what it said as well as where it sat, and a write that replaces
   * the line's own `[status:: …]` claim also names the claim it replaces (see
   * {@link SubtaskRef.claim}). This throws {@link StaleLineError} and writes nothing when the note no
   * longer reads that way there, or when that claim is not the one the line carries any more.
   *
   * `syncClaim` is the one write decided the other way round — against the claim the note holds
   * when it lands — so it has nothing earlier to refuse over, and moves nothing when the rule
   * moves nothing.
   */
  applyMove(mutation: CardMutation): Promise<void>;

  setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void>;
  /** Remove a single frontmatter key (byte-stable for the other keys + their order). */
  unsetFrontmatterKey(path: string, key: string): Promise<void>;
  setDescription(path: string, description: string): Promise<void>;
  /**
   * Append a comment, signed with `author` when one is given. Left out, the comment is signed with
   * the reader's own **Your name** setting — which is what the board's own panel wants, and what
   * a caller writing on someone else's behalf (the MCP server) must not get by default. An empty
   * `author` is not a third case: it falls back like an absent one.
   */
  addComment(path: string, text: string, author?: string): Promise<void>;
  /**
   * Replace the text of one comment, keeping its timestamp + every other byte. `at` is the entry
   * as the caller read it (see {@link LineRef}); a note that no longer reads that way is left
   * untouched and the call throws {@link StaleLineError}. Same for `removeComment`, `toggleSubtask`
   * and `removeSubtask` — `addTodo` writes a new line and has no earlier reading to keep.
   */
  updateComment(path: string, at: LineRef, text: string): Promise<void>;
  /** Delete one comment line only. */
  removeComment(path: string, at: LineRef): Promise<void>;
  addTodo(path: string, text: string): Promise<void>;
  toggleSubtask(path: string, at: SubtaskRef, done: boolean): Promise<void>;
  removeSubtask(path: string, at: SubtaskRef): Promise<void>;

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
  /** Move a card's note to the trash, without asking: for callers that have no one to ask (MCP). */
  deleteCard(path: string): Promise<void>;
  /**
   * Ask the person whether to trash a card's note, the way the file explorer asks (which honours
   * their "Confirm file deletion" setting), and trash it on a yes. True when the note is gone.
   */
  promptDeleteCard(path: string): Promise<boolean>;
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

  /**
   * Open a card note in the workspace. `evt` is the click that asked for it, passed on so the host
   * can honour the modifier keys the rest of the app honours — a new tab, a split, a new window,
   * or a middle click. It is a DOM `MouseEvent` rather than a decision made by the caller on
   * purpose: which key means "modifier" is the platform's business, and only the host knows the
   * platform. Without an event the note replaces whatever the workspace considers current, which
   * is what an unmodified click has always done.
   */
  openCard(path: string, evt?: MouseEvent): Promise<void>;

  /**
   * Render markdown into `el` using the host's engine (Obsidian's MarkdownRenderer in the vault
   * adapter; plain text in tests). `sourcePath` resolves links/embeds relative to that note.
   * Returns a cleanup function the caller runs on unmount / before re-rendering.
   */
  renderMarkdown(el: HTMLElement, markdown: string, sourcePath: string): () => void;

  /**
   * Follow a click on a link that {@link renderMarkdown} rendered, the way a click on a link
   * anywhere else in the app is followed: the note opens where the click's modifiers ask, as in
   * {@link openCard}. Only a link to a note is followed (see `vaultLinktext`); anything else keeps
   * its default. `beforeOpen` runs once the click is claimed and before the note opens.
   * Returns whether the click was claimed.
   */
  followLink(evt: MouseEvent, sourcePath: string, beforeOpen?: () => void): boolean;

  /**
   * The frontmatter keys notes already use, read from the host's metadata index rather than by
   * parsing files here, split by whether the note lives in this board's card folder. Only the
   * adapter knows where that folder resolves to, which is why the split is made there and not by
   * the caller. Keys the board note itself carries are left out: they configure the board, and a
   * card is not a board.
   *
   * Read when the detail panel opens, not per keystroke — a large vault has thousands of notes,
   * and the answer only moves when notes do, which is also when the board reloads.
   */
  propertyNamesInUse(): Promise<PropertyNamesInUse>;

  /**
   * Attach the host's own type-ahead to a text input (Obsidian's `AbstractInputSuggest` in the
   * vault adapter). `source` stays live for as long as the attachment does, so the caller feeds
   * fresh suggestions through it instead of re-attaching. Returns a cleanup function the caller
   * runs on unmount.
   */
  attachSuggest(input: HTMLInputElement, source: SuggestSource): () => void;

  /** Mount the host's search field (Obsidian's `SearchComponent`, clear button included). */
  mountSearch(container: HTMLElement, onChange: (value: string) => void): SearchField;

  mountButton(
    container: HTMLElement,
    onClick: (evt: MouseEvent) => void,
    options?: HostControlOptions,
  ): ButtonControl;

  /**
   * `onClick` gets the pointer's click, modifiers and all, and nothing for a key press: the host
   * presses its icon buttons from the keyboard without a click.
   */
  mountIconButton(
    container: HTMLElement,
    onClick: (evt?: MouseEvent) => void,
    options?: IconButtonOptions,
  ): IconButtonControl;

  mountDropdown(container: HTMLElement, onChange: (value: string) => void): DropdownControl;

  mountProgressBar(container: HTMLElement): ProgressBarControl;

  /** Tell the person something in the host's own notice, an error staying up longer. */
  showNotice(message: string, tone: "success" | "error"): void;

  /** Ask the person to confirm a destructive action in the host's dialog. True on confirm. */
  confirm(request: ConfirmRequest): Promise<boolean>;

  /**
   * Open the host's "Edit column" dialog on `column`. `onSave` gets the patch when the person
   * saves; closing the dialog any other way saves nothing.
   */
  editColumn(column: ColumnDef, onSave: (patch: ColumnPatch) => void): void;

  /** Show the host's own menu of `rows` at `at`. It closes on a pick or a dismiss. */
  showMenu(rows: readonly MenuRow[], at: MenuAnchor): void;

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
