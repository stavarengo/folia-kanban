// In-memory CardRepository for tests. Stores frontmatter + body separately (mirroring how
// the real adapter treats them) and runs the REAL model functions on the body, so UI tests
// exercise genuine parse/mutate logic without Obsidian.

import type { CardRepository } from "../src/model/repo";
import type { FileOp } from "../src/model/pathOps";
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
} from "../src/model/types";
import type { CardMutation } from "../src/model/board";
import { buildBoard, deriveContext } from "../src/model/board";
import {
  SECTION,
  addSubcard,
  addTodo,
  appendComment,
  appendHistory,
  cardStats,
  parseBody,
  parseSubtasks,
  pendingSubcardLinks,
  removeSubtask,
  removeTimestampedLine,
  setDescription,
  setSubcardDone,
  setSubtaskDone,
  setSubtaskStatus,
  updateTimestampedLine,
} from "../src/model/card";

import { TITLE_KEY, resolveTitle, sanitizeFilename, setHeadingTitle } from "../src/model/cardTitle";
import { isSelfRelation, withRelation, withoutRelation } from "../src/model/relationships";
import { mergePriorities, serializePriorities } from "../src/model/priorities";
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
} from "../src/model/history";

/** Same per-context config note name the vault adapter uses (#14). */
const CONTEXT_NOTE = "_context.md";

interface Entry {
  basename: string;
  fm: CardFrontmatter;
  body: string;
}

let seq = 0;

export class FakeRepo implements CardRepository {
  files = new Map<string, Entry>();
  listeners = new Set<() => void>();
  fileOpListeners = new Set<(op: FileOp) => void>();
  opened: string[] = [];
  ts = "2026-06-13 12:00";
  /** Test hook mirroring VaultRepository's `cardFolderWarning` (missing card-folder, #20260821.07). */
  cardFolderMissing = false;
  /** Test hook: when set, `loadBoard` throws with this message (mirrors a card-folder that
   *  resolves to a file rather than a folder — an unrecoverable misconfiguration, #20260821.07). */
  failLoadWith: string | null = null;

  constructor(
    public config: BoardConfig,
    initial: Record<string, { fm: CardFrontmatter; body: string }> = {},
    public getHistoryScope: () => HistoryScope = () => "moves",
    /** Mirrors VaultRepository's: the name new comments are signed with; empty = unsigned. */
    public getUserName: () => string = () => "",
  ) {
    for (const [path, e] of Object.entries(initial)) {
      this.files.set(path, { basename: basename(path), fm: { ...e.fm }, body: e.body });
    }
  }

  private maybeHistory(path: string, kind: Parameters<typeof historyAllows>[1], line: string) {
    if (!historyAllows(this.getHistoryScope(), kind)) return;
    const e = this.entry(path);
    e.body = appendHistory(e.body, line, this.ts);
  }

  private toCard(path: string, e: Entry): Card {
    const subItems = parseSubtasks(e.body);
    const childLinks = subItems.filter((s) => s.kind === "card" && s.link).map((s) => s.link!);
    const { title, source } = this.resolveTitle(e);
    return {
      path,
      basename: e.basename,
      title,
      titleSource: source,
      frontmatter: e.fm,
      childLinks,
      subItems,
      stats: cardStats(e.body),
    };
  }

  private resolveTitle(e: Entry) {
    return resolveTitle(e.basename, e.fm, e.body, this.config.titleMode);
  }

  async loadBoard(): Promise<Board> {
    if (this.failLoadWith) throw new Error(this.failLoadWith);
    const cards = [...this.files.entries()]
      .filter(([, e]) => e.basename + ".md" !== CONTEXT_NOTE) // `_context.md` is config, not a card
      .map(([p, e]) => this.toCard(p, e));
    const board = buildBoard(this.config, cards, await this.loadContexts());
    return this.cardFolderMissing
      ? {
          ...board,
          cardFolderWarning: `Card folder "${this.config.cardFolder}" was not found. It will be created when you add your first card.`,
        }
      : board;
  }

  async loadContexts(): Promise<Record<string, ContextConfig>> {
    const out: Record<string, ContextConfig> = {};
    // Derive contexts from the file map: any subfolder under the card folder is a context, and a
    // `_context.md` inside it supplies the display config (mirrors the vault adapter's folder scan).
    for (const [path, e] of this.files.entries()) {
      const folder = deriveContext(this.config.cardFolder, path);
      if (folder === undefined) continue;
      if (!out[folder]) out[folder] = { name: folder, body: "", folder };
      if (e.basename + ".md" === CONTEXT_NOTE) {
        // The fake stores frontmatter (`fm`) apart from `body`, so `body` is already frontmatter-free.
        const fm = e.fm as Record<string, unknown>;
        const name =
          typeof fm["context-name"] === "string" && fm["context-name"].trim()
            ? String(fm["context-name"])
            : folder;
        const color =
          typeof fm["color"] === "string" && fm["color"].trim() ? String(fm["color"]) : undefined;
        const label =
          typeof fm["label"] === "string" && fm["label"].trim() ? String(fm["label"]) : undefined;
        out[folder] = {
          name,
          ...(color !== undefined ? { color } : {}),
          ...(label !== undefined ? { label } : {}),
          body: e.body,
          folder,
        };
      }
    }
    return out;
  }

  async readBody(path: string): Promise<CardBody> {
    return parseBody(this.files.get(path)!.body);
  }

  private entry(path: string): Entry {
    const e = this.files.get(path);
    if (!e) throw new Error("no such card " + path);
    return e;
  }

  async setFrontmatter(path: string, patch: Partial<CardFrontmatter>): Promise<void> {
    Object.assign(this.entry(path).fm, patch);
    for (const [k, v] of Object.entries(patch)) {
      if (k === "priority") this.maybeHistory(path, "priority", priorityLine(String(v)));
      else if (k === "due") this.maybeHistory(path, "due", dueLine(String(v)));
      else if (k === "status") this.maybeHistory(path, "status", statusLine(String(v)));
    }
  }

  async unsetFrontmatterKey(path: string, key: string): Promise<void> {
    delete this.entry(path).fm[key];
  }

  async applyMove(mutation: CardMutation) {
    if (mutation.setFrontmatter)
      Object.assign(this.entry(mutation.path).fm, mutation.setFrontmatter);
    for (const key of mutation.unsetFrontmatter ?? []) delete this.entry(mutation.path).fm[key];
    if (mutation.setSubtaskStatus) {
      const { index, status, done } = mutation.setSubtaskStatus;
      const e = this.entry(mutation.path);
      e.body = setSubtaskStatus(
        done === undefined ? e.body : setSubtaskDone(e.body, index, done),
        index,
        status,
      );
    }
    if (mutation.history) {
      const e = this.entry(mutation.path);
      e.body = appendHistory(e.body, mutation.history, this.ts);
    }
    // Mirrors the vault adapter: only what still needs the write is written and logged, and a
    // missing parent does not stop the others.
    let failure: unknown;
    for (const { path, links, done } of mutation.parentLines ?? []) {
      try {
        const e = this.entry(path);
        const pending = pendingSubcardLinks(e.body, links, done);
        if (pending.length === 0) continue;
        e.body = setSubcardDone(
          e.body,
          pending.map((p) => p.link),
          done,
        );
        for (const { text } of pending) {
          this.maybeHistory(
            path,
            "subtask",
            done ? subtaskDoneLine(text) : subtaskReopenedLine(text),
          );
        }
      } catch (e) {
        failure ??= e;
      }
    }
    if (failure !== undefined) throw failure;
  }

  async setDescription(path: string, description: string) {
    this.entry(path).body = setDescription(this.entry(path).body, description);
  }
  async addComment(path: string, text: string) {
    this.entry(path).body = appendComment(this.entry(path).body, text, this.ts, this.getUserName());
    this.maybeHistory(path, "comment", commentAddedLine());
  }
  async updateComment(path: string, index: number, text: string) {
    this.entry(path).body = updateTimestampedLine(
      this.entry(path).body,
      SECTION.comments,
      index,
      text,
    );
    this.maybeHistory(path, "comment", commentEditedLine());
  }
  async removeComment(path: string, index: number) {
    this.entry(path).body = removeTimestampedLine(this.entry(path).body, SECTION.comments, index);
    this.maybeHistory(path, "comment", commentRemovedLine());
  }
  async addTodo(path: string, text: string) {
    this.entry(path).body = addTodo(this.entry(path).body, text);
    this.maybeHistory(path, "subtask", subtaskAddedLine(text));
  }
  async toggleSubtask(path: string, index: number, done: boolean) {
    const itemText = parseSubtasks(this.entry(path).body)[index]?.text ?? "";
    this.entry(path).body = setSubtaskDone(this.entry(path).body, index, done);
    this.maybeHistory(
      path,
      "subtask",
      done ? subtaskDoneLine(itemText) : subtaskReopenedLine(itemText),
    );
  }
  async removeSubtask(path: string, index: number) {
    const itemText = parseSubtasks(this.entry(path).body)[index]?.text ?? "";
    this.entry(path).body = removeSubtask(this.entry(path).body, index);
    this.maybeHistory(path, "subtask", subtaskRemovedLine(itemText));
  }

  private editRelations(
    path: string,
    type: RelationType,
    rewrite: (fm: CardFrontmatter) => string[] | null,
  ): boolean {
    const fm = this.entry(path).fm;
    const next = rewrite(fm);
    if (next === null) return false;
    if (next.length === 0) delete fm[type];
    else fm[type] = next;
    return true;
  }

  private knownRelation(type: RelationType): boolean {
    return this.config.relations.some((t) => t.key === type);
  }

  async addRelation(path: string, type: RelationType, target: string): Promise<void> {
    // Mirrors the vault adapter: a card never stores a link to itself, nor under an unknown key.
    if (isSelfRelation(path, this.entry(path).basename, target)) return;
    if (!this.knownRelation(type)) return;
    if (this.editRelations(path, type, (fm) => withRelation(fm, type, target)))
      this.maybeHistory(path, "relation", relationAddedLine(type, target));
  }

  async removeRelation(
    path: string,
    type: RelationType,
    targets: readonly string[],
  ): Promise<void> {
    if (!this.knownRelation(type)) return;
    const shown = targets[0];

    if (this.editRelations(path, type, (fm) => withoutRelation(fm, type, targets)) && shown)
      this.maybeHistory(path, "relation", relationRemovedLine(type, shown));
  }

  async createCard(title: string, status: string): Promise<string> {
    const path = `${this.config.cardFolder}/${title}.md`;
    const unique = this.files.has(path) ? `${this.config.cardFolder}/${title} ${++seq}.md` : path;
    this.files.set(unique, {
      basename: basename(unique),
      fm: { type: "task", status, created: "2026-06-13" },
      body: `\n# ${title}\n`,
    });
    return unique;
  }

  async addSubcard(parentPath: string, title: string): Promise<string> {
    const status = String(this.entry(parentPath).fm.status ?? "todo");
    const childPath = await this.createCard(title, status);
    this.entry(parentPath).body = addSubcard(this.entry(parentPath).body, basename(childPath));
    return childPath;
  }

  async setColumns(columns: ColumnDef[]): Promise<void> {
    this.config = { ...this.config, columns };
  }

  async rememberPriorities(values: string[]): Promise<void> {
    const merged = mergePriorities(this.config.priorities, values);
    if (merged === null) return;
    this.config = { ...this.config, priorities: serializePriorities(merged) ?? [] };
  }

  async deleteCard(path: string): Promise<void> {
    this.files.delete(path);
    this.emitFileOp({ kind: "delete", path });
  }

  async renameCard(path: string, newTitle: string): Promise<string> {
    const e = this.entry(path);
    const title = newTitle.trim();
    if (!title) return path; // blank title — no-op, per the CardRepository contract
    // Mirrors the vault adapter: the title is written back to the source it came from.
    const { title: current, source } = this.resolveTitle(e);
    if (title === current) return path; // unchanged — no write
    if (source === "frontmatter") {
      e.fm[TITLE_KEY] = title;
      return path;
    }
    if (source === "heading") {
      e.body = setHeadingTitle(e.body, e.basename, this.config.titleMode, title);
      return path;
    }
    return this.renameFile(path, title);
  }

  async renameFile(path: string, newBasename: string): Promise<string> {
    const e = this.entry(path);
    const wanted = newBasename.trim();
    if (!wanted) return path; // a blank name is not a name — nothing to rename to
    const base = sanitizeFilename(wanted);
    if (base === e.basename) return path; // unchanged once made safe to use as a file name
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const prefix = folder ? `${folder}/` : "";
    let dest = `${prefix}${base}.md`;
    let n = 1;
    while (this.files.has(dest) && dest !== path) dest = `${prefix}${base} ${n++}.md`;
    if (dest === path) return path;
    // Move the map entry under its new basename — the one the destination path actually got, which
    // a collision suffixes (`New` landing beside an existing `New.md` becomes `New 1`)...
    const newBase = basename(dest);
    this.files.delete(path);
    this.files.set(dest, { ...e, basename: newBase });
    // ...and rewrite every inbound `[[OldBasename]]` wikilink to THAT name, so a suffixed rename
    // links to the card that moved rather than to the one it collided with (mirrors Obsidian's
    // link-aware fileManager.renameFile, keeping buildBoard's `## Subtasks` graph correct).
    const oldBase = e.basename;
    for (const other of this.files.values()) {
      other.body = rewriteWikilinks(other.body, oldBase, newBase);
    }
    // The vault reports the plugin's own file operations too, so the fake does the same — that is
    // what makes a test cover the in-app path and the listener path running over each other.
    this.emitFileOp({ kind: "rename", from: path, to: dest });
    return dest;
  }

  /** Stands in for a desktop vault; set to `null` to act like one with no filesystem path. */
  vaultBasePath: string | null = "/vault";

  absolutePath(path: string): string | null {
    return this.vaultBasePath === null ? null : `${this.vaultBasePath}/${path}`;
  }

  async openCard(path: string): Promise<void> {
    this.opened.push(path);
  }

  renderMarkdown(el: HTMLElement, markdown: string): () => void {
    el.textContent = markdown;
    return () => {
      el.textContent = "";
    };
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onFileOp(cb: (op: FileOp) => void): () => void {
    this.fileOpListeners.add(cb);
    return () => this.fileOpListeners.delete(cb);
  }

  /** test helper: simulate an external change */
  notify() {
    for (const cb of this.listeners) cb();
  }

  /** test helper: simulate a rename/move/delete done outside the board (explorer, other plugin) */
  notifyFileOp(op: FileOp) {
    this.emitFileOp(op);
  }

  private emitFileOp(op: FileOp) {
    for (const cb of this.fileOpListeners) cb(op);
  }
}

function basename(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/** Rewrite `[[old]]` / `[[old|alias]]` / `[[old#heading]]` wikilink targets to `new`, by basename. */
function rewriteWikilinks(body: string, oldBase: string, newBase: string): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const [targetAndHash, ...aliasParts] = inner.split("|");
    if (targetAndHash === undefined) return whole;
    const [target, hash] = targetAndHash.split("#", 2);
    if (target === undefined) return whole;
    const t = target.trim();
    const tBase = t.split("/").pop()!.replace(/\.md$/i, "");
    if (tBase !== oldBase) return whole;
    const folder = t.includes("/") ? t.slice(0, t.lastIndexOf("/") + 1) : "";
    const rebuilt = folder + newBase + (hash !== undefined ? "#" + hash : "");
    return `[[${rebuilt}${aliasParts.length ? "|" + aliasParts.join("|") : ""}]]`;
  });
}
