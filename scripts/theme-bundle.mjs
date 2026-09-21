// The theme is many files but one stylesheet, and the guards that read it have to read it the way
// the browser does: in the order src/theme/index.css imports it. Source order is load-bearing here
// (src/theme/base.css says why), so a guard that globbed the directory instead would silently
// judge a different stylesheet than the one Obsidian loads.

import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import postcss from "postcss";

export const THEME_DIR = "src/theme";
export const THEME_ENTRY = join(THEME_DIR, "index.css");

/** The one import shape the theme uses: a relative path to a sibling .css file, double-quoted. */
const IMPORT = /^"(\.\/[A-Za-z0-9._-]+\.css)"$/;

/**
 * The files `index.css` imports, in order, as repo-relative paths.
 *
 * Anything the entry contains that is not one of those imports is an error rather than something
 * skipped. esbuild understands far more than this reader does — `@import url(…)`, single quotes,
 * media conditions, a rule written straight into the entry — and every one of those would ship in
 * the bundle while staying invisible to the guards, which is the one failure this file must not
 * have.
 */
export async function themeFiles(entry = THEME_ENTRY) {
  const css = await readFile(entry, "utf8");
  const base = dirname(entry);
  const files = [];
  const problems = [];
  for (const node of postcss.parse(css, { from: entry }).nodes) {
    if (node.type === "comment") continue;
    if (node.type === "atrule" && node.name === "import") {
      const match = IMPORT.exec(node.params.trim());
      if (match) {
        files.push(join(base, match[1]));
        continue;
      }
      problems.push(
        `${entry}:${node.source.start.line}: \`@import ${node.params}\` is not a form this reader understands, so the guards would never see that file while esbuild still bundles it. Write it as \`@import "./name.css";\`.`,
      );
      continue;
    }
    problems.push(
      `${entry}:${node.source.start.line}: ${entry} is the import list and nothing else, but this is ${node.type === "rule" ? `a rule (\`${node.selector}\`)` : `\`@${node.name}\``}. Move it into the section file it belongs to.`,
    );
  }
  if (problems.length) {
    const error = new Error(problems.join("\n"));
    error.problems = problems;
    throw error;
  }
  return files;
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
