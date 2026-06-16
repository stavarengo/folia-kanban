import { App, TFile, normalizePath } from "obsidian";
import type { Board, BoardConfig, Card, CardBody, CardFrontmatter, ColumnDef, HistoryScope } from "../model/types";
import type { CardMutation } from "../model/board";
import { buildBoard } from "../model/board";
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
  updateTimestampedLine,
} from "../model/card";
import {
  commentAddedLine,
  commentEditedLine,
  commentRemovedLine,
  dueLine,
  historyAllows,
  priorityLine,
  statusLine,
  subtaskAddedLine,
  subtaskDoneLine,
  subtaskReopenedLine,
  subtaskRemovedLine,
} from "../model/history";
import type { CardRepository } from "./repo";

const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: "todo", title: "Todo" },
  { id: "next", title: "Next" },
  { id: "doing", title: "Doing" },
  { id: "waiting", title: "Waiting" },
  { id: "parked", title: "Parked" },
  { id: "later", title: "Later" },
  { id: "done", title: "Done" },
];

function titleCase(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeColumns(raw: unknown): ColumnDef[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_COLUMNS;
  const cols: ColumnDef[] = [];
  for (const c of raw) {
    if (typeof c === "string") {
      if (c.trim()) cols.push({ id: c, title: titleCase(c) });
      continue;
    }
    if (c === null || typeof c !== "object") continue; // skip null / number / other malformed entries
    const obj = c as { id?: unknown; title?: unknown; color?: unknown; limit?: unknown };
    if (obj.id == null || String(obj.id).trim() === "") continue; // a column needs a usable id
    const col: ColumnDef = {
      id: String(obj.id),
      title: typeof obj.title === "string" && obj.title ? obj.title : titleCase(String(obj.id)),
    };
    if (typeof obj.color === "string") col.color = obj.color;
    if (typeof obj.limit === "number" && Number.isFinite(obj.limit)) col.limit = obj.limit;
    cols.push(col);
  }
  return cols.length ? cols : DEFAULT_COLUMNS;
}

function sanitizeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim() || "Untitled card";
}

export class VaultRepository implements CardRepository {
  private recentWrites = new Map<string, number>();

  constructor(
    private app: App,
    private boardPath: string,
    /** Live source of the current history scope. Defaults to 'moves' = no extra history. */
    public getHistoryScope: () => HistoryScope = () => "moves",
  ) {}

  /** Append a history line for `kind` only when the current scope allows it. */
  private async maybeHistory(path: string, kind: Parameters<typeof historyAllows>[1], line: string): Promise<void> {
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
    return (cached ?? {}) as CardFrontmatter;
  }

  private markWrite(path: string) {
    this.recentWrites.set(path, Date.now());
  }

  private async readConfig(): Promise<BoardConfig> {
    const boardFile = this.file(this.boardPath);
    // Parse the board config from the (write-fresh) file text rather than metadataCache:
    // the cache lags a processFrontMatter write by a tick, so reading it right after an
    // in-app column edit would return stale columns and the edit wouldn't reflect.
    const fm = parseFrontmatter(await this.app.vault.cachedRead(boardFile));
    const cardFolder = String(fm["card-folder"] ?? fm["card_folder"] ?? "Tasks");
    return { path: this.boardPath, columns: normalizeColumns(fm["columns"]), cardFolder };
  }

  async loadBoard(): Promise<Board> {
    const config = await this.readConfig();
    const prefix = config.cardFolder.replace(/\/$/, "") + "/";
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix) && f.path !== this.boardPath);

    const cards: Card[] = [];
    for (const f of files) {
      let fm = this.frontmatterOf(f);
      const text = await this.app.vault.cachedRead(f);
      if (Object.keys(fm).length === 0) fm = parseFrontmatter(text) as CardFrontmatter;
      const childLinks = parseSubtasks(text)
        .filter((s) => s.kind === "card" && s.link)
        .map((s) => s.link!);
      cards.push({ path: f.path, basename: f.basename, frontmatter: fm, childLinks, stats: cardStats(text) });
    }
    return buildBoard(config, cards);
  }

  async readBody(path: string): Promise<CardBody> {
    return parseBody(await this.app.vault.cachedRead(this.file(path)));
  }

  // Raw frontmatter write — NO history. The move path (applyMove) uses this so it never
  // double-emits a structural line on top of its own "Moved …" entry.
  private async writeFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void> {
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(this.file(path), (fm) => {
      for (const [k, v] of Object.entries(patch)) fm[k] = v;
    });
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
    await this.app.fileManager.processFrontMatter(this.file(path), (fm) => {
      delete fm[key];
    });
  }

  private async editBody(path: string, fn: (text: string) => string): Promise<void> {
    this.markWrite(path);
    await this.app.vault.process(this.file(path), fn);
  }

  async applyMove(mutation: CardMutation): Promise<void> {
    if (mutation.setFrontmatter) await this.writeFrontmatter(mutation.path, mutation.setFrontmatter);
    if (mutation.history) await this.editBody(mutation.path, (t) => appendHistory(t, mutation.history!, stamp()));
  }

  setDescription(path: string, description: string): Promise<void> {
    // No history kind maps to a description edit, so this stays ungated.
    return this.editBody(path, (t) => setDescriptionText(t, description));
  }
  async addComment(path: string, text: string): Promise<void> {
    await this.editBody(path, (t) => appendComment(t, text, stamp()));
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
    const itemText = parseSubtasks(await this.app.vault.cachedRead(this.file(path)))[index]?.text ?? "";
    await this.editBody(path, (t) => setSubtaskDone(t, index, done));
    await this.maybeHistory(path, "subtask", done ? subtaskDoneLine(itemText) : subtaskReopenedLine(itemText));
  }
  async removeSubtask(path: string, index: number): Promise<void> {
    const itemText = parseSubtasks(await this.app.vault.cachedRead(this.file(path)))[index]?.text ?? "";
    await this.editBody(path, (t) => removeSubtaskText(t, index));
    await this.maybeHistory(path, "subtask", subtaskRemovedLine(itemText));
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
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.type = "task";
      fm.status = status;
      fm.created = dateOnly();
    });
    return path;
  }

  async addSubcard(parentPath: string, title: string): Promise<string> {
    // Read the parent status from write-fresh text (metadataCache can lag a just-written status).
    const parentFm = parseFrontmatter(await this.app.vault.cachedRead(this.file(parentPath)));
    const childPath = await this.createCard(title, String(parentFm.status ?? "todo"));
    const childBase = childPath.split("/").pop()!.replace(/\.md$/i, "");
    await this.editBody(parentPath, (t) => addSubcardText(t, childBase));
    return childPath;
  }

  async setColumns(columns: ColumnDef[]): Promise<void> {
    this.markWrite(this.boardPath);
    await this.app.fileManager.processFrontMatter(this.file(this.boardPath), (fm) => {
      fm["columns"] = columns.map((c) => {
        const out: Record<string, unknown> = { id: c.id, title: c.title };
        if (c.color) out.color = c.color;
        if (typeof c.limit === "number") out.limit = c.limit;
        return out;
      });
    });
  }

  async deleteCard(path: string): Promise<void> {
    this.markWrite(path);
    await this.app.fileManager.trashFile(this.file(path));
  }

  async openCard(path: string): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(this.file(path));
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
