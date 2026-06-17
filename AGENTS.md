# AGENTS.md - Folia Kanban

> !`[ -f /.dockerenv ] || [ -f /run/.containerenv ] && echo "You are running inside a container" || echo "You are running directly on the host OS (not in a container)"]`

## Basic Rule

1. Keep this file small and thin. Only write here what a fresh LLM session **can't** rediscover on its own by reading the other files in this project. Keep each entry to a few words.
2. Always update the [`examples/`](./examples/) after introducing or changing anything that affect the user experience.

### Driving the Obsidian UI via the Chrome DevTools MCP server

2. Use the [`chrome-devtools-obsidian`](./.mcp.json) MCP server to debug, inspect UI, test behaviour, and whatnot directly in a real Obsidian instance running on the **host** OS. Do not use the global chrome-devtools plugin, which launches its own headless Chrome.
3. When running inside a container, ask your human to run the command below to set up the host bridge (Obsidian + socat) - replace the CONTAINER_IP with the actual container IP:
   ```bash title="This needs to be run on the host, not in the container"
   obsidian --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 
   socat TCP-LISTEN:9222,bind=CONTAINER_IP,fork,reuseaddr TCP:127.0.0.1:9222
   ```
4. Once you are connected to the Obsidian instance, check if the current open vault is pointing to `examples/`. If not, ask your human to open it (you can't open it yourself because you don't know the real path of the vault on the host filesystem).
5. Only interact with your own `examples/` vault. Do not interact with other vaults unless explicitly requested by the user.
6. When running inside a container, always inform your human when you could not test due to a missing host bridge (Obsidian + socat) and ask them to start/restart it. 
7. The default `take_snapshot` omits the file-explorer tree — use `verbose: true` to get folder/file nodes.
8. The header breadcrumb and the explorer both expose the folder name; clicking the breadcrumb only selects — click the explorer node to expand/open.
