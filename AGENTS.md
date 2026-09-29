# AGENTS.md - Folia Kanban

> !`[ -f /.dockerenv ] || [ -f /run/.containerenv ] && echo "You are running inside a container" || echo "You are running directly on the host OS (not in a container)"]`
> !`[ "$DEVCONTAINER" = "true" ] && echo "This is the devcontainer" || echo "This is NOT the devcontainer"`

## Basic Rule

1. Keep this file thin: only what a fresh LLM session **can't** rediscover from the other files. A few words per entry.
2. Update [`examples/`](./examples/) whenever a change affects the user experience.
3. Do not invent architecture. Follow the project's guards.
4. Before building something that looks obviously missing, read [`docs/decisions.md`](./docs/decisions.md) — it records what was deliberately left out, why, and what would have to change.

## Way of Working

1. Before changing code: `pnpm doctor:check`,
2. While changing code (TypeScript only): put files in the documented folders; validate vault input with the Zod schemas;
3. Respect the linters and guards. Don't just disable or ignore the violations. Fix them for real. Only ignore a violation if it's really technically impossible to fix or if the fix would not be worth.
4. No task is complete until `pnpm verify` passes (`pnpm verify:ui` for UI changes). A UI/UX change is done only after you have tested it in the live Obsidian (see below) and attached screenshots as proof of work in the chat with your human, never on GitHub.
5. Track exceptions with a waiver under `tracking/waivers/` and surface it in the closeout report.
6. Closeout: run `pnpm verify`, report each check's result, and explain any "not run".
7. Committing: a change is breaking when a user would need to be told about it before upgrading. If the software itself tells them what to do at the moment it matters, it is a `fix`.

### Driving the Obsidian UI

1. Test in **your own** Obsidian instance on the host, never your human's (it is on `127.0.0.1:9222`, and other agents run theirs in parallel). You may start and stop your own instance on the host without asking. Launch `/opt/Obsidian/obsidian` from the host (inside a container, through the host tmux bridge) with:
   - `--user-data-dir=<worktree>/tmp/obsidian-profile`. The single-instance lock is per profile, so without it the launch hands off to your human's Obsidian.
   - `--remote-debugging-port=<port>`, a port nobody else uses (`ss -ltn` on the host). One port can't serve two instances.
   - an `obsidian.json` seeded in that profile, so it opens your worktree's `examples/` vault directly: `{"vaults":{"<16 hex chars>":{"path":"<worktree>/examples","ts":<epoch ms>,"open":true}}}`. Keep the id stable, or you'll get the "Trust author" prompt again.

   Start it with `nohup … & echo $!` so you have its PID, and stop only that PID. Never `pkill` Obsidian, and never open `obsidian://` URLs (`shell.openExternal` included): both reach your human's instance. A fresh profile runs the bundled 1.12.x first and downloads the current version into itself, so restart it once. The window title shows the real version; the User-Agent doesn't. Every instance is a visible window on your human's desktop, so stop it when you are done.
2. Inside a container, forward the port on the host with `socat TCP-LISTEN:<port>,bind=HOST_GATEWAY,fork,reuseaddr TCP:127.0.0.1:<port>`. `HOST_GATEWAY` is `ip route | awk '/^default/{print $3; exit}'`, run **inside the container**. Confirm with `curl -s http://HOST_GATEWAY:<port>/json/version`. The [`chrome-devtools-obsidian`](./.mcp.json) MCP server (not the global chrome-devtools plugin, which spawns its own headless Chrome) reads its URL from `OBSIDIAN_DEBUG_URL` at session start. A running session can't retarget it, so drive your instance with Playwright's `chromium.connectOverCDP('http://HOST_GATEWAY:<port>')` instead.
   - 2.1. CDP `Page.captureScreenshot` hangs on Obsidian. Screenshot from inside the page instead: `(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG()`.
   - 2.2. Playwright's focus emulation, plus Wayland refusing `BrowserWindow.focus()`, means real window blur can't be driven.
   - 2.3. Menu actions can rewrite tracked notes in `examples/`. Run `git checkout -- examples` after testing.
   - 2.4. An unfocused window stops painting, so `capturePage()` returns its last painted frame (even the loading splash). Resize the window by 1px and back (`getCurrentWindow().setSize`), wait a second, then capture.
3. Use Obsidian only in your worktree's `examples/` vault. Confirm with `app.vault.getName()`. Several open board tabs put several copies of the board in the DOM, so scope queries to `app.workspace.activeLeaf.view.containerEl`.
4. Watch and rebuild the plugin into the `examples/` vault on every change: `pnpm run dev:examplesVault` (watch mode — keeps running).
   - 4.1. A build does not reach the running app. Obsidian keeps the stylesheet it loaded, so reload the plugin — `await app.plugins.disablePlugin('folia-kanban')` then `enablePlugin` — and confirm the live sheet's byte length equals the built `styles.css` before trusting any reading of it. Skipping this reports missing variables as missing features.
5. `take_snapshot` hides the file tree — pass `verbose: true` for folder/file nodes.
6. Breadcrumb and explorer both show the folder name, but the breadcrumb only selects — click the explorer node to open.
7. Open a board yourself (a board = note with `folia-board: true`). Don't rely on the `folia-kanban:folia-open-kanban-board` command: Obsidian 1.12 defers background leaves, so an off-screen board stays empty until focused. Via `evaluate_script`: `leaf.setViewState({ type: 'folia-kanban-view', state: { file: '<vault path>' }, active: true })`, then `setActiveLeaf(leaf, { focus: true })`, `revealLeaf(leaf)`, wait a tick, `take_screenshot`. (`boardPath` is still read, for layouts saved before the view became a `FileView`, but `file` is the key now.) A board note that becomes active in a Markdown tab is swapped to the board a frame or two later (`file-open`/`active-leaf-change`), so wait before reading the view type.
8. To keep a board note as Markdown from a script, call `app.plugins.plugins['folia-kanban'].showMarkdownIn(leaf, '<vault path>')`: it records the choice the tab button makes, which is what stops the swap above.
9. Obsidian 1.13 opens Settings in its own Electron window, so it is a separate CDP page: the vault page is the `app://obsidian.md/index.html` one and Settings is an `about:blank` one. Find it with `list_pages` (the order is not fixed) and `select_page` it; `app.setting.open()` from the vault page only refocuses that window, it does not bring the settings DOM into that page.
