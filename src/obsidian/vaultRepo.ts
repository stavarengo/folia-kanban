import type { App } from "obsidian";
import { Component, MarkdownRenderer, TFile, TFolder, normalizePath } from "obsidian";
import type {
  Board,
  BoardConfig,
  Card,
  CardBody,
  CardFrontmatter,
  ColumnDef,
  ContextConfig,
  HistoryScope,
  RelationType,
} from "../model/types";
import type { CardMutation } from "../model/board";
import { buildBoard, resolveCardFolder } from "../model/board";
import { normalizeColumns, serializeColumns } from "../model/columns";
import { mergePriorities, normalizePriorities, serializePriorities } from "../model/priorities";
import { dateOnly, stamp } from "../model/dates";
import {
  SECTION,
  addSubcard as addSubcardText,
  addTodo as addTodoText,
  appendComment,
  appendHistory,
  cardStats,
  parseBody,
  parseFrontmatter,
  parseSubtasks,
  removeSubtask as removeSubtaskText,
  removeTimestampedLine,
  setDescription as setDescriptionText,
  setSubtaskDone,
  setSubtaskStatus as setSubtaskStatusText,
  splitFrontmatter,
  updateTimestampedLine,
} from "../model/card";
import { isSelfRelation, relationKey, withRelation, withoutRelation } from "../model/relationships";
import {
  commentAddedLine,
  commentEditedLine,
  commentRemovedLine,
  dueLine,
  historyAllows,
  priorityLine,
  relationAddedLine,
  relationRemovedLine,
  statusLine,
  subtaskAddedLine,
  subtaskDoneLine,
  subtaskReopenedLine,
  subtaskRemovedLine,
} from "../model/history";
import { TITLE_KEY, asTitleMode, resolveTitle, setHeadingTitle } from "../model/cardTitle";
import type { CardRepository } from "../model/repo";
import {
  BoardFrontmatterSchema,
  ContextFrontmatterSchema,
  DataCorruptionError,
  decode,
} from "../model/schemas";

function sanitizeFilename(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Untitled card"
  );
}

/** The per-context config note (#14). Lives inside a context subfolder; read-only for the plugin. */
const CONTEXT_NOTE = "_context.md";

/**
 * `BoardConfig` plus what resolving `card-folder` learned on the way, so `loadBoard` can report a
 * missing or ambiguous folder without repeating the vault lookups. Repo-internal: `BoardConfig`
 * stays the adapter-agnostic shape every consumer shares.
 */
interface ResolvedBoardConfig extends BoardConfig {
  /** The property text as written, for messages that must name what the person actually typed. */
  cardFolderRaw: string;
  /** Every candidate path that exists as a folder right now, in the order they were preferred. */
  cardFolderExisting: string[];
}

export class VaultRepository implements CardRepository {
  private recentWrites = new Map<string, number>();

  constructor(
    private app: App,
    private boardPath: string,
    /** Live source of the current history scope. Defaults to 'moves' = no extra history. */
    public getHistoryScope: () => HistoryScope = () => "moves",
    /** Live source of the name new comments are signed with. Empty = write them unsigned. */
    public getUserName: () => string = () => "",
  ) {}

  /** Append a history line for `kind` only when the current scope allows it. */
  private async maybeHistory(
    path: string,
    kind: Parameters<typeof historyAllows>[1],
    line: string,
  ): Promise<void> {
    if (!historyAllows(this.getHistoryScope(), kind)) return;
    await this.editBody(path, (t) => appendHistory(t, line, stamp()));
  }

  private file(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`Not a file: ${path}`);
    return f;
  }

  private frontmatterOf(file: TFile): CardFrontmatter {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return cached ?? {};
  }

  private markWrite(path: string) {
    this.recentWrites.set(path, Date.now());
  }

  /**
   * How to name the card folder in a message: what was written, plus what it resolved to whenever
   * the two differ — a `./Cards` that came out as `basic/Cards` is only actionable with both.
   */
  private describeCardFolder(config: ResolvedBoardConfig): string {
    return config.cardFolderRaw === config.cardFolder
      ? `"${config.cardFolderRaw}"`
      : `"${config.cardFolderRaw}" (resolved to "${config.cardFolder}")`;
  }

  /** Pick the vault path a `card-folder` property names, against the vault as it is right now. */
  private cardFolderFor(raw: string): { path: string; existing: string[] } {
    // `normalizePath` only tidies separators (it leaves `.` and `..` alone and turns an empty
    // value into "/"), so the `.`/`..` resolution and the two readings live in the pure helper.
    const resolved = resolveCardFolder(this.boardPath, normalizePath(raw), (p) => this.isFolder(p));
    if (resolved === null) {
      // Nothing left after dropping the readings that climb out of the vault or land on its root.
      // Unlike a folder that simply isn't there yet, adding a card cannot fix this, so it fails
      // hard rather than rendering a board whose "Add card" would write somewhere nonsensical.
      throw new Error(
        `Card folder "${raw}" names the vault root or a path outside it, neither of which can hold cards. Fix the board's card-folder property.`,
      );
    }
    return resolved;
  }

  private isFolder(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
  }

  private async readConfig(): Promise<ResolvedBoardConfig> {
    const boardFile = this.file(this.boardPath);
    // Parse the board config from the (write-fresh) file text rather than metadataCache:
    // the cache lags a processFrontMatter write by a tick, so reading it right after an
    // in-app column edit would return stale columns and the edit wouldn't reflect.
    const fm = decode(
      BoardFrontmatterSchema,
      parseFrontmatter(await this.app.vault.cachedRead(boardFile)),
      `board config (${this.boardPath})`,
    );
    // Resolved once, here, so every consumer of `config.cardFolder` — card selection, context
    // derivation (`deriveContext`, called deep inside `buildBoard`), `loadContexts`, and
    // `ensureFolder`/`createCard` — agrees on the exact same vault path. A leading slash, doubled
    // slashes, a `..` segment or a board-note-relative reading must not make one of those
    // consumers see the folder (or a card's context) and another not.
    const cardFolderRaw = fm["card-folder"] ?? fm["card_folder"] ?? "Tasks";
    const { path: cardFolder, existing: cardFolderExisting } = this.cardFolderFor(cardFolderRaw);
    const titleMode = asTitleMode(fm["card-title"] ?? fm["card_title"]);
    return {
      path: this.boardPath,
      columns: normalizeColumns(fm["columns"]),
      priorities: normalizePriorities(fm["priorities"]),
      cardFolder,
      cardFolderRaw,
      titleMode,
      cardFolderExisting,
    };
  }

  async loadBoard(): Promise<Board> {
    const config = await this.readConfig();
    const folderPath = config.cardFolder;
    // A card folder that isn't there matches zero files, which looks exactly like an empty
    // board. Say so via `cardFolderWarning` rather than rendering a healthy-looking board with
    // nothing on it — but keep loading: a board whose folder was never created yet (the `Tasks`
    // default, or a fresh `card-folder`) must still be usable, since adding the first card creates
    // that folder (see `ensureFolder`). The prefix below simply matches nothing when the folder
    // isn't there, so `cards` comes out empty either way.
    //
    // A path that resolves to something OTHER than a folder (a file already sits there) has no
    // such self-heal story — `ensureFolder`/`createCard` can't create a folder where a file already
    // is, and would fail with no useful feedback surfaced anywhere in the UI. That case stays a
    // hard failure instead of a soft notice, so the board (and its "Add card" controls) are simply
    // not reachable rather than reachable-but-broken.
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder !== null && !(folder instanceof TFolder)) {
      throw new Error(
        `Card folder ${this.describeCardFolder(config)} is not a folder. Fix the board's card-folder property.`,
      );
    }
    // Both readings existing is the one way the fallback can flip silently: a board using the
    // board-note-relative reading keeps working until someone creates a same-named folder at the
    // vault root, and then loads empty with the folder it wanted still sitting right there. Name
    // the winner rather than let that look like an ordinary empty board.
    const cardFolderWarning =
      folder === null
        ? `Card folder ${this.describeCardFolder(config)} was not found. It will be created when you add your first card.`
        : config.cardFolderExisting.length > 1
          ? `Card folder "${config.cardFolderRaw}" matches both "${config.cardFolderExisting[0]}" and "${config.cardFolderExisting[1]}". Using "${config.cardFolder}" — write the path as "./…" to always mean the one beside this board note.`
          : undefined;
    const prefix = folderPath + "/";
    const files = this.app.vault
      .getMarkdownFiles()
      // Skip the board note and the per-context config notes (#14) — `_context.md` is a folder
      // config, not a card, so it must never surface as a phantom card on the board.
      .filter(
        (f) => f.path.startsWith(prefix) && f.path !== this.boardPath && f.name !== CONTEXT_NOTE,
      );

    const cards: Card[] = [];
    for (const f of files) {
      let fm = this.frontmatterOf(f);
      const text = await this.app.vault.cachedRead(f);
      if (Object.keys(fm).length === 0) {
        try {
          fm = parseFrontmatter(text);
        } catch (e) {
          // §17: surface which card is corrupt instead of silently dropping its fields.
          throw new DataCorruptionError(`Card "${f.path}" has invalid frontmatter`, { cause: e });
        }
      }
      const subItems = parseSubtasks(text);
      const childLinks = subItems
        .filter((s) => s.kind === "card" && s.link)
        .map((s) => s.link ?? "")
        .filter((l) => l !== "");
      const { title, source } = resolveTitle(f.basename, fm, text, config.titleMode);
      cards.push({
        path: f.path,
        basename: f.basename,
        title,
        titleSource: source,
        frontmatter: fm,
        childLinks,
        subItems,
        stats: cardStats(text),
      });
    }
    // buildBoard derives each card's `context` from its path; carry the configs alongside.
    const board = buildBoard(config, cards, await this.loadContexts(config.cardFolder));
    return cardFolderWarning ? { ...board, cardFolderWarning } : board;
  }

  async loadContexts(cardFolder?: string): Promise<Record<string, ContextConfig>> {
    // Already the resolved path when it comes from a caller — `readConfig` is the only place that
    // turns the raw property into one, so re-normalizing here could only make the two disagree.
    const folderPath = cardFolder ?? (await this.readConfig()).cardFolder;
    const root = this.app.vault.getAbstractFileByPath(folderPath);
    const out: Record<string, ContextConfig> = {};
    if (!(root instanceof TFolder)) return out;
    // Each immediate subfolder is a context. An optional `_context.md` inside it supplies the
    // display name / color / label / body; a subfolder without the note still counts as a context
    // (name = folder), so its cards can be filtered by `context:` even before it's configured.
    for (const child of root.children) {
      if (!(child instanceof TFolder)) continue;
      const folder = child.name;
      const note = child.children.find((f) => f instanceof TFile && f.name === CONTEXT_NOTE);
      let config: ContextConfig = { name: folder, body: "", folder };
      if (note instanceof TFile) {
        const text = await this.app.vault.cachedRead(note);
        const fm = decode(
          ContextFrontmatterSchema,
          parseFrontmatter(text),
          `context config (${note.path})`,
        );
        const cn = fm["context-name"];
        const name = cn !== undefined && cn.trim() ? cn : folder;
        const color = fm["color"] !== undefined && fm["color"].trim() ? fm["color"] : undefined;
        const label = fm["label"] !== undefined && fm["label"].trim() ? fm["label"] : undefined;
        config = {
          name,
          ...(color !== undefined ? { color } : {}),
          ...(label !== undefined ? { label } : {}),
          body: splitFrontmatter(text).body,
          folder,
        };
      }
      out[folder] = config;
    }
    return out;
  }

  async readBody(path: string): Promise<CardBody> {
    return parseBody(await this.app.vault.cachedRead(this.file(path)));
  }

  // Raw frontmatter write — NO history. The move path (applyMove) uses this so it never
  // double-emits a structural line on top of its own "Moved …" entry.
  private async writeFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void> {
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(
      this.file(path),
      (fm: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(patch)) fm[k] = v;
      },
    );
  }

  async setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void> {
    await this.writeFrontmatter(path, patch);
    // One concise line per meaningful changed key the policy recognizes. `order` is move-managed
    // and has no field-edit history string, so it's skipped here.
    for (const [k, v] of Object.entries(patch)) {
      if (k === "priority") await this.maybeHistory(path, "priority", priorityLine(String(v)));
      else if (k === "due") await this.maybeHistory(path, "due", dueLine(String(v)));
      else if (k === "status") await this.maybeHistory(path, "status", statusLine(String(v)));
    }
  }

  async unsetFrontmatterKey(path: string, key: string): Promise<void> {
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(
      this.file(path),
      (fm: Record<string, unknown>) => {
        delete fm[key];
      },
    );
  }

  private async editBody(path: string, fn: (text: string) => string): Promise<void> {
    this.markWrite(path);
    await this.app.vault.process(this.file(path), fn);
  }

  async applyMove(mutation: CardMutation): Promise<void> {
    if (mutation.setFrontmatter)
      await this.writeFrontmatter(mutation.path, mutation.setFrontmatter);
    if (mutation.setSubtaskStatus) {
      // One edit for the whole line: the checkbox and the `[status:: …]` field are two halves of
      // where a subitem sits, so writing them separately would leave a moment where the board
      // reloads on a line that says two different things.
      const { index, status, done } = mutation.setSubtaskStatus;
      await this.editBody(mutation.path, (t) =>
        setSubtaskStatusText(
          done === undefined ? t : setSubtaskDone(t, index, done),
          index,
          status,
        ),
      );
    }
    if (mutation.history) {
      const historyLine = mutation.history;
      await this.editBody(mutation.path, (t) => appendHistory(t, historyLine, stamp()));
    }
  }

  setDescription(path: string, description: string): Promise<void> {
    // No history kind maps to a description edit, so this stays ungated.
    return this.editBody(path, (t) => setDescriptionText(t, description));
  }
  async addComment(path: string, text: string): Promise<void> {
    const author = this.getUserName();
    await this.editBody(path, (t) => appendComment(t, text, stamp(), author));
    await this.maybeHistory(path, "comment", commentAddedLine());
  }
  async updateComment(path: string, index: number, text: string): Promise<void> {
    await this.editBody(path, (t) => updateTimestampedLine(t, SECTION.comments, index, text));
    await this.maybeHistory(path, "comment", commentEditedLine());
  }
  async removeComment(path: string, index: number): Promise<void> {
    await this.editBody(path, (t) => removeTimestampedLine(t, SECTION.comments, index));
    await this.maybeHistory(path, "comment", commentRemovedLine());
  }
  async addTodo(path: string, text: string): Promise<void> {
    await this.editBody(path, (t) => addTodoText(t, text));
    await this.maybeHistory(path, "subtask", subtaskAddedLine(text));
  }
  async toggleSubtask(path: string, index: number, done: boolean): Promise<void> {
    // Capture the item text BEFORE the splice so the history line can name it.
    const itemText =
      parseSubtasks(await this.app.vault.cachedRead(this.file(path)))[index]?.text ?? "";
    await this.editBody(path, (t) => setSubtaskDone(t, index, done));
    await this.maybeHistory(
      path,
      "subtask",
      done ? subtaskDoneLine(itemText) : subtaskReopenedLine(itemText),
    );
  }
  async removeSubtask(path: string, index: number): Promise<void> {
    const itemText =
      parseSubtasks(await this.app.vault.cachedRead(this.file(path)))[index]?.text ?? "";
    await this.editBody(path, (t) => removeSubtaskText(t, index));
    await this.maybeHistory(path, "subtask", subtaskRemovedLine(itemText));
  }

  /**
   * Rewrite a card's stored list for one relationship type, INSIDE the frontmatter write.
   *
   * The read-modify-write happens in the `processFrontMatter` callback rather than against a
   * `cachedRead` snapshot taken before it, so two edits landing back to back add up instead of
   * clobbering each other (the same reason `rememberPriorities` merges inside its write). Returns
   * whether anything actually changed, so an already-declared link writes no history line.
   */
  private async editRelations(
    path: string,
    type: RelationType,
    rewrite: (fm: Record<string, unknown>) => string[] | null,
  ): Promise<boolean> {
    const key = relationKey(type);
    let changed = false;
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(
      this.file(path),
      (fm: Record<string, unknown>) => {
        const next = rewrite(fm);
        if (next === null) return;
        // An empty list means the card declares no such relationship any more, so the key goes
        // with it — the note is left as if it had never had one, not carrying a `blocks: []`.
        if (next.length === 0) delete fm[key];
        else fm[key] = next;
        changed = true;
      },
    );
    return changed;
  }

  async addRelation(path: string, type: RelationType, target: string): Promise<void> {
    // Refused at the write, not just hidden at the read: a self-link is dropped when the board is
    // built, so storing one would put a line in the note that no panel can show or take back.
    if (isSelfRelation(path, this.file(path).basename, target)) return;
    const changed = await this.editRelations(path, type, (fm) => withRelation(fm, type, target));
    if (changed) await this.maybeHistory(path, "relation", relationAddedLine(type, target));
  }

  async removeRelation(
    path: string,
    type: RelationType,
    targets: readonly string[],
  ): Promise<void> {
    const changed = await this.editRelations(path, type, (fm) =>
      withoutRelation(fm, type, targets),
    );
    // One line for the relationship, named by the form the panel showed — not one per spelling.
    const shown = targets[0];
    if (changed && shown !== undefined)
      await this.maybeHistory(path, "relation", relationRemovedLine(type, shown));
  }

  private async uniquePath(folder: string, title: string): Promise<string> {
    const base = sanitizeFilename(title);
    let candidate = normalizePath(`${folder}/${base}.md`);
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${base} ${n++}.md`);
    }
    return candidate;
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
  }

  async createCard(title: string, status: string): Promise<string> {
    const config = await this.readConfig();
    await this.ensureFolder(config.cardFolder);
    const path = await this.uniquePath(config.cardFolder, title);
    this.markWrite(path);
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
    // A `status:` that is not a plain string is corruption, not a column — fall back rather than
    // create the subcard in a column named "[object Object]".
    const parentStatus = parentFm["status"];
    const childPath = await this.createCard(
      title,
      typeof parentStatus === "string" ? parentStatus : "todo",
    );
    const childBase = (childPath.split("/").pop() ?? "").replace(/\.md$/i, "");
    await this.editBody(parentPath, (t) => addSubcardText(t, childBase));
    return childPath;
  }

  async setColumns(columns: ColumnDef[]): Promise<void> {
    this.markWrite(this.boardPath);
    await this.app.fileManager.processFrontMatter(
      this.file(this.boardPath),
      (fm: Record<string, unknown>) => {
        fm["columns"] = serializeColumns(columns);
      },
    );
  }

  async rememberPriorities(values: string[]): Promise<void> {
    const boardFile = this.file(this.boardPath);
    // Decide whether to write BEFORE opening the write. `processFrontMatter` re-serializes the
    // whole frontmatter block whether or not the callback changes anything, so a callback that
    // bails out still rewrites the note — it reflows other properties (it drops the quotes from
    // `filter: "priority:a"`, for one). Setting a priority the board already knows is the common
    // case, so that would churn the board note on nearly every priority edit.
    const current = normalizePriorities(
      decode(
        BoardFrontmatterSchema,
        parseFrontmatter(await this.app.vault.cachedRead(boardFile)),
        `board config (${this.boardPath})`,
      )["priorities"],
    );
    if (mergePriorities(current, values) === null) return;

    this.markWrite(this.boardPath);
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
    this.markWrite(path);
    await this.app.fileManager.trashFile(this.file(path));
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
      await this.writeFrontmatter(path, { [TITLE_KEY]: title });
      return path;
    }
    if (source === "heading") {
      await this.editBody(path, (t) => setHeadingTitle(t, file.basename, titleMode, title));
      return path;
    }
    const base = sanitizeFilename(title);
    if (base === file.basename) return path; // unchanged (after sanitize) — no write
    const folder = file.parent?.path ?? "";
    const dest = await this.uniquePath(folder === "/" ? "" : folder, base);
    if (dest === path) return path;
    this.markWrite(path);
    this.markWrite(dest);
    // fileManager.renameFile rewrites inbound [[links]] (the parent's ## Subtasks link survives).
    await this.app.fileManager.renameFile(file, dest);
    return dest;
  }

  async openCard(path: string): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(this.file(path));
  }

  renderMarkdown(el: HTMLElement, markdown: string, sourcePath: string): () => void {
    if (el.empty) el.empty();
    else el.innerHTML = "";
    // A managed Component owns the render's child lifecycle (embeds, post-processors). render is
    // async and APPENDS into its target while running, so render into a detached clone and only
    // commit the result if this run wasn't cancelled. Without the detached target, a stale in-flight
    // render would keep appending into `el` after cleanup and stack onto the next render's output.
    let cancelled = false;
    const c = new Component();
    c.load();
    const tmp = el.cloneNode(false) as HTMLElement;
    void MarkdownRenderer.render(this.app, markdown, tmp, sourcePath, c)
      .then(() => {
        if (cancelled) return;
        el.replaceChildren(...tmp.childNodes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      c.unload();
      el.innerHTML = "";
    };
  }

  onChange(cb: () => void): () => void {
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(cb, 150);
    };
    const fireVault = (path: string) => {
      const last = this.recentWrites.get(path);
      if (last !== undefined) {
        if (Date.now() - last < 2500) return; // our own write — we reload explicitly
        this.recentWrites.delete(path); // prune the stale echo-guard entry
      }
      schedule();
    };
    const vaultRefs = [
      this.app.vault.on("modify", (f) => fireVault(f.path)),
      this.app.vault.on("create", (f) => fireVault(f.path)),
      this.app.vault.on("delete", (f) => fireVault(f.path)),
      this.app.vault.on("rename", (f) => fireVault(f.path)),
    ];
    // The metadataCache catches up a tick after our own processFrontMatter write; reconcile
    // then (only for files we just wrote) so an in-app move/edit can't visually snap back to
    // its old slot while the cache is stale. External edits are handled by the vault events.
    const metaRef = this.app.metadataCache.on("changed", (f) => {
      if (this.recentWrites.has(f.path)) schedule();
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      for (const ref of vaultRefs) this.app.vault.offref(ref);
      this.app.metadataCache.offref(metaRef);
    };
  }
}
