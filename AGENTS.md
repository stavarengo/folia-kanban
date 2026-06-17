# AGENTS.md - Folia Kanban

> !`[ -f /.dockerenv ] || [ -f /run/.containerenv ] && echo "You are running inside a container" || echo "You are running directly on the host OS (not in a container)"]`
> !`[ "$DEVCONTAINER" = "true" ] && echo "This is the devcontainer" || echo "This is NOT the devcontainer"`

## Basic Rule

1. Keep this file thin: only what a fresh LLM session **can't** rediscover from the other files. A few words per entry.
2. Update [`examples/`](./examples/) whenever a change affects the user experience.

### Driving the Obsidian UI via the Chrome DevTools MCP server

1. Use the [`chrome-devtools-obsidian`](./.mcp.json) MCP server against the real Obsidian on the **host** — not the global chrome-devtools plugin (it spawns its own headless Chrome).
2. Inside a container, testing needs the host bridge. Ask your human to run it (replace CONTAINER_IP); if it's missing, say so — you can't test without it:
   ```bash title="Run on the host, not the container"
   obsidian --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0
   socat TCP-LISTEN:9222,bind=CONTAINER_IP,fork,reuseaddr TCP:127.0.0.1:9222
   ```
3. Use Obsidian only in the `examples/` vault — never touch others unless asked. Confirm it's open with `app.vault.getName()`.
   3.1. If not our `examples/` vault and this is the devcontainer, then use the `$HOST_REPO_ROOT_REAL_PATH` environment variable and open it via `evaluate_script` — `require('electron').shell.openExternal('obsidian://open?path=' + encodeURIComponent('$HOST_REPO_ROOT_REAL_PATH/examples'))` — then `list_pages` → `select_page`.
   3.2. If the host path is unknown or this is not the devcontainer, ask your human to open it.
   3.3. If this is the host system, you can easily open the vault using instructions from 3.1. using the current repo root path instead of `$HOST_REPO_ROOT_REAL_PATH`.
4. Update the `examples/` vault plugin: `pnpm run build:updateExamplesVault`.
5. `take_snapshot` hides the file tree — pass `verbose: true` for folder/file nodes.
6. Breadcrumb and explorer both show the folder name, but the breadcrumb only selects — click the explorer node to open.
7. Open a board yourself (a board = note with `folia-board: true`). Don't rely on the `folia-kanban:open-kanban-board` command: Obsidian 1.12 defers background leaves, so an off-screen board stays empty until focused. Via `evaluate_script`: `leaf.setViewState({ type: 'folia-kanban-view', state: { boardPath: '<vault path>' }, active: true })`, then `setActiveLeaf(leaf, { focus: true })`, `revealLeaf(leaf)`, wait a tick, `take_screenshot`.
