const { builtinModules } = require("node:module");

// Architecture boundaries, adapted to this Obsidian plugin's layers:
//   model    — pure domain + the CardRepository port; imports only itself
//   obsidian — the Vault adapter that implements the port (the only data/transport layer)
//   ui       — React board; reaches neither the adapter, MCP nor the shell, by any path
//   mcp      — the MCP tool surface; imports only itself and the model
// The plugin shell (main.ts, view.tsx) wires the adapter into Obsidian. The root modules
// (settings.ts and the like) sit between the shell and the UI.
// "Only the adapter and the shell may import the obsidian package, or electron, CodeMirror and
// Lezer that the app supplies with it" is enforced twice: in eslint.config.mjs via
// no-restricted-imports, which names the offending line but sees only static imports, and by
// only-adapter-and-shell-reach-the-app below, which also sees `import("obsidian")` types, dynamic
// imports and the whole transitive path.
// test/ is unconstrained by design: tests may import any layer. Only the reverse is forbidden.

// pnpm resolves a package to node_modules/.pnpm/<id>/node_modules/<name>/, so these patterns match
// the last node_modules segment and are not anchored.
/** The UI's rendering stack, which the model and MCP may not use. */
const uiPackages = "node_modules/(react|react-dom|@dnd-kit)/";
/** A test-only devDependency: shipped code parses YAML with Obsidian's parseYaml. */
const yamlPackage = "node_modules/yaml/";

/** What Obsidian supplies at runtime (esbuild.config.mjs marks them external). Uninstalled, each
 *  stays a bare specifier; installed (as a devDependency for its types, say), it resolves into
 *  node_modules. Both forms must match, or the rule goes blind the day one is installed. */
const appModules =
  "(^|node_modules/)(obsidian|electron)(/|$)|(^|node_modules/)(@codemirror|@lezer)/";

/** Node's builtin modules, with or without the `node:` prefix. A few (node:sqlite, node:test)
 *  exist only prefixed; allowing their bare name too costs nothing, since the rule that uses this
 *  also requires the dependency to be a core module. None is ever resolved to a file. */
const nodeBuiltins = `^(node:)?(${builtinModules.map((m) => m.replace(/^node:/, "")).join("|")})$`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies make modules impossible to load or reason about in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "model-is-pure-domain",
      severity: "error",
      comment:
        "src/model is the domain core + ports. Within src it may import only src/model: not the UI, the adapter, MCP, the plugin shell or any root module.",
      from: { path: "^src/model/" },
      to: { path: "^src/", pathNot: "^src/model/" },
    },
    {
      name: "ui-never-reaches-adapter-mcp-or-shell",
      severity: "error",
      comment:
        "src/ui depends on the model and the CardRepository port (in src/model). No chain of imports from it may end in the Obsidian adapter (src/obsidian), the MCP layer (src/mcp) or the plugin shell (main.ts, view.tsx).",
      from: { path: "^src/ui/" },
      to: { path: "^src/(obsidian|mcp)/|^src/(main\\.ts|view\\.tsx)$", reachable: true },
    },
    {
      name: "only-adapter-and-shell-reach-the-app",
      severity: "error",
      comment:
        "Outside src/obsidian and the shell, no chain of imports may end at the obsidian package or at electron, @codemirror/* or @lezer/*, which the app supplies at runtime: type-only, inline import() types and dynamic imports included.",
      from: { path: "^src/", pathNot: "^src/obsidian/|^src/(main\\.ts|view\\.tsx)$" },
      to: { path: appModules, reachable: true },
    },
    {
      name: "node-builtins-stay-in-adapter-and-shell",
      severity: "error",
      comment:
        "Node's modules do not exist on mobile. The adapter loads the few it needs lazily behind a desktop check; nothing else in src may import them, dynamically or type-only included. The UI, model and MCP reach no module outside src but these, so a direct ban is a transitive one for them.",
      from: { path: "^src/", pathNot: "^src/obsidian/|^src/(main\\.ts|view\\.tsx)$" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "mcp-is-a-port-consumer",
      severity: "error",
      comment:
        "src/mcp is the agent-facing tool surface. Within src it may import only src/mcp and src/model, where the CardRepository port lives: never the UI, the Obsidian adapter, the plugin shell or a root module. The adapter that implements its BoardHost lives in src/obsidian and imports it, not the other way round.",
      from: { path: "^src/mcp/" },
      to: { path: "^src/", pathNot: "^src/(mcp|model)/" },
    },
    {
      name: "model-and-mcp-stay-off-the-ui-stack",
      severity: "error",
      comment:
        "src/model and src/mcp run without a DOM: they may not import react, react-dom or @dnd-kit/*. zod stays allowed.",
      from: { path: "^src/(model|mcp)/" },
      to: { path: uiPackages },
    },
    {
      name: "src-never-imports-yaml",
      severity: "error",
      comment:
        "yaml is a devDependency the tests use to stand in for Obsidian's parser. Shipped code parses YAML with Obsidian's parseYaml, through the adapter.",
      from: { path: "^src/" },
      to: { path: yamlPackage },
    },
    {
      name: "src-never-imports-test",
      severity: "error",
      comment: "Shipped code must not depend on test helpers or fakes.",
      from: { path: "^src/" },
      to: { path: "^test/" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "Files imported by nothing (except the plugin entry) are usually dead code — confirm with knip.",
      from: { orphan: true, pathNot: ["^src/main\\.ts$", "\\.d\\.ts$"] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    // Outside src, only what a rule needs an end to find is let in: the app's modules, Node's
    // builtins, test/, yaml and the packages the model and MCP may not use. Narrowing this makes the
    // rules that point at them pass vacuously.
    includeOnly: ["^src/", "^test/", appModules, uiPackages, yamlPackage, nodeBuiltins],
  },
};
