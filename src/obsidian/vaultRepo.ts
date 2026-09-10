import type { App, HoverParent, HoverPopover } from "obsidian";
import {
  Component,
  FileSystemAdapter,
  Keymap,
  MarkdownRenderer,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import type {
  Board,
  BoardConfig,
  Card,
  CardBody,
  CardFrontmatter,
  ColumnDef,
  ContextConfig,
  HistoryScope,
  LineRef,
  RelationType,
} from "../model/types";
import type { CardMutation } from "../model/board";
import type { PropertyNamesInUse, PropertySuggestSource } from "../model/repo";
import { staleLine } from "../model/repo";
import { isBoardFrontmatter } from "../viewMode";
import { VIEW_TYPE_KANBAN } from "../viewType";
import { attachPropertySuggest } from "./propertySuggest";
import { buildBoard, resolveCardFolder } from "../model/board";
import { normalizeColumns, scalarText, serializeColumns } from "../model/columns";
import { mergePriorities, normalizePriorities, serializePriorities } from "../model/priorities";
import { dateOnly, stamp } from "../model/dates";
import {
  SECTION,
  addSubcard as addSubcardText,
  addTodo as addTodoText,
  appendComment,
  appendHistory,
  cardStats,
  commentStillReads,
  parseBody,
  parseFrontmatter,
  parseSubtasks,
  pendingSubcardLinks,
  removeSubtask as removeSubtaskText,
  removeTimestampedLine,
  setDescription as setDescriptionText,
  setSubcardDone,
  setSubtaskDone,
  setSubtaskStatus as setSubtaskStatusText,
  splitFrontmatter,
  subtaskStillReads,
  updateTimestampedLine,
} from "../model/card";
import {
  isSelfRelation,
  normalizeRelationTypes,
  withRelation,
  withoutRelation,
} from "../model/relationships";
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
import {
  TITLE_KEY,
  asTitleMode,
  resolveTitle,
  sanitizeFilename,
  setHeadingTitle,
} from "../model/cardTitle";
import type { CardRepository } from "../model/repo";
import type { FileOp } from "../model/pathOps";
import {
  BoardFrontmatterSchema,
  ContextFrontmatterSchema,
  DataCorruptionError,
  decode,
} from "../model/schemas";

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

/**
 * Who a rendered markdown container's link hovers belong to right now: the repository that last
 * rendered into it, and the note its links resolve against. Keyed by the container, so one listener
 * per container is enough however many times its content is re-rendered, and weak so an unmounted
 * panel takes its entry with it.
 *
 * The owner is looked up rather than captured, because the container outlives the repository: the
 * board note being renamed rebuilds the repository while React keeps the very same element, and a
 * listener closed over the old one would hand Page preview a dead board and a stale path.
 */
const hoverSources = new WeakMap<
  HTMLElement,
  { render: object; app: App; repo: VaultRepository; sourcePath: string }
>();

/** Containers already listening. Separate from `hoverSources`, which a cleanup empties. */
const hoverListening = new WeakSet<HTMLElement>();

export class VaultRepository implements CardRepository, HoverParent {
  private recentWrites = new Map<string, number>();
  /**
   * Where the last load found this board's cards (`<cardFolder>/`), so `onChange` can tell a
   * metadata-cache catch-up that concerns this board from one anywhere else in the vault.
   */
  private cardFolderPrefix: string | null = null;

  /**
   * Page preview parks the popover it opened for this board here (the `HoverParent` contract), so
   * a second hover replaces the first instead of stacking previews over each other. A repository is
   * not a `Component`, so it cannot unload the popover — checked live and it does not have to: the
   * popover closes itself when its link goes, whether the panel closed or the board's tab did.
   */
  hoverPopover: HoverPopover | null = null;

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

  /**
   * Which note a link written in `sourcePath` names, answered by the vault itself — the same
   * answer the editor gives when that link is clicked, shortest-path and same-folder rules
   * included. `link` is a bare linkpath (no `#anchor`, no `|alias`); a `.md` suffix is fine.
   * Null for a link naming no note.
   */
  private resolveLink(link: string, sourcePath: string): string | null {
    return this.app.metadataCache.getFirstLinkpathDest(link, sourcePath)?.path ?? null;
  }

  /**
   * How a link to the note at `targetPath` should be written inside a note at `sourcePath`, per
   * this vault's own link settings — the shortest name that still names one note, a relative or
   * absolute path where the vault is set up that way.
   *
   * Only the text INSIDE the brackets: every link Folia writes is a wikilink, whatever the vault's
   * "use [[Wikilinks]]" setting says, because Folia's own reading of a note (the `## Subtasks`
   * checklist, the relationship keys) only recognizes that form. A vault set to Markdown links
   * therefore gets a wikilink here — the honest shape until reading Markdown links is built too.
   */
  private linkTextTo(targetPath: string, sourcePath: string): string {
    const file = this.app.vault.getAbstractFileByPath(targetPath);
    const bare = targetPath.replace(/\.md$/i, "");
    if (!(file instanceof TFile)) return bare;
    const generated = this.app.fileManager.generateMarkdownLink(file, sourcePath).trim();
    // The full vault path is the fallback because it names exactly one note under every setting.
    return /^\[\[[^\]]+\]\]$/.test(generated) ? generated.slice(2, -2) : bare;
  }

  /**
   * The note a relationship `target` names, read from the card that declares it — or null when it
   * names no note, or carries an `#anchor` / `|alias`. A decorated target said more than "which
   * note", so it is left alone rather than rewritten into a plainer link that loses the rest.
   */
  private relationTargetPath(target: string, sourcePath: string): string | null {
    const raw = target.trim();
    if (raw === "" || raw.includes("#") || raw.includes("|")) return null;
    return this.resolveLink(raw, sourcePath);
  }

  private frontmatterOf(file: TFile): CardFrontmatter {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return cached ?? {};
  }

  /**
   * The tags Obsidian read out of a note's body, `#` stripped, in the order they appear.
   *
   * Read from the metadata cache and nowhere else, deliberately: which `#word` in a body is a tag
   * is Obsidian's own lexer's answer (code fences, inline code, the character set, escapes), and a
   * regex here would be a second, quietly different answer — which is the very drift this fix
   * exists to close. So a note with no cache entry yet contributes no body tags, unlike its
   * frontmatter (which `loadBoard` re-parses from the text when the cache has nothing).
   */
  private bodyTagsOf(file: TFile): string[] {
    const tags = this.app.metadataCache.getFileCache(file)?.tags ?? [];
    const out: string[] = [];
    for (const t of tags) {
      const tag = t.tag.replace(/^#/, "");
      if (tag !== "") out.push(tag);
    }
    return out;
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
  /**
   * What {@link propertyNamesInUse} last answered, kept for as long as the board it belongs to is
   * unchanged (see `loadBoard`). Without it, every card opened would walk the whole vault again.
   */
  private propertyNames: PropertyNamesInUse | null = null;

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
      relations: normalizeRelationTypes(fm["relations"]),
      cardFolder,
      cardFolderRaw,
      titleMode,
      cardFolderExisting,
    };
  }

  async loadBoard(): Promise<Board> {
    // Every load follows something changing in the vault, which is also when the keys its notes use
    // can have changed. Dropping the memo here is what keeps the panel's suggestions current
    // without re-walking the vault each time a card is opened.
    this.propertyNames = null;
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
    this.cardFolderPrefix = prefix;
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
      const bodyTags = this.bodyTagsOf(f);
      cards.push({
        path: f.path,
        basename: f.basename,
        title,
        titleSource: source,
        frontmatter: fm,
        childLinks,
        subItems,
        stats: cardStats(text),
        ...(bodyTags.length > 0 ? { bodyTags } : {}),
      });
    }
    // buildBoard derives each card's `context` from its path; carry the configs alongside.
    const board = buildBoard(
      config,
      cards,
      await this.loadContexts(config.cardFolder),
      (link, source) => this.resolveLink(link, source),
    );
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

  /**
   * Edit one line of a note, but only while the note still reads the way the caller described it.
   * `vault.process` is what makes a read-modify-write see the current bytes, so the check belongs
   * INSIDE its callback — against the very text the edit is about to be made on, not against a
   * snapshot read before it. A note that has moved on since is handed straight back, byte for byte,
   * and the refusal is raised after the write returns rather than thrown out of the callback: what
   * `process` does with a throw from inside is not ours to promise.
   */
  private async editLine(
    path: string,
    kind: "subtask" | "comment",
    at: LineRef,
    write: (text: string) => string,
  ): Promise<void> {
    const stillReads = kind === "subtask" ? subtaskStillReads : commentStillReads;
    let stale = false;
    await this.editBody(path, (t) => {
      stale = !stillReads(t, at);
      return stale ? t : write(t);
    });
    if (!stale) return;
    // Nothing was written, so the echo guard this call set on the way in is guarding nothing:
    // dropping it keeps the next change from elsewhere — the very change that made this one
    // refuse — from being swallowed as ours. At worst it costs one extra reload, when an earlier
    // write of ours really did land on this note moments ago.
    this.recentWrites.delete(path);
    throw staleLine(kind, path, at);
  }

  async applyMove(mutation: CardMutation): Promise<void> {
    if (mutation.setFrontmatter)
      await this.writeFrontmatter(mutation.path, mutation.setFrontmatter);
    for (const key of mutation.unsetFrontmatter ?? []) {
      await this.unsetFrontmatterKey(mutation.path, key);
    }
    if (mutation.setSubtaskStatus) {
      // One edit for the whole line: the checkbox and the `[status:: …]` field are two halves of
      // where a subitem sits, so writing them separately would leave a moment where the board
      // reloads on a line that says two different things.
      const { index, text, status, done } = mutation.setSubtaskStatus;
      await this.editLine(mutation.path, "subtask", { index, text }, (t) =>
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
    // Last, and after the moved note's own record, so a parent that has gone missing since the
    // board loaded cannot stop the move itself from being recorded — nor the other parents from
    // being written; the first failure is raised once every note has had its turn. Each parent is
    // read first and left alone when it no longer needs the write. The box is the same edit a
    // click on it would make, so it leaves the same (scope-gated) trace, naming only the links
    // that actually changed.
    let failure: Error | undefined;
    for (const { path, links, done } of mutation.parentLines ?? []) {
      try {
        // Looked up twice on purpose: once to skip a note that needs nothing (so an unchanged
        // note is not rewritten at all), and again inside the atomic write, which is the text the
        // history line must describe.
        if (
          pendingSubcardLinks(await this.app.vault.cachedRead(this.file(path)), links, done)
            .length === 0
        )
          continue;
        let pending: { link: string; text: string }[] = [];
        await this.editBody(path, (t) => {
          pending = pendingSubcardLinks(t, links, done);
          return setSubcardDone(
            t,
            pending.map((p) => p.link),
            done,
          );
        });
        for (const { text } of pending) {
          await this.maybeHistory(
            path,
            "subtask",
            done ? subtaskDoneLine(text) : subtaskReopenedLine(text),
          );
        }
      } catch (e) {
        failure ??= e instanceof Error ? e : new Error(String(e));
      }
    }
    if (failure !== undefined) throw failure;
  }

  setDescription(path: string, description: string): Promise<void> {
    // No history kind maps to a description edit, so this stays ungated.
    return this.editBody(path, (t) => setDescriptionText(t, description));
  }
  async addComment(path: string, text: string, author?: string): Promise<void> {
    const signature = author || this.getUserName();
    await this.editBody(path, (t) => appendComment(t, text, stamp(), signature));
    await this.maybeHistory(path, "comment", commentAddedLine());
  }
  async updateComment(path: string, at: LineRef, text: string): Promise<void> {
    await this.editLine(path, "comment", at, (t) =>
      updateTimestampedLine(t, SECTION.comments, at.index, text),
    );
    await this.maybeHistory(path, "comment", commentEditedLine());
  }
  async removeComment(path: string, at: LineRef): Promise<void> {
    await this.editLine(path, "comment", at, (t) =>
      removeTimestampedLine(t, SECTION.comments, at.index),
    );
    await this.maybeHistory(path, "comment", commentRemovedLine());
  }
  async addTodo(path: string, text: string): Promise<void> {
    await this.editBody(path, (t) => addTodoText(t, text));
    await this.maybeHistory(path, "subtask", subtaskAddedLine(text));
  }
  async toggleSubtask(path: string, at: LineRef, done: boolean): Promise<void> {
    // The history line names `at.text`, and the write only lands while the note still reads that
    // way — so the record and the tick are the same line, with nothing read separately to disagree.
    await this.editLine(path, "subtask", at, (t) => setSubtaskDone(t, at.index, done));
    await this.maybeHistory(
      path,
      "subtask",
      done ? subtaskDoneLine(at.text) : subtaskReopenedLine(at.text),
    );
  }
  async removeSubtask(path: string, at: LineRef): Promise<void> {
    await this.editLine(path, "subtask", at, (t) => removeSubtaskText(t, at.index));
    await this.maybeHistory(path, "subtask", subtaskRemovedLine(at.text));
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
    let changed = false;
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(
      this.file(path),
      (fm: Record<string, unknown>) => {
        const next = rewrite(fm);
        if (next === null) return;
        // An empty list means the card declares no such relationship any more, so the key goes
        // with it — the note is left as if it had never had one, not carrying a `blocks: []`.
        if (next.length === 0) delete fm[type];
        else fm[type] = next;
        changed = true;
      },
    );
    return changed;
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
    const targetPath = this.relationTargetPath(target, path);
    const self =
      targetPath !== null
        ? targetPath === path
        : isSelfRelation(path, this.file(path).basename, target);
    if (self) return;
    if (!(await this.knownRelation(type))) return;
    // Same reason as `addSubcard`: whatever the caller named the card, the note gets the link this
    // vault would write to it, so the board reads back the card the caller meant. A target naming
    // no note (a link to a card that is not there yet) is stored exactly as it was typed.
    const written = targetPath === null ? target : this.linkTextTo(targetPath, path);
    const changed = await this.editRelations(path, type, (fm) => withRelation(fm, type, written));
    if (changed) await this.maybeHistory(path, "relation", relationAddedLine(type, written));
  }

  async removeRelation(
    path: string,
    type: RelationType,
    targets: readonly string[],
  ): Promise<void> {
    if (!(await this.knownRelation(type))) return;
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
    // Unquoted YAML turns `status: 2` into a number, and a column id may legitimately be one, so
    // scalars are kept as text — but a mapping or a list is corruption, and coercing it would
    // create the subcard in a column named "[object Object]".
    const parentStatus = scalarText(parentFm["status"]);
    const childPath = await this.createCard(title, parentStatus || "todo");
    // Written the way THIS vault writes links, from this parent: a bare file name is ambiguous the
    // moment a second note takes it, and Folia would then write a link Folia cannot read back.
    await this.editBody(parentPath, (t) =>
      addSubcardText(t, this.linkTextTo(childPath, parentPath)),
    );
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
    return this.renameFile(path, title);
  }

  async renameFile(path: string, newBasename: string): Promise<string> {
    const file = this.file(path);
    const wanted = newBasename.trim();
    if (!wanted) return path; // a blank name is not a name — nothing to rename to
    const base = sanitizeFilename(wanted);
    if (base === file.basename) return path; // unchanged once made safe to use as a file name
    const folder = file.parent?.path ?? "";
    const dest = await this.uniquePath(folder === "/" ? "" : folder, base);
    if (dest === path) return path;
    this.markWrite(path);
    this.markWrite(dest);
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

  /**
   * Give the container's rendered internal links the hover preview every other link in Obsidian
   * has. Page preview stays silent until the view is a registered source (`src/main.ts`) AND the
   * view tells it about the link, which is what the event below does.
   *
   * The listener is bound to the container once and outlives the individual renders, because the
   * container does: re-registering per render would stack a second listener onto the same element
   * whenever a caller re-renders without running the previous cleanup, and every hover would then
   * fire twice. `hoverSources` carries who the container answers for, refreshed on every render and
   * dropped by the cleanup, so a hover after teardown says nothing.
   */
  private watchForLinkHovers(el: HTMLElement, sourcePath: string, render: object): void {
    hoverSources.set(el, { render, app: this.app, repo: this, sourcePath });
    if (hoverListening.has(el)) return;
    hoverListening.add(el);
    el.addEventListener("mouseover", (event: MouseEvent) => {
      // `closest`, because the pointer may be over a `<code>` or an `<em>` nested inside the
      // anchor; `data-href` before `href`, because that is where Obsidian keeps the link as
      // written, before it resolved it to a path.
      const link = (event.target as HTMLElement | null)?.closest("a.internal-link");
      if (!(link instanceof HTMLElement)) return;
      // `data-href` is where Obsidian's renderer keeps the link as written, before resolving it.
      // Only that: an `href` on a rendered internal link is already resolved and percent-encoded,
      // so falling back to it would ask Page preview to look up something nobody wrote.
      const linktext = link.getAttribute("data-href");
      const owner = hoverSources.get(el);
      if (!linktext || !owner) return;
      owner.app.workspace.trigger("hover-link", {
        event,
        source: VIEW_TYPE_KANBAN,
        hoverParent: owner.repo,
        targetEl: link,
        linktext,
        sourcePath: owner.sourcePath,
      });
    });
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
    // `c` doubles as this render's identity: the cleanup below must only retire the record while it
    // is still this render's, never a later one's.
    this.watchForLinkHovers(el, sourcePath, c);
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
      // The listener stays (the container may render again into the same element), but it answers
      // from this record — dropping it is what makes a torn-down render stop naming a repository
      // whose links are gone, and lets the element release its hold on that repository.
      if (hoverSources.get(el)?.render === c) hoverSources.delete(el);
      el.innerHTML = "";
    };
  }

  /**
   * Every frontmatter key the vault's notes already carry, from the metadata index — Obsidian has
   * parsed every note once already, so parsing them again here would be both slower and a second
   * reading of the same bytes. Split at this board's card folder, since only this class knows
   * where that folder resolved to.
   *
   * Only notes that could be cards are read. EVERY board note is skipped, not only this board's,
   * and so is every `_context.md`: their keys (`folia-board`, `columns`, `context-name`, …)
   * configure a board or a folder and mean nothing on a card, so offering them on a card is
   * offering a mistake — and a vault holding several boards would otherwise hand each one's
   * configuration to the others as vault-wide vocabulary. It is the same "this is not a card"
   * rule `loadBoard` applies when it picks the notes to draw.
   */
  async propertyNamesInUse(): Promise<PropertyNamesInUse> {
    if (this.propertyNames) return this.propertyNames;
    const config = await this.readConfig();
    const prefix = config.cardFolder + "/";
    const inCardFolder = new Set<string>();
    const elsewhere = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path === this.boardPath || file.name === CONTEXT_NOTE) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || isBoardFrontmatter(fm)) continue;
      const into = file.path.startsWith(prefix) ? inCardFolder : elsewhere;
      for (const key of Object.keys(fm)) into.add(key);
    }
    const sorted = (keys: Set<string>): string[] => [...keys].sort((a, b) => a.localeCompare(b));
    // A key used both inside and outside the folder belongs to the board: it is the nearer answer,
    // and a name must never be offered twice. Matched without regard to case, since `Energy` and
    // `energy` are the same answer to "what do notes here call this".
    const near = new Set([...inCardFolder].map((k) => k.toLowerCase()));
    this.propertyNames = {
      inCardFolder: sorted(inCardFolder),
      elsewhere: sorted(elsewhere).filter((k) => !near.has(k.toLowerCase())),
    };
    return this.propertyNames;
  }

  suggestProperties(input: HTMLInputElement, source: PropertySuggestSource): () => void {
    return attachPropertySuggest(this.app, input, source);
  }

  absolutePath(path: string): string | null {
    const adapter = this.app.vault.adapter;
    // Desktop vaults are folders on disk; a mobile (Capacitor) vault is not, and has no path a
    // person could paste anywhere outside Obsidian.
    return adapter instanceof FileSystemAdapter ? adapter.getFullPath(path) : null;
  }

  onFileOp(cb: (op: FileOp) => void): () => void {
    // Deliberately NOT filtered by the `recentWrites` echo guard `onChange` uses. Following a path
    // is idempotent — whichever of the two paths runs first (the in-app action or this listener),
    // the other finds nothing left to move — so suppressing our own writes would only risk
    // swallowing a real external operation that landed inside the guard's window.
    const refs = [
      this.app.vault.on("rename", (f, oldPath) =>
        cb({ kind: "rename", from: oldPath, to: f.path }),
      ),
      this.app.vault.on("delete", (f) => cb({ kind: "delete", path: f.path })),
    ];
    return () => {
      for (const ref of refs) this.app.vault.offref(ref);
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
    // The metadataCache catches up a tick after our own processFrontMatter write; reconcile then
    // so an in-app move/edit can't visually snap back to its old slot while the cache is stale.
    // Any card in this board's folder counts, not only the files we wrote, because a card's body
    // tags exist nowhere but this cache: a board opened while Obsidian was still filling it
    // would otherwise draw every card right except its tags, and stay that way until some
    // unrelated vault change happened along. The 150ms debounce collapses the opening burst into
    // one reload. Files outside the folder are left to the vault events.
    const metaRef = this.app.metadataCache.on("changed", (f) => {
      const prefix = this.cardFolderPrefix;
      if (this.recentWrites.has(f.path) || (prefix !== null && f.path.startsWith(prefix))) {
        schedule();
      }
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      for (const ref of vaultRefs) this.app.vault.offref(ref);
      this.app.metadataCache.offref(metaRef);
    };
  }
}
