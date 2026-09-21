// The theme is many files but one stylesheet, and the guards that read it have to read it the way
// the browser does: in the order src/theme/index.css imports it. Source order is load-bearing here
// (src/theme/base.css says why), so a guard that globbed the directory instead would silently
// judge a different stylesheet than the one Obsidian loads.

import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export const THEME_DIR = "src/theme";
export const THEME_ENTRY = join(THEME_DIR, "index.css");

/** The files `index.css` imports, in order, as repo-relative paths. */
export async function themeFiles(entry = THEME_ENTRY) {
  const css = await readFile(entry, "utf8");
  const base = dirname(entry);
  return [...css.matchAll(/@import\s+"([^"]+)"\s*;/g)].map((m) => join(base, m[1]));
}

/**
 * The whole theme as one string, plus `locate(line)` — a 1-based line in that string mapped back to
 * the `file:line` it came from, so a guard can point at the file a reader has to open.
 */
export async function readThemeBundle(entry = THEME_ENTRY) {
  const files = await themeFiles(entry);
  const parts = await Promise.all(files.map((f) => readFile(f, "utf8")));
  const index = [];
  const chunks = [];
  for (let i = 0; i < files.length; i++) {
    const lines = parts[i].split("\n");
    // A file ending in a newline splits to a trailing "" that is not a line of its own; keeping it
    // would push every later file's reported line number one further off than the last.
    if (lines.at(-1) === "") lines.pop();
    for (let n = 0; n < lines.length; n++) index.push([files[i], n + 1]);
    chunks.push(lines.join("\n") + "\n");
  }
  const css = chunks.join("");
  return {
    css,
    files,
    locate(line) {
      const hit = index[line - 1];
      return hit ? `${relative(".", hit[0])}:${hit[1]}` : entry;
    },
  };
}
