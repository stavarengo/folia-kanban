// An in-memory stand-in for the parts of the `obsidian` runtime `src/obsidian/vaultRepo.ts` uses.
//
// The published `obsidian` package ships types only, so a test that constructs `VaultRepository`
// has nothing to import at runtime. `vitest.config.ts` aliases the module id to this file, which
// keeps `instanceof TFile` / `instanceof TFolder` meaningful: the adapter and the test share one
// class identity. TypeScript still sees the real `.d.ts` (the alias is vitest-only), so the fake is
// free to model only the surface the adapter actually touches.
//
// Deliberately NOT derived from each other: a file's text and its `metadataCache` entry are set
// independently, because the adapter's freshness rules (read the text, not the cache) only mean
// something when a test can make the two disagree the way a real vault does mid-write.

import { parse, stringify } from "yaml";

/** Obsidian's own `normalizePath`: tidy separators only — `.` and `..` are left for callers. */
export function normalizePath(path: string): string {
  const tidied = path
    .replace(/([\\/])+/g, "/")
    .replace(/(^\/+|\/+$)/g, "")
    .replace(/[\u00A0\u202F]/g, " ")
    .normalize("NFC");
  return tidied === "" ? "/" : tidied;
}

export class TAbstractFile {
  parent: TFolder | null = null;
  constructor(public path: string) {}
  get name(): string {
    return this.path.split("/").pop() ?? this.path;
  }
}

export class TFile extends TAbstractFile {
  get basename(): string {
    return this.name.replace(/\.[^.]+$/, "");
  }
  get extension(): string {
    return this.name.slice(this.basename.length + 1);
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class Component {
  loaded = false;
  load(): void {
    this.loaded = true;
  }
  unload(): void {
    this.loaded = false;
  }
}

export class FileSystemAdapter {
  constructor(private basePath: string) {}
  getFullPath(path: string): string {
    return `${this.basePath}/${path}`;
  }
}

/** A vault on storage that is not a folder on disk (mobile), so `absolutePath` must return null. */
export class CapacitorAdapter {}

/**
 * A render in flight, held open until the test lets it finish. Obsidian's renderer is async and
 * appends into its target while running, which is the only state in which the adapter's cancel
 * guard means anything — an auto-resolving fake would make that code unreachable.
 */
interface PendingRender {
  markdown: string;
  el: HTMLElement;
  finish: () => void;
}

export const MarkdownRenderer = {
  /** Every render started and not yet finished, oldest first. */
  pending: [] as PendingRender[],
  render(_app: unknown, markdown: string, el: HTMLElement, _sourcePath: string, _c: Component) {
    return new Promise<void>((resolve) => {
      MarkdownRenderer.pending.push({
        markdown,
        el,
        finish: () => {
          el.appendChild(el.ownerDocument.createTextNode(markdown));
          resolve();
        },
      });
    });
  },
  /** Let every in-flight render append its output, the way Obsidian's would when it completes. */
  finishAll(): void {
    const started = MarkdownRenderer.pending;
    MarkdownRenderer.pending = [];
    for (const render of started) render.finish();
  },
};

export interface EventRef {
  name: string;
  fn: (...args: never[]) => void;
}

class Events {
  private listeners: EventRef[] = [];
  on(name: string, fn: (...args: never[]) => void): EventRef {
    const ref = { name, fn };
    this.listeners.push(ref);
    return ref;
  }
  offref(ref: EventRef): void {
    this.listeners = this.listeners.filter((l) => l !== ref);
  }
  /** How many listeners are still attached — lets a test prove an unsubscribe really detached. */
  get listenerCount(): number {
    return this.listeners.length;
  }
  emitEvent(name: string, ...args: unknown[]): void {
    for (const l of [...this.listeners])
      if (l.name === name) (l.fn as (...a: unknown[]) => void)(...args);
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitNote(text: string): { fm: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(text);
  if (!match) return { fm: {}, body: text };
  const parsed: unknown = parse(match[1] ?? "");
  const fm = parsed !== null && typeof parsed === "object" ? { ...parsed } : {};
  return { fm: fm as Record<string, unknown>, body: text.slice(match[0].length) };
}

function joinNote(fm: Record<string, unknown>, body: string): string {
  if (Object.keys(fm).length === 0) return body;
  return `---\n${stringify(fm)}---\n${body}`;
}

export class FakeVault extends Events {
  private nodes = new Map<string, TAbstractFile>();
  private texts = new Map<string, string>();
  /** Every read that went through `cachedRead`, in order — the freshness rule's evidence. */
  readonly reads: string[] = [];
  /** Every note the FileManager fake put in the trash, which is not the same as unlinking it. */
  readonly trashed: string[] = [];
  /** Every note created through `create`, with the text it was created WITH (not as it ended up). */
  readonly created: { path: string; text: string }[] = [];
  /**
   * Set by the metadata-cache fake: a real vault indexes a file when it appears, and only catches
   * up with a WRITE a tick later. Seeding and `create` index; writes deliberately do not.
   */
  index: ((path: string) => void) | null = null;
  adapter: unknown = new FileSystemAdapter("/vault");

  constructor() {
    super();
    const root = new TFolder("/");
    this.nodes.set("/", root);
  }

  private root(): TFolder {
    return this.nodes.get("/") as TFolder;
  }

  private link(node: TAbstractFile): void {
    const parentPath = node.path.includes("/")
      ? node.path.slice(0, node.path.lastIndexOf("/"))
      : "/";
    const parent = this.nodes.get(parentPath);
    const folder = parent instanceof TFolder ? parent : this.root();
    node.parent = folder;
    folder.children.push(node);
    this.nodes.set(node.path, node);
  }

  private unlink(node: TAbstractFile): void {
    node.parent?.children.splice(node.parent.children.indexOf(node), 1);
    this.nodes.delete(node.path);
    this.texts.delete(node.path);
  }

  /** Seed a folder (and every folder above it). */
  addFolder(path: string): TFolder {
    const existing = this.nodes.get(path);
    if (existing instanceof TFolder) return existing;
    const parts = path.split("/");
    let current = "";
    let folder = this.root();
    for (const part of parts) {
      current = current === "" ? part : `${current}/${part}`;
      const at = this.nodes.get(current);
      if (at instanceof TFolder) {
        folder = at;
        continue;
      }
      folder = new TFolder(current);
      this.link(folder);
    }
    return folder;
  }

  /** Seed a note. Its folder is created on the way, exactly as a vault would already have it. */
  addFile(path: string, text = ""): TFile {
    if (path.includes("/")) this.addFolder(path.slice(0, path.lastIndexOf("/")));
    const existing = this.nodes.get(path);
    if (existing instanceof TFile) {
      this.texts.set(path, text);
      this.index?.(path);
      return existing;
    }
    const file = new TFile(path);
    this.link(file);
    this.texts.set(path, text);
    this.index?.(path);
    return file;
  }

  /** The note's text as it is on disk right now, for assertions. */
  text(path: string): string | undefined {
    return this.texts.get(path);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.nodes.get(path) ?? null;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.nodes.values()].filter(
      (n): n is TFile => n instanceof TFile && n.path.endsWith(".md"),
    );
  }

  cachedRead(file: TFile): Promise<string> {
    this.reads.push(file.path);
    return Promise.resolve(this.texts.get(file.path) ?? "");
  }

  async process(file: TFile, fn: (text: string) => string): Promise<string> {
    const next = fn(this.texts.get(file.path) ?? "");
    this.texts.set(file.path, next);
    this.emitEvent("modify", file);
    return next;
  }

  async create(path: string, text: string): Promise<TFile> {
    if (this.nodes.has(path)) throw new Error(`File already exists: ${path}`);
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
    if (!(this.nodes.get(parent) instanceof TFolder))
      throw new Error(`Folder does not exist: ${parent}`);
    const file = new TFile(path);
    this.link(file);
    this.texts.set(path, text);
    this.created.push({ path, text });
    this.index?.(path);
    this.emitEvent("create", file);
    return file;
  }

  async createFolder(path: string): Promise<TFolder> {
    if (this.nodes.has(path)) throw new Error(`Already exists: ${path}`);
    return this.addFolder(path);
  }

  /** Vault-internal moves and deletes, used by the FileManager fake. */
  move(file: TAbstractFile, dest: string): void {
    const old = file.path;
    const text = this.texts.get(old);
    // A folder move carries everything under it, and the vault reports it as ONE rename of the
    // folder — never one event per child. `onFileOp` consumers are written against exactly that.
    const inside =
      file instanceof TFolder
        ? [...this.nodes.values()].filter((n) => n.path.startsWith(old + "/"))
        : [];
    const insideText = new Map(inside.map((n) => [n.path, this.texts.get(n.path)]));
    for (const node of inside) this.unlink(node);
    this.unlink(file);
    file.path = dest;
    this.link(file);
    if (text !== undefined) this.texts.set(dest, text);
    for (const node of inside) {
      const moved = dest + node.path.slice(old.length);
      const nodeText = insideText.get(node.path);
      node.path = moved;
      this.link(node);
      if (nodeText !== undefined) this.texts.set(moved, nodeText);
    }
    this.emitEvent("rename", file, old);
  }

  remove(file: TAbstractFile): void {
    if (file instanceof TFolder)
      for (const node of [...this.nodes.values()].filter((n) => n.path.startsWith(file.path + "/")))
        this.unlink(node);
    this.unlink(file);
    this.emitEvent("delete", file);
  }

  frontmatter(path: string): Record<string, unknown> {
    return splitNote(this.texts.get(path) ?? "").fm;
  }

  writeFrontmatter(path: string, fn: (fm: Record<string, unknown>) => void): void {
    const { fm, body } = splitNote(this.texts.get(path) ?? "");
    fn(fm);
    this.texts.set(path, joinNote(fm, body));
    const file = this.nodes.get(path);
    // Obsidian's `processFrontMatter` rewrites the note, so it fires a vault modify like any write.
    if (file instanceof TFile) this.emitEvent("modify", file);
  }
}

export class FakeMetadataCache extends Events {
  private caches = new Map<string, Record<string, unknown>>();
  constructor(private vault: FakeVault) {
    super();
    // A real vault has a cache entry for every file it knows about. Only a WRITE leaves the cache
    // behind, and `catchUp` is that lag ending — so a test that wants a stale (or missing) entry
    // says so with `setFrontmatter`, instead of getting one for free.
    vault.index = (path) => this.setFrontmatter(path, this.readOrNothing(path));
  }

  private readOrNothing(path: string): Record<string, unknown> | undefined {
    try {
      return this.vault.frontmatter(path);
    } catch {
      // Frontmatter Obsidian cannot parse is frontmatter it does not cache.
      return undefined;
    }
  }

  /** Set what the cache claims about a note, independently of the note's text. */
  setFrontmatter(path: string, frontmatter: Record<string, unknown> | undefined): void {
    if (frontmatter === undefined) this.caches.delete(path);
    else this.caches.set(path, frontmatter);
  }

  getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
    const frontmatter = this.caches.get(file.path);
    return frontmatter === undefined ? null : { frontmatter };
  }

  /** The cache catching up a tick after a write, which is what the adapter waits for. */
  catchUp(path: string): void {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    this.setFrontmatter(path, this.readOrNothing(path));
    this.emitEvent("changed", file);
  }
}

export class FakeFileManager {
  constructor(private vault: FakeVault) {}

  async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> {
    this.vault.writeFrontmatter(file.path, fn);
  }

  async renameFile(file: TAbstractFile, dest: string): Promise<void> {
    this.vault.move(file, dest);
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    this.vault.trashed.push(file.path);
    this.vault.remove(file);
  }
}

export class FakeApp {
  readonly vault = new FakeVault();
  readonly metadataCache = new FakeMetadataCache(this.vault);
  readonly fileManager = new FakeFileManager(this.vault);
  /** Every note `openCard` asked the workspace to open. */
  readonly opened: string[] = [];
  readonly workspace = {
    getLeaf: (_newLeaf: boolean) => ({
      openFile: (file: TFile) => {
        this.opened.push(file.path);
        return Promise.resolve();
      },
    }),
  };
}
