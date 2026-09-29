/** @type {import('dependency-cruiser').IConfiguration} */
// Architecture boundaries, adapted to this Obsidian plugin's layers:
//   model    — pure domain + the CardRepository port; imports only itself
//   obsidian — the Vault adapter that implements the port (the only data/transport layer)
//   ui       — React board; reaches neither the adapter, MCP nor the shell, by any path
//   mcp      — the MCP tool surface; imports only itself and the model
// The plugin shell (main.ts, view.tsx) wires the adapter into Obsidian. The root modules
// (settings.ts and the like) sit between the shell and the UI.
// The "only the adapter/shell may import the 'obsidian' package" rule is enforced
// in eslint.config.mjs via no-restricted-imports (precise specifier match), which sees
// direct imports only; ui-never-reaches-obsidian below covers the transitive ones for src/ui.
// test/ is unconstrained by design: tests may import any layer. Only the reverse is forbidden.

/** The npm packages the model and MCP layers may not use: the UI's rendering stack, and yaml.
 *  pnpm resolves them to node_modules/.pnpm/<id>/node_modules/<name>/, so the pattern matches the
 *  last node_modules segment and is not anchored. */
const uiAndYamlPackages = "node_modules/(react|react-dom|@dnd-kit|yaml)/";

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
      name: "ui-never-reaches-obsidian",
      severity: "error",
      comment:
        "No chain of imports from src/ui may end at the obsidian package, type-only ones included. ESLint's import ban sees only direct imports; this sees the whole path.",
      from: { path: "^src/ui/" },
      to: { path: "^obsidian$", reachable: true },
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
        "src/model and src/mcp run without a DOM and without a Markdown parser of their own: they may not import react, react-dom, @dnd-kit/* or yaml. zod stays allowed.",
      from: { path: "^src/(model|mcp)/" },
      to: { path: uiAndYamlPackages },
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
    // Outside src, only what a rule needs an end to find is let in: the obsidian package for
    // ui-never-reaches-obsidian, test/ for src-never-imports-test and the banned packages for
    // model-and-mcp-stay-off-the-ui-stack. Narrowing this makes those rules pass vacuously.
    includeOnly: ["^src/", "^test/", "^obsidian$", uiAndYamlPackages],
  },
};
