# Agent access (MCP)

Folia Kanban can host a [Model Context Protocol](https://modelcontextprotocol.io) server inside the plugin, so an AI agent drives your boards the way you drive them: it creates cards, moves them, sets fields, comments and ticks subtasks — and every one of those goes through the board's own rules. A card an agent touches gets the same history lines, the same signed comments and the same fractional ordering it would have got from you dragging it. That is the whole point: an agent editing the card files directly does none of that, because it has no idea any of it is owed.

It is off until you turn it on, it listens on `127.0.0.1` only, and every request must carry a bearer token this vault generated.

## Turning it on

**Settings → Folia Kanban**:

| Setting | What it is |
| --- | --- |
| **Agent access (MCP) — enable** | Off by default. Switching it on generates the token (once, kept afterwards) and starts the server. Desktop only: on mobile these three rows are not shown at all, because the plugin has no way to listen for connections there. |
| **Agent access (MCP) — port** | `27125` by default; any port from 1024 to 65535. Change it if something else already holds it. |
| **Agent access (MCP) — token** | A **Copy token** button. The token is a password for every board in this vault — paste it into your client's configuration and nowhere else. |

If the port is already taken, the plugin says so in a notice naming the port and the reason. The toggle stays on — it is what you asked for, and the fix is usually a different port rather than giving up — but nothing is listening until you change it, and the plugin will not keep retrying a bind it already knows fails.

There is one server per vault. Every tool addresses a board by the vault path of its board note, so several boards in one vault need no extra setup.

## Connecting Claude Code

With the server on and the token copied:

```sh
claude mcp add --transport http folia-kanban http://127.0.0.1:27125/mcp \
  --header "Authorization: Bearer PASTE_YOUR_TOKEN_HERE"
```

Any other MCP client works the same way: **Streamable HTTP**, endpoint `http://127.0.0.1:<port>/mcp`, header `Authorization: Bearer <token>`. The server answers `POST` only — it never opens a stream of its own, so a client that also tries `GET` gets a `405` and carries on.

Sanity check from a terminal:

```sh
curl -s -X POST http://127.0.0.1:27125/mcp \
  -H "Authorization: Bearer PASTE_YOUR_TOKEN_HERE" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## The tools

Every tool takes `board`, the vault path of the board note (`Work/Board.md`), except `list_boards`. Tools that name a card take `card`, which is the card's vault path as `get_board` reports it; a card title or file name is accepted too, and is refused rather than guessed when two cards on the board answer to it.

| Tool | Reads or writes | What it does |
| --- | --- | --- |
| `list_boards` | reads | Every note in the vault carrying `folia-board: true`. Start here. |
| `get_board` | reads | A board's columns and the cards in each, in the order the board shows them. A card nested under another one is in no column of its own, so it is listed under its parent's `children`. |
| `get_card` | reads | One card in full: column, frontmatter, description, subtasks, comments, history, relationships. |
| `create_card` | writes | Adds a card to a column, written into the board's card folder exactly as the add-card button writes it. Optional `description`, `priority`, `due`. |
| `move_card` | writes | Moves a card to a `column`, optionally to a `position` in it (`0` is the top; omit to append). Records the move in the card's history and keeps a parent's checklist box in step, the same way a drag does. A checklist-line card takes no `position`: its order comes from where the line sits in its parent's list. The reply says which column the card landed in, and its `position` only when it has a tile of its own — a card drawn inside its parent is ordered by that parent, not by a slot. |
| `update_card` | writes | Changes `title`, `description`, `priority`, `due`, or any other frontmatter key through `properties`. `null` clears a value; `""` sets an empty one. `due` is `YYYY-MM-DD` and is refused in any other shape, rather than written as prose the board cannot read. |
| `add_comment` | writes | Appends a comment to `## Comments`, timestamped and signed with the **Your name** setting. |
| `add_subtask` | writes | Appends an unchecked line to `## Subtasks`. |
| `set_subtask_done` | writes | Ticks or unticks one subtask by its `index`, as `get_card` reports it. A line claiming a column of its own is kept in step with its checkbox. |

`update_card` refuses `status`, `order`, `priority`, `due`, `title` and `folia-board` inside `properties`, and says which tool or field owns each instead — so an agent cannot set a column by hand and skip the history line that move is owed, or retitle a card in the frontmatter while the file and every link to it keep the old name.

`update_card` also needs at least one field to change. That rule cannot be expressed in JSON Schema, so a client sees an all-optional object and meets the requirement as a tool error on the call.

A `priority` the board has not seen before is accepted and added to the board's vocabulary, exactly as typing a new one into a card's details does. The board's scale is yours, not a fixed list — which also means an agent inventing one leaves it there for you to prune by hand.

A failure a caller can fix — an unknown board, an ambiguous card, a column that does not exist — comes back as a tool error with the text explaining it, so the model can correct itself. Only a malformed request is a protocol error.

### How much history a write records

The **History — what to record** setting applies to agent writes exactly as it applies to yours. On `all` (the default) every field edit, comment and subtask change writes its line; on `moves`, only moves do — for an agent as much as for you. That is the parity: not "agents always write history", but "agents write whatever you would have written".

## The contract

The tool names and their argument schemas are a public contract: your agent is configured against them, and a rename breaks it silently, in your vault, at run time. They are frozen in a snapshot (`test/__snapshots__/mcpContract.test.ts.snap`) that `pnpm contracts:check` verifies, so changing the surface has to be deliberate.

The server speaks MCP revision `2025-06-18`, and the small half of it a board needs: `initialize`, `ping`, `tools/list`, `tools/call`. No resources, no prompts, no server-initiated messages.

Every write tool is published with MCP's `destructiveHint`, so a client that asks before running destructive tools knows which these are: all six that write. The three readers carry `readOnlyHint`.

Calls are answered one at a time. Every write reads the board, works out its change against what it read, and writes it back, so two moves into the same column running together would hand both cards the same slot. A board call is milliseconds of local file work, so the queue costs nothing worth having.

## What it does not protect you from

Nothing stops an agent from editing your card files directly — Obsidian gives a plugin no lock on the vault, and a plugin cannot restrict what other software on your computer does with your files. This server is how an agent *can* do the right thing; keeping it to that route is a rule you give your agent, not one the plugin enforces.

The token is stored in the plugin's `data.json`, in the clear, like every other setting. Anything that can read your vault can read it. Since the server is bound to loopback, that thing already has your files anyway.
