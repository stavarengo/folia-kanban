import type { App, TFile } from "obsidian";
import { FileSystemAdapter, Keymap } from "obsidian";
import type {
  Board,
  Card,
  CardBody,
  CardFrontmatter,
  ColumnDef,
  ContextConfig,
  HistoryScope,
  LineRef,
  SubtaskRef,
  RelationType,
} from "../model/types";
import type { CardMutation } from "../model/board";
import type {
  ButtonControl,
  ConfirmRequest,
  DropdownControl,
  HostControlOptions,
  IconButtonControl,
  IconButtonOptions,
  MenuAnchor,
  MenuRow,
  ProgressBarControl,
  PropertyNamesInUse,
  SearchField,
  SuggestSource,
} from "../model/repo";
import type { ColumnPatch } from "../model/columns";
import { boardNotice, confirmAction, promptTrash } from "./dialogs";
import { openColumnEditor } from "./columnEditModal";
import { showMenu } from "./menu";
import { attachSuggest, mountSearch } from "./inputSuggest";
import { mountButton, mountDropdown, mountIconButton, mountProgressBar } from "./hostControls";
import { drawIcon } from "./icons";
import { pathTaken } from "./pathTaken";
import { uniqueNotePath } from "./boardNote";
import { buildBoard } from "../model/board";
import { normalizeColumns, scalarText, serializeColumns } from "../model/columns";
import { mergePriorities, normalizePriorities, serializePriorities } from "../model/priorities";
import { dateOnly, stamp } from "../model/dates";
import {
  SECTION,
  addSubcard as addSubcardText,
  addTodo as addTodoText,
  appendComment,
  appendHistory,
  parseBody,
  removeSubtask as removeSubtaskText,
  removeTimestampedLine,
  setDescription as setDescriptionText,
  setSubtaskDone,
  updateTimestampedLine,
} from "../model/card";
import { isSelfRelation, withRelation, withoutRelation } from "../model/relationships";
import {
  commentAddedLine,
  commentEditedLine,
  commentRemovedLine,
  dueLine,
  historyAllows,
  type HistoryEventKind,
  priorityLine,
  relationAddedLine,
  relationRemovedLine,
  statusLine,
  subtaskAddedLine,
  subtaskDoneLine,
  subtaskReopenedLine,
  subtaskRemovedLine,
} from "../model/history";
import { TITLE_KEY, resolveTitle, sanitizeFilename, setHeadingTitle } from "../model/cardTitle";
import type { CardRepository } from "../model/repo";
import type { FileOp } from "../model/pathOps";
import { parseFrontmatter, sameValue } from "./frontmatter";
import {
  ambiguousCaseMessage,
  inspectCardFolder,
  readBoardConfig,
  readBoardFrontmatter,
  type ResolvedBoardConfig,
} from "./boardConfig";
import { cardFilesIn, readCard, readContexts } from "./cardNotes";
import { NoteWriter } from "./noteWriter";
import { followLink, linkTextTo, relationTargetPath, resolveLink } from "./vaultLinks";
import { renderMarkdown } from "./markdownRender";
import { collectPropertyNames } from "./propertyNames";
import { watchFileOps, watchVault } from "./vaultEvents";
import { applyMove } from "./applyMove";

export class VaultRepository implements CardRepository {
  private writer: NoteWriter;
  /**
   * Where the last load found this board's cards (`<cardFolder>/`), so `onChange` can tell a
   * metadata-cache catch-up that concerns this board from one anywhere else in the vault.
   */
  private cardFolderPrefix: string | null = null;

  constructor(
    private app: App,
    private boardPath: string,
    /** Live source of the current history scope. Defaults to 'moves' = no extra history. */
    public getHistoryScope: () => HistoryScope = () => "moves",
    /** Live source of the name new comments are signed with. Empty = write them unsigned. */
    public getUserName: () => string = () => "",
  ) {
    this.writer = new NoteWriter(app);
  }

  /**
   * Append a history line for `kind` only when the current scope allows it. Called only after a
   * write that changed the note: a history line records a change, so an edit that left the note as
   * it was has nothing to record.
   */
  private async maybeHistory(path: string, kind: HistoryEventKind, line: string): Promise<void> {
    if (!historyAllows(this.getHistoryScope(), kind)) return;
    await this.writer.editBody(path, (t) => appendHistory(t, line, stamp()));
  }

  private file(path: string): TFile {
    return this.writer.file(path);
  }

  /**
   * What {@link propertyNamesInUse} last answered, kept for as long as the board it belongs to is
   * unchanged (see `loadBoard`). Without it, every card opened would walk the whole vault again.
   */
  private propertyNames: PropertyNamesInUse | null = null;

  private async readConfig(): Promise<ResolvedBoardConfig> {
    return readBoardConfig(this.app, this.file(this.boardPath), this.boardPath);
  }

  async loadBoard(): Promise<Board> {
    // Every load follows something changing in the vault, which is also when the keys its notes use
    // can have changed. Dropping the memo here is what keeps the panel's suggestions current
    // without re-walking the vault each time a card is opened.
    this.propertyNames = null;
    const config = await this.readConfig();
    const { folder, warning: cardFolderWarning } = inspectCardFolder(
      this.app,
      config,
      this.boardPath,
    );
    this.cardFolderPrefix = config.cardFolder + "/";
    const cards: Card[] = [];
    for (const f of folder === null ? [] : cardFilesIn(folder, this.boardPath))
      cards.push(await readCard(this.app, f, config.titleMode));
    // buildBoard derives each card's `context` from its path; carry the configs alongside.
    const board = buildBoard(
      config,
      cards,
      await this.loadContexts(config.cardFolder),
      (link, source) => resolveLink(this.app, link, source),
    );
    return cardFolderWarning ? { ...board, cardFolderWarning } : board;
  }

  async loadContexts(cardFolder?: string): Promise<Record<string, ContextConfig>> {
    // Already the resolved path when it comes from a caller — `readConfig` is the only place that
    // turns the raw property into one, so re-normalizing here could only make the two disagree.
    const folderPath = cardFolder ?? (await this.readConfig()).cardFolder;
    return readContexts(this.app, folderPath);
  }

  async readBody(path: string): Promise<CardBody> {
    return parseBody(await this.app.vault.cachedRead(this.file(path)));
  }

  async setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void> {
    const changed = await this.writer.writeFrontmatter(path, patch);
    // One concise line per changed key the policy recognizes. `order` is move-managed and has no
    // field-edit history string, so it's skipped here.
    for (const k of changed) {
      const v = String(patch[k]);
      if (k === "priority") await this.maybeHistory(path, "priority", priorityLine(v));
      else if (k === "due") await this.maybeHistory(path, "due", dueLine(v));
      else if (k === "status") await this.maybeHistory(path, "status", statusLine(v));
    }
  }

  async unsetFrontmatterKey(path: string, key: string): Promise<void> {
    await this.writer.unsetKey(path, key);
  }

  async applyMove(mutation: CardMutation): Promise<void> {
    await applyMove(this.app, this.writer, mutation, (path, kind, line) =>
      this.maybeHistory(path, kind, line),
    );
  }

  async setDescription(path: string, description: string): Promise<void> {
    // No history kind maps to a description edit, so this stays ungated.
    await this.writer.editBody(path, (t) => setDescriptionText(t, description));
  }
  async addComment(path: string, text: string, author?: string): Promise<void> {
    const signature = author || this.getUserName();
    // One stamp for both runs of the edit, so they agree on the line they add.
    const at = stamp();
    if (await this.writer.editBody(path, (t) => appendComment(t, text, at, signature)))
      await this.maybeHistory(path, "comment", commentAddedLine());
  }
  async updateComment(path: string, at: LineRef, text: string): Promise<void> {
    const changed = await this.writer.editLine(path, { kind: "comment", at }, (t) =>
      updateTimestampedLine(t, SECTION.comments, at.index, text),
    );
    if (changed) await this.maybeHistory(path, "comment", commentEditedLine());
  }
  async removeComment(path: string, at: LineRef): Promise<void> {
    const changed = await this.writer.editLine(path, { kind: "comment", at }, (t) =>
      removeTimestampedLine(t, SECTION.comments, at.index),
    );
    if (changed) await this.maybeHistory(path, "comment", commentRemovedLine());
  }
  async addTodo(path: string, text: string): Promise<void> {
    if (await this.writer.editBody(path, (t) => addTodoText(t, text)))
      await this.maybeHistory(path, "subtask", subtaskAddedLine(text));
  }
  async toggleSubtask(path: string, at: SubtaskRef, done: boolean): Promise<void> {
    // The history line names `at.text`, and the write only lands while the note still reads that
    // way — so the record and the tick are the same line, with nothing read separately to disagree.
    // A box already standing where it was sent is left alone, and so is its record.
    const changed = await this.writer.editLine(path, { kind: "subtask", at }, (t) =>
      setSubtaskDone(t, at.index, done),
    );
    if (!changed) return;
    await this.maybeHistory(
      path,
      "subtask",
      done ? subtaskDoneLine(at.text) : subtaskReopenedLine(at.text),
    );
  }
  async removeSubtask(path: string, at: SubtaskRef): Promise<void> {
    const changed = await this.writer.editLine(path, { kind: "subtask", at }, (t) =>
      removeSubtaskText(t, at.index),
    );
    if (changed) await this.maybeHistory(path, "subtask", subtaskRemovedLine(at.text));
  }

  /**
   * Only a type the board note's vocabulary names may be written: `type` is used as a frontmatter
   * key, and a caller passing anything else would overwrite a property nothing reads as a link.
   */
  private async knownRelation(type: RelationType): Promise<boolean> {
    return (await this.readConfig()).relations.some((t) => t.key === type);
  }

  async addRelation(path: string, type: RelationType, target: string): Promise<void> {
    // Refused at the write, not just hidden at the read: a self-link is dropped when the board is
    // built, so storing one would put a line in the note that no panel can show or take back.
    // Where the vault names the note, that answer settles it: a target is a self-link when it
    // reaches this very note, whatever it was spelled as. Only a target the vault cannot place —
    // a card that is not there yet, or one carrying an anchor — falls back to comparing names.
    const targetPath = relationTargetPath(this.app, target, path);
    const self =
      targetPath !== null
        ? targetPath === path
        : isSelfRelation(path, this.file(path).basename, target);
    if (self) return;
    if (!(await this.knownRelation(type))) return;
    // Same reason as `addSubcard`: whatever the caller named the card, the note gets the link this
    // vault would write to it, so the board reads back the card the caller meant. A target naming
    // no note (a link to a card that is not there yet) is stored exactly as it was typed.
    const written = targetPath === null ? target : linkTextTo(this.app, targetPath, path);
    const changed = await this.writer.editRelations(path, type, (fm) =>
      withRelation(fm, type, written),
    );
    if (changed) await this.maybeHistory(path, "relation", relationAddedLine(type, written));
  }

  async removeRelation(
    path: string,
    type: RelationType,
    targets: readonly string[],
  ): Promise<void> {
    if (!(await this.knownRelation(type))) return;
    const changed = await this.writer.editRelations(path, type, (fm) =>
      withoutRelation(fm, type, targets),
    );
    // One line for the relationship, named by the form the panel showed — not one per spelling.
    const shown = targets[0];
    if (changed && shown !== undefined)
      await this.maybeHistory(path, "relation", relationRemovedLine(type, shown));
  }

  private uniquePath(folder: string, title: string, except?: string): string {
    return uniqueNotePath(folder, sanitizeFilename(title), pathTaken(this.app.vault, except));
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
  }

  async createCard(title: string, status: string): Promise<string> {
    const config = await this.readConfig();
    // Creating the folder as written would only add one more spelling beside the ones already there.
    if (config.cardFolderCaseMatches.length > 1) throw new Error(ambiguousCaseMessage(config));
    await this.ensureFolder(config.cardFolder);
    const path = this.uniquePath(config.cardFolder, title);
    this.writer.markWrite(path);
    // Create the body first, then let Obsidian serialize the frontmatter — never hand-build
    // YAML (an odd column id / title could otherwise produce malformed frontmatter).
    const file = await this.app.vault.create(path, `# ${title}\n`);
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm["type"] = "task";
      fm["status"] = status;
      fm["created"] = dateOnly();
    });
    return path;
  }

  async addSubcard(parentPath: string, title: string): Promise<string> {
    // Read the parent status from write-fresh text (metadataCache can lag a just-written status).
    const parentFm = parseFrontmatter(await this.app.vault.cachedRead(this.file(parentPath)));
    // Unquoted YAML turns `status: 2` into a number, and a column id may legitimately be one, so
    // scalars are kept as text — but a mapping or a list is corruption, and coercing it would
    // create the subcard in a column named "[object Object]".
    const parentStatus = scalarText(parentFm["status"]);
    const childPath = await this.createCard(title, parentStatus || "todo");
    // Written the way THIS vault writes links, from this parent: a bare file name is ambiguous the
    // moment a second note takes it, and Folia would then write a link Folia cannot read back.
    await this.writer.editBody(parentPath, (t) =>
      addSubcardText(t, linkTextTo(this.app, childPath, parentPath)),
    );
    return childPath;
  }

  async setColumns(columns: ColumnDef[]): Promise<void> {
    const value = serializeColumns(columns);
    // Compared as the board reads them, so a hand-written `columns: [todo, done]` saved unchanged
    // is not expanded into the long form behind the person's back.
    const fm = await this.writer.currentFrontmatter(this.boardPath);
    if (fm !== null && sameValue(serializeColumns(normalizeColumns(fm["columns"])), value)) return;
    await this.writer.writeFrontmatter(this.boardPath, { columns: value });
  }

  async rememberPriorities(values: string[]): Promise<void> {
    const boardFile = this.file(this.boardPath);
    // Decide whether to write BEFORE opening the write. `processFrontMatter` re-serializes the
    // whole frontmatter block whether or not the callback changes anything, so a callback that
    // bails out still rewrites the note — it reflows other properties (it drops the quotes from
    // `filter: "priority:a"`, for one). Setting a priority the board already knows is the common
    // case, so that would churn the board note on nearly every priority edit.
    const current = normalizePriorities(
      (await readBoardFrontmatter(this.app, boardFile, this.boardPath))["priorities"],
    );
    if (mergePriorities(current, values) === null) return;

    this.writer.markWrite(this.boardPath);
    await this.app.fileManager.processFrontMatter(boardFile, (fm: Record<string, unknown>) => {
      // Merge again, now against the note as it is INSIDE the write rather than the snapshot read
      // above: that is what makes a second edit landing mid-reload additive rather than a clobber.
      const merged = mergePriorities(normalizePriorities(fm["priorities"]), values);
      if (merged === null) return;
      const value = serializePriorities(merged);
      // A board that learns nothing never gains a `priorities:` key (the same byte-stability
      // contract `serializeColumns` documents).
      if (value !== null) fm["priorities"] = value;
    });
  }

  async deleteCard(path: string): Promise<void> {
    this.writer.markWrite(path);
    await this.app.fileManager.trashFile(this.file(path));
  }

  async promptDeleteCard(path: string): Promise<boolean> {
    this.writer.markWrite(path);
    const gone = await promptTrash(this.app, this.file(path));
    // Nothing was written, so a change arriving now is somebody else's and must reload the board.
    if (!gone) this.writer.forgetWrite(path);
    return gone;
  }

  showNotice(message: string, tone: "success" | "error"): void {
    boardNotice(message, tone);
  }

  confirm(request: ConfirmRequest): Promise<boolean> {
    return confirmAction(this.app, request);
  }

  editColumn(column: ColumnDef, onSave: (patch: ColumnPatch) => void): void {
    openColumnEditor(this.app, column, onSave);
  }

  showMenu(rows: readonly MenuRow[], at: MenuAnchor): void {
    showMenu(rows, at);
  }

  async renameCard(path: string, newTitle: string): Promise<string> {
    const file = this.file(path);
    // Write the new title to whichever source currently produces it, so the tile changes the way
    // the person expects: the `title` key, the heading line, or (only then) the file name.
    const title = newTitle.trim();
    if (!title) return path; // blank title — no-op, per the CardRepository contract
    const { titleMode } = await this.readConfig();
    const text = await this.app.vault.cachedRead(file);
    const { title: current, source } = resolveTitle(
      file.basename,
      parseFrontmatter(text),
      text,
      titleMode,
    );
    if (title === current) return path; // unchanged — no write
    if (source === "frontmatter") {
      await this.writer.writeFrontmatter(path, { [TITLE_KEY]: title });
      return path;
    }
    if (source === "heading") {
      await this.writer.editBody(path, (t) => setHeadingTitle(t, file.basename, titleMode, title));
      return path;
    }
    return this.renameFile(path, title);
  }

  async renameFile(path: string, newBasename: string): Promise<string> {
    const file = this.file(path);
    const wanted = newBasename.trim();
    if (!wanted) return path; // a blank name is not a name — nothing to rename to
    const base = sanitizeFilename(wanted);
    if (base === file.basename) return path; // unchanged once made safe to use as a file name
    const folder = file.parent?.path ?? "";
    const dest = this.uniquePath(folder === "/" ? "" : folder, base, file.path);
    if (dest === path) return path;
    this.writer.markWrite(path);
    this.writer.markWrite(dest);
    // fileManager.renameFile rewrites inbound [[links]] (the parent's ## Subtasks link survives).
    await this.app.fileManager.renameFile(file, dest);
    return dest;
  }

  async openCard(path: string, evt?: MouseEvent): Promise<void> {
    // `Keymap.isModEvent` is the whole of Obsidian's own answer to "where did this click want the
    // note": false for a plain click, "tab" for Mod or a middle click, "split" for Mod+Alt,
    // "window" for Mod+Alt+Shift — and `getLeaf` takes exactly that. Deciding it here rather than
    // in the UI keeps the platform question (Mod is Cmd on macOS, Ctrl elsewhere) with the only
    // layer allowed to ask Obsidian. `openFile` rather than `openLinkText`: the file is already
    // resolved, and re-resolving a name would be free to land on a different note.
    await this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(this.file(path));
  }

  followLink(evt: MouseEvent, sourcePath: string, beforeOpen?: () => void): boolean {
    return followLink(this.app, evt, sourcePath, beforeOpen);
  }

  renderMarkdown(el: HTMLElement, markdown: string, sourcePath: string): () => void {
    return renderMarkdown(this.app, el, markdown, sourcePath);
  }

  async propertyNamesInUse(): Promise<PropertyNamesInUse> {
    this.propertyNames ??= collectPropertyNames(
      this.app,
      this.boardPath,
      (await this.readConfig()).cardFolder,
    );
    return this.propertyNames;
  }

  attachSuggest(input: HTMLInputElement, source: SuggestSource): () => void {
    return attachSuggest(this.app, input, source);
  }

  mountSearch(container: HTMLElement, onChange: (value: string) => void): SearchField {
    return mountSearch(container, onChange);
  }

  mountButton(
    container: HTMLElement,
    onClick: (evt: MouseEvent) => void,
    options?: HostControlOptions,
  ): ButtonControl {
    return mountButton(container, onClick, options);
  }

  mountIconButton(
    container: HTMLElement,
    onClick: (evt?: MouseEvent) => void,
    options?: IconButtonOptions,
  ): IconButtonControl {
    return mountIconButton(container, onClick, options);
  }

  mountDropdown(container: HTMLElement, onChange: (value: string) => void): DropdownControl {
    return mountDropdown(container, onChange);
  }

  mountProgressBar(container: HTMLElement): ProgressBarControl {
    return mountProgressBar(container);
  }

  drawIcon(container: HTMLElement, icon: string): void {
    drawIcon(container, icon);
  }

  absolutePath(path: string): string | null {
    const adapter = this.app.vault.adapter;
    // Desktop vaults are folders on disk; a mobile (Capacitor) vault is not, and has no path a
    // person could paste anywhere outside Obsidian.
    return adapter instanceof FileSystemAdapter ? adapter.getFullPath(path) : null;
  }

  onFileOp(cb: (op: FileOp) => void): () => void {
    return watchFileOps(this.app, cb);
  }

  onChange(cb: () => void): () => void {
    return watchVault(this.app, this.writer, () => this.cardFolderPrefix, cb);
  }
}
