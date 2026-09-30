import type { App } from "obsidian";
import { TFile, TFolder, Vault, parseFrontMatterTags } from "obsidian";
import type { Card, CardFrontmatter, ContextConfig, TitleMode } from "../model/types";
import { cardStats, parseSubtasks, splitFrontmatter } from "../model/card";
import { resolveTitle } from "../model/cardTitle";
import { ContextFrontmatterSchema, DataCorruptionError, decode } from "../model/schemas";
import { parseFrontmatter } from "./frontmatter";

/** The per-context config note (#14). Lives inside a context subfolder; read-only for the plugin. */
export const CONTEXT_NOTE = "_context.md";

/** Every note under the card folder that is a card: not the board note, not a context note. */
export function cardFilesIn(folder: TFolder, boardPath: string): TFile[] {
  const files: TFile[] = [];
  Vault.recurseChildren(folder, (child) => {
    if (
      child instanceof TFile &&
      child.extension === "md" &&
      child.path !== boardPath &&
      child.name !== CONTEXT_NOTE
    )
      files.push(child);
  });
  return files;
}

export async function readCard(app: App, f: TFile, titleMode: TitleMode): Promise<Card> {
  let fm = frontmatterOf(app, f);
  const text = await app.vault.cachedRead(f);
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
  const { title, source } = resolveTitle(f.basename, fm, text, titleMode);
  const bodyTags = bodyTagsOf(app, f);
  return {
    path: f.path,
    basename: f.basename,
    title,
    titleSource: source,
    frontmatter: fm,
    childLinks,
    subItems,
    stats: cardStats(text),
    ...(bodyTags.length > 0 ? { bodyTags } : {}),
    // Always set, even empty: an absent field makes the model read `tags` as written.
    frontmatterTags: (parseFrontMatterTags(fm) ?? []).map((t) => t.replace(/^#/, "")),
  };
}

function frontmatterOf(app: App, file: TFile): CardFrontmatter {
  const cached = app.metadataCache.getFileCache(file)?.frontmatter;
  return cached ?? {};
}

/**
 * The tags Obsidian read out of a note's body, `#` stripped, in the order they appear.
 *
 * Read from the metadata cache and nowhere else, deliberately: which `#word` in a body is a tag
 * is Obsidian's own lexer's answer (code fences, inline code, the character set, escapes), and a
 * regex here would be a second, quietly different answer — which is the very drift this fix
 * exists to close. So a note with no cache entry yet contributes no body tags, unlike its
 * frontmatter (which `readCard` re-parses from the text when the cache has nothing).
 */
function bodyTagsOf(app: App, file: TFile): string[] {
  const tags = app.metadataCache.getFileCache(file)?.tags ?? [];
  const out: string[] = [];
  for (const t of tags) {
    const tag = t.tag.replace(/^#/, "");
    if (tag !== "") out.push(tag);
  }
  return out;
}

/**
 * Each immediate subfolder of the card folder is a context. An optional `_context.md` inside it
 * supplies the display name / color / label / body; a subfolder without the note still counts as a
 * context (name = folder), so its cards can be filtered by `context:` even before it's configured.
 */
export async function readContexts(
  app: App,
  folderPath: string,
): Promise<Record<string, ContextConfig>> {
  const root = app.vault.getFolderByPath(folderPath);
  const out: Record<string, ContextConfig> = {};
  if (root === null) return out;
  for (const child of root.children) {
    if (!(child instanceof TFolder)) continue;
    out[child.name] = await readContext(app, child);
  }
  return out;
}

async function readContext(app: App, child: TFolder): Promise<ContextConfig> {
  const folder = child.name;
  const note = child.children.find((f) => f instanceof TFile && f.name === CONTEXT_NOTE);
  if (!(note instanceof TFile)) return { name: folder, body: "", folder };
  const text = await app.vault.cachedRead(note);
  const fm = decode(
    ContextFrontmatterSchema,
    parseFrontmatter(text),
    `context config (${note.path})`,
  );
  const cn = fm["context-name"];
  const name = cn !== undefined && cn.trim() ? cn : folder;
  const color = fm["color"] !== undefined && fm["color"].trim() ? fm["color"] : undefined;
  const label = fm["label"] !== undefined && fm["label"].trim() ? fm["label"] : undefined;
  return {
    name,
    ...(color !== undefined ? { color } : {}),
    ...(label !== undefined ? { label } : {}),
    body: splitFrontmatter(text).body,
    folder,
  };
}
