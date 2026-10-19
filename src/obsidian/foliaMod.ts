// The Folia Mod: the Claude Code plugin folder a launched session loads with `--plugin-dir`. A
// release ships only `main.js`, `styles.css` and `manifest.json`, so the mod travels inside
// `main.js` and is written into the plugin's folder before each launch (see docs/decisions.md,
// "The Folia Mod is written at launch, not shipped as files").

import type { DataAdapter } from "obsidian";
import statusLine from "./folia-mod/status-line.sh?raw";
import stopHook from "./folia-mod/stop-hook.sh?raw";

/** The mod's folder, inside the plugin's own. */
export const FOLIA_MOD_FOLDER = "folia-mod";

const PLUGIN_NAME = "folia-mod";
const SERVER_NAME = "folia-kanban";

/** A `${NAME}` reference, left for Claude Code (or the shell) to expand, never for TypeScript. */
function ref(name: string): string {
  return "${" + name + "}";
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Every file of the mod, by its path inside the mod's folder. */
export const FOLIA_MOD_FILES: Readonly<Record<string, string>> = {
  ".claude-plugin/plugin.json": json({
    name: PLUGIN_NAME,
    description:
      "Folia Kanban's side of a session started for a card: the board's MCP server, and a stop once the card leaves its agent column.",
  }),
  // The URL and the token come from the session's environment, so the token is never on disk.
  ".mcp.json": json({
    mcpServers: {
      [SERVER_NAME]: {
        type: "http",
        url: ref("FOLIA_MCP_URL"),
        headers: { Authorization: `Bearer ${ref("FOLIA_MCP_TOKEN")}` },
      },
    },
  }),
  "hooks/hooks.json": json({
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { type: "command", command: `sh "${ref("CLAUDE_PLUGIN_ROOT")}/scripts/stop-hook.sh"` },
          ],
        },
      ],
    },
  }),
  // What a plugin cannot set for itself, passed with `--settings`. `$FOLIA_MOD_DIR` is expanded
  // by the shell the status line runs in, so no path has to be written into JSON.
  "session.json": json({
    statusLine: { type: "command", command: 'sh "$FOLIA_MOD_DIR/scripts/status-line.sh"' },
    permissions: { allow: [`mcp__plugin_${PLUGIN_NAME}_${SERVER_NAME}`] },
  }),
  "scripts/stop-hook.sh": stopHook,
  "scripts/status-line.sh": statusLine,
};

/** What writing the mod needs from Obsidian's adapter. */
export type ModStore = Pick<DataAdapter, "exists" | "mkdir" | "read" | "write">;

/**
 * Write the mod into `dir`, a vault path, creating folders as needed and rewriting a file only
 * when what is there differs, so a launch costs a few reads once the mod is in place.
 */
export async function writeFoliaMod(store: ModStore, dir: string): Promise<void> {
  for (const [path, content] of Object.entries(FOLIA_MOD_FILES)) {
    const target = `${dir}/${path}`;
    await ensureFolder(store, target.slice(0, target.lastIndexOf("/")));
    if ((await store.exists(target)) && (await store.read(target)) === content) continue;
    await store.write(target, content);
  }
}

async function ensureFolder(store: ModStore, folder: string): Promise<void> {
  if (await store.exists(folder)) return;
  const cut = folder.lastIndexOf("/");
  if (cut > 0) await ensureFolder(store, folder.slice(0, cut));
  await store.mkdir(folder);
}
