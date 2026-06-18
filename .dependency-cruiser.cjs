/** @type {import('dependency-cruiser').IConfiguration} */
// Architecture boundaries (blueprint §7/§8/§15), adapted to this Obsidian plugin's
// three layers:
//   model    — pure domain + the CardRepository port; depends on nothing app-specific
//   obsidian — the Vault adapter that implements the port (the only data/transport layer)
//   ui       — React board; depends on model + the port, never the adapter
// The plugin shell (main.ts, view.tsx) wires the adapter into Obsidian.
// The "only the adapter/shell may import the 'obsidian' package" rule is enforced
// in eslint.config.js via no-restricted-imports (precise specifier match).
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
        "src/model is the domain core + ports. It must not depend on the UI, the Obsidian adapter, or the plugin shell.",
      from: { path: "^src/model/" },
      to: { path: "^src/ui/|^src/obsidian/|^src/(main|view|settings)\\.(ts|tsx)$" },
    },
    {
      name: "ui-through-port-not-adapter",
      severity: "error",
      comment:
        "src/ui depends on the model and the CardRepository port (in src/model). It must never import the Obsidian adapter (src/obsidian) directly.",
      from: { path: "^src/ui/" },
      to: { path: "^src/obsidian/" },
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
    includeOnly: "^src/",
  },
};
