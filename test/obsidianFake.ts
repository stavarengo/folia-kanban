// An in-memory stand-in for the parts of the `obsidian` runtime `src/obsidian/vaultRepo.ts` uses.
//
// The published `obsidian` package ships types only, so a test that constructs `VaultRepository`
// has nothing to import at runtime. `vitest.config.ts` aliases the module id to this file, which
// keeps `instanceof TFile` / `instanceof TFolder` meaningful: the adapter and the test share one
// class identity. TypeScript still sees the real `.d.ts` (the alias is vitest-only), so the fake is
// free to model only the surface the adapter actually touches. That is deliberately ALL it models:
// a test that needs to import `src/view.tsx` or `src/main.ts` (which use `Plugin`, `FileView`,
// `Setting`, `Notice` …) has to add those here first, and will fail loudly at import until it does.
//
// Deliberately NOT derived from each other: a file's text and its `metadataCache` entry are set
// independently, because the adapter's freshness rules (read the text, not the cache) only mean
// something when a test can make the two disagree the way a real vault does mid-write.

import type { PaneType } from "obsidian";
import { parse, stringify } from "yaml";

interface FakeDebouncer<T extends unknown[], V> {
  (...args: T): FakeDebouncer<T, V>;
  cancel(): FakeDebouncer<T, V>;
  run(): V | void;
}

export function debounce<T extends unknown[], V>(
  cb: (...args: T) => V,
  timeout = 0,
  resetTimer = false,
): FakeDebouncer<T, V> {
  let timer: number | null = null;
  let context: unknown = null;
  let args: T | null = null;
  let resetDeadline = 0;
  let scheduledUntil = 0;
  const activeTimerWindow = () => (globalThis as { activeWindow?: Window }).activeWindow ?? window;
  let timerWindow = activeTimerWindow();
  const invoke = () => {
    const callContext = context;
    const callArgs = args;
    context = null;
    args = null;
    if (callArgs !== null) return cb.apply(callContext, callArgs);
  };
  const fire = () => {
    if (resetDeadline) {
      const now = Date.now();
      if (now < resetDeadline) {
        timerWindow = activeTimerWindow();
        timer = timerWindow.setTimeout(fire, resetDeadline - now);
        resetDeadline = 0;
        return;
      }
    }
    scheduledUntil = 0;
    timer = null;
    invoke();
  };
  function schedule(this: unknown, ...nextArgs: T) {
    context = this;
    args = nextArgs;
    const now = Date.now();
    if (timer !== null) {
      if (resetTimer) resetDeadline = scheduledUntil = now + timeout;
      else if (timerWindow !== activeTimerWindow() && scheduledUntil <= now) {
        timerWindow.clearTimeout(timer);
        timerWindow = activeTimerWindow();
        timer = timerWindow.setTimeout(fire, 0);
      }
    } else {
      timerWindow = activeTimerWindow();
      scheduledUntil = now + timeout;
      timer = timerWindow.setTimeout(fire, timeout);
    }
    return schedule;
  }
  schedule.cancel = () => {
    if (timer !== null) {
      timerWindow.clearTimeout(timer);
      timer = null;
    }
    return schedule;
  };
  schedule.run = () => {
    if (timer === null) return;
    timerWindow.clearTimeout(timer);
    timer = null;
    return invoke();
  };
  return schedule;
}

export function parseFrontMatterEntry(
  frontmatter: Record<string, unknown> | null,
  key: string | RegExp,
): unknown | null {
  if (frontmatter === null) return null;
  const match = Object.keys(frontmatter).find((name) =>
    typeof key === "string" ? name === key : key.test(name),
  );
  return match === undefined ? null : (frontmatter[match] ?? null);
}

/**
 * Obsidian's own `parseFrontMatterTags`, as 1.13.7 ships it (and 1.10.6 and 1.12.7 alike): the
 * first key matching `tags` in any case; a string is one value, a list keeps its strings; each is
 * trimmed, one that is empty or holds a space is dropped, and the rest gain a leading `#`.
 */
export function parseFrontMatterTags(frontmatter: Record<string, unknown> | null): string[] | null {
  const value = parseFrontMatterEntry(frontmatter, /^tags$/i);
  if (!value) return null;
  const raw =
    typeof value === "string"
      ? [value.trim()]
      : Array.isArray(value)
        ? value.filter((t): t is string => typeof t === "string").map((t) => t.trim())
        : null;
  return (
    raw
      ?.filter((t) => t !== "" && !t.includes(" "))
      .map((t) => (t.startsWith("#") ? t : "#" + t)) ?? null
  );
}

/** Obsidian's own `normalizePath`: tidy separators only — `.` and `..` are left for callers. */
export function normalizePath(path: string): string {
  const tidied = path
    .replace(/([\\/])+/g, "/")
    .replace(/(^\/+|\/+$)/g, "")
    .replace(/[\u00A0\u202F]/g, " ")
    .normalize("NFC");
  return tidied === "" ? "/" : tidied;
}

/**
 * Obsidian's own `parseYaml`. Obsidian 1.13 bundles the same `yaml` package and calls its
 * `parse(text, null, {})` with default options, which is exactly this. What the fake cannot pin is
 * which `yaml` release a given Obsidian build carries.
 */
export function parseYaml(yaml: string): unknown {
  return parse(yaml);
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

/** The adapter's dialogs extend and build these; no suite here opens one, so they only exist. */
export class Modal {}
export class Setting {}
export class Notice {}

export class Component {
  loaded = false;
  load(): void {
    this.loaded = true;
  }
  unload(): void {
    this.loaded = false;
  }
}

/**
 * Obsidian's reading of a click's modifiers, mirrored from the shipped app (1.13.7): a middle
 * click and a Mod click both mean a new tab, Mod+Alt a split, Mod+Alt+Shift a new window, and
 * anything else `false` — which `getLeaf` reads as "the current one". Written out here only
 * because the fake has to answer something; production never reimplements it, it calls Obsidian.
 * Mod is Ctrl or Cmd: the real one picks by platform, and a test has no platform worth picking.
 */
export const Keymap = {
  isModEvent(evt?: MouseEvent | KeyboardEvent | null): "tab" | "split" | "window" | boolean {
    if (!evt) return false;
    if (evt instanceof MouseEvent && evt.button === 1) return "tab";
    if (!evt.ctrlKey && !evt.metaKey) return false;
    if (!evt.altKey) return "tab";
    return evt.shiftKey ? "window" : "split";
  },
};

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
          // Obsidian (1.13.7) renders `[[target|alias]]` as an anchor showing the alias and
          // carrying the target, as written, in `href`. Modelled because that anchor is what link
          // clicks read; the rest of the markdown stays plain text, which is all any other test
          // asks of it.
          for (const part of markdown.split(/(\[\[[^\]]+\]\])/)) {
            const link = /^\[\[([^\]]+)\]\]$/.exec(part);
            if (!link?.[1]) {
              if (part) el.appendChild(el.ownerDocument.createTextNode(part));
              continue;
            }
            const a = el.ownerDocument.createElement("a");
            const [target = "", alias] = link[1].split("|");
            a.setAttribute("href", target);
            a.textContent = alias ?? target;
            el.appendChild(a);
          }
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

/**
 * Obsidian's type-ahead, as much of it as a test can hold: the popup, its keyboard scope and its
 * placement are the real thing's and have no stand-in here. What a test CAN ask is what the
 * suggester would offer for a query and what happens when one is picked, which is the whole of
 * what the plugin decides — see `suggestionsFor` and `selectSuggestion`.
 */
export abstract class AbstractInputSuggest<T> {
  /** Every suggester ever attached, so a test can catch a second one binding to the same input. */
  static readonly instances: AbstractInputSuggest<unknown>[] = [];
  limit = 100;

  constructor(
    readonly app: unknown,
    readonly textInputEl: HTMLInputElement,
  ) {
    AbstractInputSuggest.instances.push(this as AbstractInputSuggest<unknown>);
  }

  protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;

  /** What the popup would show for what has been typed so far. */
  suggestionsFor(query: string): T[] | Promise<T[]> {
    return this.getSuggestions(query);
  }

  open(): void {}
  close(): void {}
  setValue(value: string): void {
    this.textInputEl.value = value;
  }
  getValue(): string {
    return this.textInputEl.value;
  }
  onSelect(): this {
    return this;
  }
}

/**
 * A case-insensitive subsequence match, standing in for Obsidian's fuzzy scorer: the fewer runs the
 * query is split into, the better the score.
 */
export function prepareFuzzySearch(query: string) {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  return (text: string): { score: number; matches: [number, number][] } | null => {
    const hay = text.toLowerCase();
    const matches: [number, number][] = [];
    let from = 0;
    for (const ch of needle) {
      const at = hay.indexOf(ch, from);
      if (at < 0) return null;
      const last = matches.at(-1);
      if (last && last[1] === at) last[1] = at + 1;
      else matches.push([at, at + 1]);
      from = at + 1;
    }
    return { score: -matches.length, matches };
  };
}

/** Writes `text` into `el`, each matched range in a highlight span, as Obsidian's does. */
export function renderMatches(
  el: HTMLElement,
  text: string,
  matches: [number, number][] | null,
): void {
  let at = 0;
  for (const [from, to] of matches ?? []) {
    el.append(text.slice(at, from));
    el.createEl("span", { cls: "suggestion-highlight", text: text.slice(from, to) });
    at = to;
  }
  el.append(text.slice(at));
}

/** The input and the change callback of Obsidian's search field; the clear button is not drawn. */
export class SearchComponent {
  readonly inputEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    this.inputEl = containerEl.createDiv("search-input-container").createEl("input");
    this.inputEl.type = "search";
  }

  onChange(callback: (value: string) => void): this {
    this.inputEl.addEventListener("input", () => callback(this.inputEl.value));
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
}

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

/**
 * Obsidian's metadata reader's frontmatter rule, copied from the Markdown tokenizer in its worker
 * (the same in 1.10.6, 1.12.7 and 1.13.7). It first turns every line ending into `\n`, so `end`,
 * just past the closing `---`, is an offset in that text.
 */
export function obsidianReader(raw: string): { yaml: string; end: number } | null {
  const n = raw.replace(/\r\n|\r/g, "\n");
  if (n.slice(0, 3) !== "---" || n.charAt(3) !== "\n") return null;
  let i = n.indexOf("---", 3);
  while (i !== -1 && n.charAt(i - 1) !== "\n") i = n.indexOf("---", i + 3);
  return i === -1 ? null : { yaml: n.slice(4, Math.max(4, i - 1)), end: i + 3 };
}

function asFields(yaml: string): Record<string, unknown> {
  const parsed: unknown = parse(yaml);
  return parsed !== null && typeof parsed === "object"
    ? { ...(parsed as Record<string, unknown>) }
    : {};
}

// `processFrontMatter` splits by `getFrontMatterInfo`, which is stricter than the metadata reader
// the model follows: its closing line must be exactly `---`, and a note it sees no block in gets a
// new block on top. Kept separate so the suite sees that disagreement as Obsidian has it.
const WRITER_FRONTMATTER = /^---\r?\n((?:[\s\S]*?\n)??)---(?:\r?\n|$)/;

function splitNote(text: string): { fm: Record<string, unknown>; body: string } {
  const match = WRITER_FRONTMATTER.exec(text);
  if (!match) return { fm: {}, body: text };
  return { fm: asFields(match[1] ?? ""), body: text.slice(match[0].length) };
}

function joinNote(fm: Record<string, unknown>, body: string): string {
  if (Object.keys(fm).length === 0) return body;
  return `---\n${stringify(fm)}---\n${body}`;
}

export class FakeVault extends Events {
  static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => unknown): void {
    let pending: TAbstractFile[] = [root];
    while (pending.length > 0) {
      const file = pending.pop();
      if (!file) continue;
      cb(file);
      if (file instanceof TFolder) pending = pending.concat(file.children);
    }
  }
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

  getFileByPath(path: string): TFile | null {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }

  getFolderByPath(path: string): TFolder | null {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.nodes.get(path) ?? null;
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return [...this.nodes.values()];
  }

  getMarkdownFiles(): TFile[] {
    const files: TFile[] = [];
    FakeVault.recurseChildren(this.root(), (node) => {
      if (node instanceof TFile && node.extension === "md") files.push(node);
    });
    return files;
  }

  cachedRead(file: TFile): Promise<string> {
    this.reads.push(file.path);
    return Promise.resolve(this.texts.get(file.path) ?? "");
  }

  /**
   * The uncached read, which a real vault answers from the file rather than from its display cache.
   * Separate here for the same reason it is separate there: a test can make `cachedRead` lag behind
   * the file, and anything deciding a write must not be fooled by that.
   */
  read(file: TFile): Promise<string> {
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

  /** What the metadata cache holds: the block by Obsidian's reader, not by the model under test. */
  frontmatter(path: string): Record<string, unknown> {
    return asFields(obsidianReader(this.texts.get(path) ?? "")?.yaml ?? "");
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

export { FakeVault as Vault };

export class FakeMetadataCache extends Events {
  private caches = new Map<string, Record<string, unknown>>();
  private tags = new Map<string, { tag: string }[]>();
  newLinkFormat: "shortest" | "relative" | "absolute" = "shortest";

  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension = true): string {
    const path = file.extension === "md" && omitMdExtension ? file.path.slice(0, -3) : file.path;
    if (this.newLinkFormat === "absolute") return path;
    if (this.newLinkFormat === "relative") {
      const slash = sourcePath.lastIndexOf("/");
      let sourceFolder = slash === -1 ? "" : sourcePath.slice(0, slash);
      let prefix = "";
      while (sourceFolder && !path.startsWith(`${sourceFolder}/`)) {
        prefix += "../";
        sourceFolder = sourceFolder.slice(0, sourceFolder.lastIndexOf("/"));
      }
      return prefix + (sourceFolder ? path.slice(sourceFolder.length + 1) : path);
    }
    const name = file.extension === "md" && omitMdExtension ? file.basename : file.name;
    const files = this.vault
      .getAllLoadedFiles()
      .filter((node): node is TFile => node instanceof TFile);
    const matching = (candidate: string) =>
      files.filter((node) => node.name.toLowerCase() === candidate.toLowerCase());
    let lookup = name;
    let matches = name.includes(".") ? matching(lookup) : [];
    if (matches.length === 0) {
      lookup += ".md";
      matches = matching(lookup);
    }
    if (matches.length === 1 && matches[0] === file) return name;
    const exact = matches.find((node) => node.path.toLowerCase() === lookup.toLowerCase());
    return exact === file ? name : path;
  }

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

  /**
   * The body tags the cache claims a note carries, `#` included the way Obsidian reports them.
   * Set explicitly like the frontmatter above, and for the same reason: whether a `#word` in a
   * body counts as a tag is Obsidian's lexer's answer, and a fake that guessed it from the text
   * would be a second answer no test could tell apart from the real one.
   */
  setTags(path: string, tags: string[] | undefined): void {
    if (tags === undefined) this.tags.delete(path);
    else
      this.tags.set(
        path,
        tags.map((tag) => ({ tag })),
      );
  }

  /**
   * Obsidian's own link resolution, close enough for the rules Folia depends on and measured
   * against Obsidian 1.13.7 in the examples vault:
   *
   * - a linkpath carrying a folder is read from the vault root first, then relative to the note
   *   the link is written in;
   * - a bare file name binds to a note in the SAME folder as the source before any other, and
   *   between the rest to the first in path order — never to nothing, which is where the real
   *   thing and Folia's old basename index part ways;
   * - a `.md` suffix is accepted;
   * - an ALIAS is not a link target. `[[Some alias]]` lands in `unresolvedLinks` in Obsidian too;
   *   aliases only feed the link suggester, which rewrites the link to `[[Note|Some alias]]` as it
   *   inserts it. A fake that resolved them would be a rule Obsidian does not have.
   */
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    const clean = linkpath.replace(/\.md$/i, "").trim();
    if (clean === "") return null;
    const at = (path: string): TFile | null => {
      const f = this.vault.getAbstractFileByPath(path);
      return f instanceof TFile ? f : null;
    };
    const slash = sourcePath.lastIndexOf("/");
    const sourceDir = slash === -1 ? "" : sourcePath.slice(0, slash);
    if (clean.includes("/")) {
      return at(`${clean}.md`) ?? (sourceDir ? at(`${sourceDir}/${clean}.md`) : null);
    }
    const named = this.vault
      .getMarkdownFiles()
      .filter((f) => f.basename === clean)
      .sort((a, b) => a.path.localeCompare(b.path));
    const sameFolder = named.find(
      (f) => f.path === `${sourceDir ? sourceDir + "/" : ""}${clean}.md`,
    );
    return sameFolder ?? named[0] ?? null;
  }

  getFileCache(file: TFile): {
    frontmatter?: Record<string, unknown>;
    tags?: { tag: string }[];
  } | null {
    const frontmatter = this.caches.get(file.path);
    const tags = this.tags.get(file.path);
    if (frontmatter === undefined && tags === undefined) return null;
    return {
      ...(frontmatter !== undefined ? { frontmatter } : {}),
      ...(tags !== undefined ? { tags } : {}),
    };
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
  constructor(
    private vault: FakeVault,
    private cache: FakeMetadataCache,
  ) {}
  useMarkdownLinks = false;

  async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> {
    this.vault.writeFrontmatter(file.path, fn);
  }

  /**
   * The vault's default link style: the shortest name that still names one note (Obsidian's
   * `newLinkFormat: "shortest"`), so a file name two folders share is written as a full path.
   * Wikilink form, which is what the vault this is a fake of is set to.
   */
  generateMarkdownLink(file: TFile, sourcePath: string): string {
    const linktext = this.cache.fileToLinktext(file, sourcePath, true);
    return this.useMarkdownLinks ? `[${file.basename}](${linktext}.md)` : `[[${linktext}]]`;
  }

  async renameFile(file: TAbstractFile, dest: string): Promise<void> {
    this.vault.move(file, dest);
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    this.vault.trashed.push(file.path);
    this.vault.remove(file);
  }

  /** What the person answers the delete prompt, and whether the prompt trashes the file itself
   *  (Obsidian 1.13.7 does; the typings do not say). */
  deletePrompt = { answer: true, trashesItself: true };

  async promptForDeletion(file: TAbstractFile): Promise<boolean> {
    if (this.deletePrompt.answer && this.deletePrompt.trashesItself) await this.trashFile(file);
    return this.deletePrompt.answer;
  }
}

export class FakeApp {
  readonly vault = new FakeVault();
  readonly metadataCache = new FakeMetadataCache(this.vault);
  readonly fileManager = new FakeFileManager(this.vault, this.metadataCache);
  /** Every note `openCard` asked the workspace to open. */
  readonly opened: string[] = [];
  /** Where each of those opens was asked to land, in `getLeaf`'s own vocabulary, same order. */
  readonly openedIn: (PaneType | boolean)[] = [];
  /** Every link `followLink` asked the workspace to open, and where. */
  readonly linksOpened: { linktext: string; sourcePath: string; newLeaf: PaneType | boolean }[] =
    [];
  readonly workspace = {
    getLeaf: (newLeaf: PaneType | boolean) => ({
      openFile: (file: TFile) => {
        this.opened.push(file.path);
        this.openedIn.push(newLeaf);
        return Promise.resolve();
      },
    }),
    openLinkText: (linktext: string, sourcePath: string, newLeaf: PaneType | boolean) => {
      this.linksOpened.push({ linktext, sourcePath, newLeaf });
      return Promise.resolve();
    },
  };
}

// The host controls behind `mountButton`, `mountIconButton`, `mountDropdown` and `mountProgressBar`,
// drawn the way Obsidian 1.13.7 draws them. What the adapter adds on top (a role, `aria-disabled`,
// the click it hands over) is deliberately missing here, so a test sees the adapter supply it.

/** A `button`; its click callback gets the event, and one that returns a promise shows loading. */
export class ButtonComponent {
  readonly buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = containerEl.createEl("button");
  }

  onClick(callback: (evt: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener("click", (evt) => {
      const result = callback(evt);
      if (!(result instanceof Promise)) return;
      this.buttonEl.classList.add("mod-loading");
      void result.finally(() => this.buttonEl.classList.remove("mod-loading"));
    });
    return this;
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setCta(): this {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }

  removeCta(): this {
    this.buttonEl.classList.remove("mod-cta");
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return this;
  }
}

/**
 * A focusable `div` with no role. Enter and Space press it without a click, and its callback gets no
 * event. Disabled, it ignores presses and leaves the tab order.
 */
/** Which release's icon button the fake draws. Before 1.13 it had no tab stop and no key handling. */
export const extraButtonShape = { keyboard: true };

export class ExtraButtonComponent {
  readonly extraSettingsEl: HTMLElement;
  disabled = false;
  private readonly keyboard = extraButtonShape.keyboard;
  private callback: () => unknown = () => {};

  constructor(containerEl: HTMLElement) {
    this.extraSettingsEl = containerEl.createDiv("clickable-icon");
    this.extraSettingsEl.addEventListener("click", () => {
      if (!this.disabled) this.callback();
    });
    if (!this.keyboard) return;
    this.extraSettingsEl.tabIndex = 0;
    this.extraSettingsEl.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      if (!this.disabled) this.callback();
    });
  }

  onClick(callback: () => unknown): this {
    this.callback = callback;
    return this;
  }

  setIcon(icon: string): this {
    const svg = this.extraSettingsEl.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svg.setAttribute("class", `svg-icon lucide-${icon}`);
    this.extraSettingsEl.replaceChildren(svg);
    return this;
  }

  setTooltip(tooltip: string): this {
    this.extraSettingsEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.extraSettingsEl.classList.toggle("is-disabled", disabled);
    if (!this.keyboard) return this;
    if (disabled) this.extraSettingsEl.removeAttribute("tabindex");
    else this.extraSettingsEl.tabIndex = 0;
    return this;
  }
}

/** The real select, then a hidden one the host measures the width with. `setValue` is silent. */
export class DropdownComponent {
  readonly selectEl: HTMLSelectElement;

  constructor(containerEl: HTMLElement) {
    this.selectEl = containerEl.createEl("select", "dropdown");
    containerEl.createEl("select", {
      cls: "dropdown is-measuring",
      attr: { "aria-hidden": "true" },
    });
  }

  addOption(value: string, display: string): this {
    this.selectEl.createEl("option", { text: display, attr: { value } });
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.selectEl.addEventListener("change", () => callback(this.selectEl.value));
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.selectEl.disabled = disabled;
    return this;
  }
}

/** A track holding a fill as wide as the value, 0 to 100, with no role or value of its own. */
export class ProgressBarComponent {
  private readonly fill: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.fill = containerEl
      .createDiv("setting-progress-bar")
      .createDiv("setting-progress-bar-inner");
  }

  setValue(value: number): this {
    this.fill.style.width = `${value}%`;
    return this;
  }
}
