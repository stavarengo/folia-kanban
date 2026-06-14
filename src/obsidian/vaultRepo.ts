import { App, TFile, normalizePath } from "obsidian";
import type { Board, BoardConfig, Card, CardBody, CardFrontmatter, ColumnDef } from "../model/types";
import type { CardMutation } from "../model/board";
import { buildBoard } from "../model/board";
import {
  addSubcard as addSubcardText,
  addTodo as addTodoText,
  appendComment,
  appendHistory,
  cardStats,
  parseBody,
  parseFrontmatter,
  parseSubtasks,
  removeSubtask as removeSubtaskText,
  setDescription as setDescriptionText,
  setSubtaskDone,
} from "../model/card";
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
  return raw.map((c): ColumnDef =>
    typeof c === "string"
      ? { id: c, title: titleCase(c) }
      : { id: String(c.id), title: c.title ?? titleCase(String(c.id)), color: c.color },
  );
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dateOnly(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function sanitizeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim() || "Untitled card";
}

export class VaultRepository implements CardRepository {
  private recentWrites = new Map<string, number>();

  constructor(
    private app: App,
    private boardPath: string,
  ) {}

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
    const fm = this.frontmatterOf(boardFile);
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

  async setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void> {
    this.markWrite(path);
    await this.app.fileManager.processFrontMatter(this.file(path), (fm) => {
      for (const [k, v] of Object.entries(patch)) fm[k] = v;
    });
  }

  private async editBody(path: string, fn: (text: string) => string): Promise<void> {
    this.markWrite(path);
    await this.app.vault.process(this.file(path), fn);
  }

  async applyMove(mutation: CardMutation): Promise<void> {
    if (mutation.setFrontmatter) await this.setFrontmatter(mutation.path, mutation.setFrontmatter);
    if (mutation.history) await this.editBody(mutation.path, (t) => appendHistory(t, mutation.history!, stamp()));
  }

  setDescription(path: string, description: string): Promise<void> {
    return this.editBody(path, (t) => setDescriptionText(t, description));
  }
  addComment(path: string, text: string): Promise<void> {
    return this.editBody(path, (t) => appendComment(t, text, stamp()));
  }
  addTodo(path: string, text: string): Promise<void> {
    return this.editBody(path, (t) => addTodoText(t, text));
  }
  toggleSubtask(path: string, index: number, done: boolean): Promise<void> {
    return this.editBody(path, (t) => setSubtaskDone(t, index, done));
  }
  removeSubtask(path: string, index: number): Promise<void> {
    return this.editBody(path, (t) => removeSubtaskText(t, index));
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
    const content = `---\ntype: task\nstatus: ${status}\ncreated: ${dateOnly()}\n---\n\n# ${title}\n`;
    this.markWrite(path);
    await this.app.vault.create(path, content);
    return path;
  }

  async addSubcard(parentPath: string, title: string): Promise<string> {
    const parentFm = this.frontmatterOf(this.file(parentPath));
    const childPath = await this.createCard(title, String(parentFm.status ?? "todo"));
    const childBase = childPath.split("/").pop()!.replace(/\.md$/i, "");
    await this.editBody(parentPath, (t) => addSubcardText(t, childBase));
    return childPath;
  }

  async setColumns(columns: ColumnDef[]): Promise<void> {
    this.markWrite(this.boardPath);
    await this.app.fileManager.processFrontMatter(this.file(this.boardPath), (fm) => {
      fm["columns"] = columns.map((c) => (c.color ? { id: c.id, title: c.title, color: c.color } : { id: c.id, title: c.title }));
    });
  }

  async openCard(path: string): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(this.file(path));
  }

  onChange(cb: () => void): () => void {
    let timer: number | null = null;
    const fire = (path: string) => {
      const last = this.recentWrites.get(path);
      if (last && Date.now() - last < 2500) return; // ignore our own writes (echo guard)
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(cb, 150);
    };
    const refs = [
      this.app.vault.on("modify", (f) => fire(f.path)),
      this.app.vault.on("create", (f) => fire(f.path)),
      this.app.vault.on("delete", (f) => fire(f.path)),
      this.app.vault.on("rename", (f) => fire(f.path)),
    ];
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      for (const ref of refs) this.app.vault.offref(ref);
    };
  }
}
