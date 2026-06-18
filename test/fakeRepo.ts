// In-memory CardRepository for tests. Stores frontmatter + body separately (mirroring how
// the real adapter treats them) and runs the REAL model functions on the body, so UI tests
// exercise genuine parse/mutate logic without Obsidian.

import type { CardRepository } from "../src/model/repo";
import type {
  Board,
  BoardConfig,
  Card,
  CardBody,
  CardFrontmatter,
  ColumnDef,
  ContextConfig,
  HistoryScope,
} from "../src/model/types";
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
  removeSubtask,
  removeTimestampedLine,
  setDescription,
  setSubtaskDone,
  updateTimestampedLine,
} from "../src/model/card";

/** Same per-context config note name the vault adapter uses (#14). */
const CONTEXT_NOTE = "_context.md";
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
} from "../src/model/history";

interface Entry {
  basename: string;
  fm: CardFrontmatter;
  body: string;
}

let seq = 0;

export class FakeRepo implements CardRepository {
  files = new Map<string, Entry>();
  listeners = new Set<() => void>();
  opened: string[] = [];
  ts = "2026-06-13 12:00";

  constructor(
    public config: BoardConfig,
    initial: Record<string, { fm: CardFrontmatter; body: string }> = {},
    public getHistoryScope: () => HistoryScope = () => "moves",
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
    const childLinks = parseSubtasks(e.body)
      .filter((s) => s.kind === "card" && s.link)
      .map((s) => s.link!);
    return { path, basename: e.basename, frontmatter: e.fm, childLinks, stats: cardStats(e.body) };
  }

  async loadBoard(): Promise<Board> {
    const cards = [...this.files.entries()]
      .filter(([, e]) => e.basename + ".md" !== CONTEXT_NOTE) // `_context.md` is config, not a card
      .map(([p, e]) => this.toCard(p, e));
    return buildBoard(this.config, cards, await this.loadContexts());
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
        out[folder] = { name, color, label, body: e.body, folder };
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

  async applyMove(mutation: {
    path: string;
    setFrontmatter?: Partial<CardFrontmatter>;
    history?: string;
  }) {
    if (mutation.setFrontmatter)
      Object.assign(this.entry(mutation.path).fm, mutation.setFrontmatter);
    if (mutation.history) {
      const e = this.entry(mutation.path);
      e.body = appendHistory(e.body, mutation.history, this.ts);
    }
  }

  async setDescription(path: string, description: string) {
    this.entry(path).body = setDescription(this.entry(path).body, description);
  }
  async addComment(path: string, text: string) {
    this.entry(path).body = appendComment(this.entry(path).body, text, this.ts);
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

  async deleteCard(path: string): Promise<void> {
    this.files.delete(path);
  }

  async renameCard(path: string, newTitle: string): Promise<string> {
    const e = this.entry(path);
    const base = sanitizeFilename(newTitle);
    if (base === e.basename) return path; // unchanged after sanitize
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const prefix = folder ? `${folder}/` : "";
    let dest = `${prefix}${base}.md`;
    let n = 1;
    while (this.files.has(dest) && dest !== path) dest = `${prefix}${base} ${n++}.md`;
    if (dest === path) return path;
    // Move the map entry under its new basename...
    this.files.delete(path);
    this.files.set(dest, { ...e, basename: base });
    // ...and rewrite every inbound `[[OldBasename]]` wikilink so parentage follows (mirrors
    // Obsidian's link-aware fileManager.renameFile, keeping buildBoard's `## Subtasks` graph correct).
    const oldBase = e.basename;
    for (const other of this.files.values()) {
      other.body = rewriteWikilinks(other.body, oldBase, base);
    }
    return dest;
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

  /** test helper: simulate an external change */
  notify() {
    for (const cb of this.listeners) cb();
  }
}

function basename(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

// Mirrors VaultRepository.sanitizeFilename so the fake derives the same basename for a rename.
function sanitizeFilename(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Untitled card"
  );
}

/** Rewrite `[[old]]` / `[[old|alias]]` / `[[old#heading]]` wikilink targets to `new`, by basename. */
function rewriteWikilinks(body: string, oldBase: string, newBase: string): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const [targetAndHash, ...aliasParts] = inner.split("|");
    const [target, hash] = targetAndHash.split("#", 2);
    const t = target.trim();
    const tBase = t.split("/").pop()!.replace(/\.md$/i, "");
    if (tBase !== oldBase) return whole;
    const folder = t.includes("/") ? t.slice(0, t.lastIndexOf("/") + 1) : "";
    const rebuilt = folder + newBase + (hash !== undefined ? "#" + hash : "");
    return `[[${rebuilt}${aliasParts.length ? "|" + aliasParts.join("|") : ""}]]`;
  });
}
