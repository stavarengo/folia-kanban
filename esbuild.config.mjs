import esbuild from "esbuild";
import process from "process";
import { copyFile, mkdir } from "node:fs/promises";
import { builtinModules as builtins } from "node:module";

const prod = process.argv[2] === "production";

const outDir = process.env.OUT_DIR || "dist";
// src is where the file lives in the repo; dest is the name Obsidian expects in the plugin folder.
const assets = [
  { src: "manifest.json", dest: "manifest.json" },
  { src: "src/styles.css", dest: "styles.css" },
];

const copyPluginAssets = {
  name: "copy-plugin-assets",
  setup(build) {
    build.onEnd(async () => {
      await mkdir(outDir, { recursive: true });
      await Promise.all(assets.map(({ src, dest }) => copyFile(src, `${outDir}/${dest}`)));
    });
  },
};

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
  // Node builtins are loaded with a dynamic import so they never run on mobile (see
  // mcpHttpServer.ts). Left native, `import("http")` reaches Electron's renderer, which cannot
  // resolve a builtin that way; lowering it makes esbuild emit `require("http")` instead.
  supported: { "dynamic-import": false },
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: `${outDir}/main.js`,
  minify: prod,
  plugins: [copyPluginAssets],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
