import esbuild from "esbuild";
import process from "process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { builtinModules as builtins } from "node:module";
import { resolve } from "node:path";

const prod = process.argv[2] === "production";

const outDir = process.env.OUT_DIR || "dist";
// src is where the file lives in the repo; dest is the name Obsidian expects in the plugin folder.
const assets = [{ src: "manifest.json", dest: "manifest.json" }];

const copyPluginAssets = {
  name: "copy-plugin-assets",
  setup(build) {
    build.onEnd(async () => {
      await mkdir(outDir, { recursive: true });
      await Promise.all(assets.map(({ src, dest }) => copyFile(src, `${outDir}/${dest}`)));
    });
  },
};

// `import text from "./file?raw"` is the file's text, as Vite reads it in the tests. The Folia Mod's
// scripts reach the vault this way, inside main.js (see src/obsidian/foliaMod.ts).
const rawText = {
  name: "raw-text",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
      namespace: "raw-text",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
      watchFiles: [args.path],
    }));
  },
};

// The stylesheet is its own bundle: esbuild follows src/theme/index.css's @import list and emits
// one file. It gets no `target`, so the CSS is emitted as authored — a `target` would make esbuild
// lower modern syntax the plugin relies on (`color-mix()`) for browsers Obsidian never runs on.
const cssContext = await esbuild.context({
  entryPoints: ["src/theme/index.css"],
  bundle: true,
  logLevel: "info",
  outfile: `${outDir}/styles.css`,
});

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  jsx: "automatic",
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: `${outDir}/main.js`,
  minify: prod,
  plugins: [rawText, copyPluginAssets],
});

if (prod) {
  await Promise.all([context.rebuild(), cssContext.rebuild()]);
  process.exit(0);
} else {
  await Promise.all([context.watch(), cssContext.watch()]);
}
