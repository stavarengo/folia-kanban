# Agent access (MCP)

Folia Kanban can host a [Model Context Protocol](https://modelcontextprotocol.io) server inside the plugin, so an AI agent drives your boards the way you drive them: it creates cards, moves them, sets fields, comments and ticks subtasks — and every one of those goes through the board's own rules. A card an agent touches gets the same history lines, the same signed comments and the same fractional ordering it would have got from you dragging it. That is the whole point: an agent editing the card files directly does none of that, because it has no idea any of it is owed.

It is off until you turn it on, it listens on `127.0.0.1` — this computer and nothing else — unless you deliberately move it, and every request must carry a bearer token this vault generated.

## Turning it on

**Settings → Folia Kanban**, under the **Agent access (MCP)** heading:

| Setting | What it is |
| --- | --- |
| **Enable agent access** | Off by default. Switching it on generates the token (once, kept afterwards) and starts the server. |
| **Server port** | `27125` by default; any port from 1024 to 65535. Change it if something else already holds it. |
| **Bind address** | `127.0.0.1` by default, which keeps the server on this computer. `0.0.0.0` is every IPv4 address it has, `::` every address; any address other than loopback puts it on a network — see [Moving it off this computer](#moving-it-off-this-computer) before you do. |
| **Agent token** | A **Copy token** button. The token is a password for every board in this vault — paste it into your client's configuration and nowhere else. |
| **Replace the token** | A **Replace token** button, for when the old one has been somewhere it should not have been. It issues a new token, copies it, and locks out every client still holding the old one until you paste the new one in. Switching agent access off and on again does *not* change the token: a client configured once should keep working. |

If the port is already taken, or the bind address is not one this computer actually has, the plugin says so in a notice naming the address, the port and the reason. The toggle stays on — it is what you asked for, and the fix is usually a different port rather than giving up — but nothing is listening until you change it, and the plugin will not keep retrying a bind it already knows fails.

## Moving it off this computer

`127.0.0.1` is the default because it is the one address that cannot be reached from anywhere else: whatever network you are on, only software already running on this computer can connect. The bind-address setting exists because that is sometimes exactly the wrong thing — an agent in a container reaches its host through the container's gateway address, never through the host's loopback, so a client that is not on this computer needs the server to be somewhere it can see.

Understand what you are choosing. Bind to `0.0.0.0` and the server answers on **every IPv4 address** this computer has, including the ones it picks up later on a network you join tomorrow (`::` is the IPv6 wildcard, and on a dual-stack machine it covers IPv4 as well). Bind to one interface (`192.168.1.5`, or your container gateway) and it answers there. Either way, any machine that can reach that address and holds the token can read and change every board in this vault, exactly as you can. The token is the whole of the boundary at that point, so:

- Move it only onto a network you actually trust, for as long as you need it, and put it back on `127.0.0.1` afterwards.
- Treat the token as what it now is — a password reachable from other machines. **Replace token** after any run where it might have gone somewhere it should not have.

The address must be an IP literal — `0.0.0.0`, `192.168.1.5`, `::1`, `::`. A name is refused, `localhost` included: an address valid on this computer is a fact about its interfaces, a name that resolves here today may resolve elsewhere tomorrow, and `localhost` in particular lands on `127.0.0.1` or `::1` depending on a hosts file, so the setting and the socket would disagree about where the server is.

An IPv6 address goes into the setting bare and into a URL in brackets: bind `::1` and the endpoint is `http://[::1]:27125/mcp`. A link-local one wants the interface it is local to (`fe80::1%eth0`); it binds, but treat it as a dead end rather than a choice — the WHATWG URL parser that browsers and most Node clients use rejects a zone inside an IPv6 host in either spelling, so there is no endpoint URL to hand such a client; the bare `fe80::1` is accepted by the field but nothing can bind it, so it fails like any other address this computer does not have. Any IPv6 address written with a dotted IPv4 tail is refused, and so is the IPv4-mapped range in its hex spelling too (`::ffff:192.168.1.5` and `::ffff:c0a8:105` alike): it is a second spelling of an address that already has one, and the traps are sharp — `::ffff:0.0.0.0` would read as a single interface while binding every one of them, and `::ffff:7f00:1` would read as a network address while binding plain loopback.

Whether this computer actually has the address is settled by the bind, not by the field: an address it does not have fails, and the notice says so. Give it a real interface address — a multicast or broadcast literal binds happily and answers nothing useful, and the field cannot tell you that. And whenever the server does come up on something other than loopback it says so in a notice — every time, including on Obsidian start, because the setting travels with the vault and the computer now listening on a network may not be the one where that was chosen.

### Which browser pages the server will talk to

A page open in your browser can post to a server on your machine, or on your network, without you doing anything — so a request carrying an `Origin` header is checked before it is allowed to mean anything. (An MCP client sends no `Origin` at all; only browsers do.) The rule:

- A loopback origin is always allowed, whatever the bind is: a page served from this computer is as trusted as this computer.
- Any other origin must be an **IP literal**, and must be the address the server was bound to — or any literal, when the bind is `0.0.0.0` or `::`, since the server was deliberately put on every address the machine has and cannot tell which of them a legitimate page came in on.
- A DNS name — `https://evil.example` — is refused under every bind, wildcard included. That is what stops DNS rebinding specifically: the attack works by making a name its author controls resolve to your address, and the `Origin` it then sends is that name, never a literal.
- `null` is an origin, not the absence of one — it is what a sandboxed iframe and a `file://` page send — so it is refused rather than waved through.

Be clear about how much this buys. Under a wildcard bind any bare-IP origin is admitted, so a page served from an address rather than a name is not stopped by it at all. This check is not what keeps another host out; the token is, and always was. A browser is held off twice over anyway: a cross-origin call carrying an `Authorization` header has to pass a preflight first, and this server answers no `OPTIONS` and returns no `Access-Control-Allow-Origin` at all, so the browser refuses the call whatever the origin rule said. Read the origin rule as a cheap extra lock on the one attack a token alone does invite, not as a boundary to lean on.

There is one server per vault. Every tool addresses a board by the vault path of its board note, so several boards in one vault need no extra setup.

## Connecting Claude Code

With the server on and the token copied:

```sh
claude mcp add --transport http folia-kanban http://127.0.0.1:27125/mcp \
  --header "Authorization: Bearer PASTE_YOUR_TOKEN_HERE"
```

Substitute the bind address for `127.0.0.1` if you have moved the server off this computer, in brackets if it is IPv6. Any other MCP client works the same way: **Streamable HTTP**, endpoint `http://<bind address>:<port>/mcp`, header `Authorization: Bearer <token>`. The server answers `POST` only — it never opens a stream of its own, so a client that also tries `GET` gets a `405` and carries on.

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
| `get_board` | reads | A board's columns and the cards in each, in the order the board shows them, each with its priority, due date and `assignee`. A card nested under another one is in no column of its own, so it is listed under its parent's `children`. |
| `get_card` | reads | One card in full: column, frontmatter, description, subtasks, comments, history, relationships. |
| `create_card` | writes | Adds a card to a column, written into the board's card folder exactly as the add-card button writes it. Optional `description`, `priority`, `due`. |
| `move_card` | writes | Moves a card to a `column`, optionally to a `position` in it (`0` is the top; omit to append). Records the move in the card's history and keeps a parent's checklist box in step, the same way a drag does. A checklist-line card takes no `position`: its order comes from where the line sits in its parent's list. The reply says which column the card landed in, and its `position` only when it has a tile of its own — a card drawn inside its parent is ordered by that parent, not by a slot. |
| `update_card` | writes | Changes `title`, `description`, `priority`, `due`, or any other frontmatter key through `properties`. `null` clears any of them. `due` is `YYYY-MM-DD` and is refused in any other shape, rather than written as prose the board cannot read. |
| `add_comment` | writes | Appends a comment to `## Comments`, timestamped and signed with the **Your name** setting. One line: a comment is stored as a single list item. |
| `add_subtask` | writes | Appends an unchecked line to `## Subtasks`, and reports the `index` and `text` of the line it added — the two `set_subtask_done` asks for. One line, for the same reason. |
| `set_subtask_done` | writes | Ticks or unticks one subtask, named by BOTH the `index` and the `text` `get_card` reported for it. A line claiming a column of its own is kept in step with its checkbox. |

`set_subtask_done` takes the line's words as well as its position, and refuses the write when the note no longer reads that way. An index is only a position: anything added or removed above a line — by hand, by sync, by another tool, or by an earlier call in the same loop — moves every line below it, and a tick decided against an old reading would land on somebody else's todo. So read the card, pass back what it said, and treat a refusal as the signal to read it again rather than as a failure to work around: a write it refuses does not land. Two limits are worth knowing. Words cannot tell apart two checklist lines that read exactly the same — between those, the index still decides. And ticking a line that claims a column of its own is two writes rather than one, so a note edited in the moment between them can leave the box written and only the claim refused; the message says which half that was.

`update_card` refuses `status`, `order`, `priority`, `due`, `title` and `folia-board` inside `properties`, and says which tool or field owns each instead — so an agent cannot set a column by hand and skip the history line that move is owed, or retitle a card in the frontmatter while the file and every link to it keep the old name.

An empty string is not a second way to clear a value, except for `priority`, where it always has been: clearing a priority is what the detail panel does when you empty the field, and the board treats the empty value as the absence of one. Everywhere else `""` is a value — `properties: { area: "" }` leaves an empty `area`, it does not remove it — and `due` refuses it outright, because an empty string is not a date. The same holds one level up for a list: `properties: { assignee: [] }` leaves an empty list sitting in the note, not a removed key. Use `null` when you mean remove.

`update_card` also needs at least one field to change. That rule cannot be expressed in JSON Schema, so a client sees an all-optional object and meets the requirement as a tool error on the call.

Assignment is one of those ordinary keys, and `get_board` reports it per card so surveying who is on what costs one call: `properties: { assignee: "alex" }` assigns a card and `properties: { assignee: null }` unassigns it, which is exactly what the board's own **Assignee** field writes. Nothing refuses it and no dedicated field exists for it, because a name is a plain string — there is no vocabulary the board has to learn from it, no history line owed, and no format the board could misread. `assignee:me` in a filter is the **Your name** setting, which is the user's, not the agent's, so a tool should write the name it means.

A card can name several people (`assignee: [alex, ana]`, written by hand or by the board's own **Assign to me** button), and `get_board` and `get_card` both report that list; `properties` can write one back, `properties: { assignee: ["alex", "ana maria"] }`, in whatever shape the note should hold. Either shape still replaces the key wholesale — a scalar written over a list drops everyone but the one name, and a list written over a single name grows it to however many the call named — so read the value first and write back the whole list you mean to end up with, rather than the one name you are changing. The board's own **Assign to me** / **Unassign me** buttons are narrower on purpose, touching only your own name on a shared card; nothing in `properties` does that, because a generic key has no name of its own to leave alone.

`properties` takes a list for any key `get_card`/`get_board` could hand one back for, `aliases` and `cssclasses` included, with one exception: `area` refuses a list, because the `area:` filter and the free-text search both read it with a plain `String(...)` — `properties: { area: ["home", "work"] }` fails rather than landing a value neither would ever match again.

A `priority` the board has not seen before is accepted and added to the board's vocabulary, exactly as typing a new one into a card's details does. The board's scale is yours, not a fixed list — which also means an agent inventing one leaves it there for you to prune by hand.

`create_card` and `update_card` refuse a `description` that would start one of the sections the board owns (`## Subtasks`, `## Comments`, `## History`), that opens with a `#` heading — a card reads its title from that, so the line would be swallowed rather than kept — or that leaves a code fence open, exactly as the card's own Description box refuses it. Written through, such a line would stop being description and become that section — an agent could write the board's history, or sign a comment with your name — and everything below it would quietly stop being description at all. `add_comment` and `add_subtask` refuse a line break for the same reason: each writes one Markdown list item, and a second line would be read as structure rather than as what you wrote.

A failure a caller can fix — an unknown board, an ambiguous card, a column that does not exist — comes back as a tool error with the text explaining it, so the model can correct itself. Only a malformed request is a protocol error.

### How much history a write records

The **What history records** setting (Settings → Folia Kanban → **Comments and history**) applies to agent writes exactly as it applies to yours. On `all` (the default) every field edit, comment and subtask change writes its line; on `moves`, only moves do — for an agent as much as for you. That is the parity: not "agents always write history", but "agents write whatever you would have written".

## The contract

The tool names and their argument schemas are a public contract: your agent is configured against them, and a rename breaks it silently, in your vault, at run time. They are frozen in a snapshot (`test/__snapshots__/mcpContract.test.ts.snap`) that `pnpm contracts:check` verifies, so changing the surface has to be deliberate.

The server speaks MCP revision `2025-06-18`, and the small half of it a board needs: `initialize`, `ping`, `tools/list`, `tools/call`. No resources, no prompts, no server-initiated messages.

Every write tool is published with MCP's `destructiveHint`, so a client that asks before running destructive tools knows which these are: all six that write. The three readers carry `readOnlyHint`.

Calls are answered one at a time. Every write reads the board, works out its change against what it read, and writes it back, so two moves into the same column running together would hand both cards the same slot. A board call is milliseconds of local file work, so the wait costs nothing worth having — but a queue is only as live as the call at its head. A call that has not finished in a minute is answered `504`, and a client that opens a request and then goes quiet is timed out rather than allowed to hold the line.

A `504` means the server stopped making you wait, not that the call was cancelled — it is still running and may still write. Nothing here can safely abandon a write half-made, and letting the queue move on would put two calls in the board at once, which is what the queue is for. So check the board before sending a timed-out call again: a retried `create_card` whose first attempt then lands is how you get the card twice.

## What it does not protect you from

Nothing stops an agent from editing your card files directly — Obsidian gives a plugin no lock on the vault, and a plugin cannot restrict what other software on your computer does with your files. This server is how an agent *can* do the right thing; keeping it to that route is a rule you give your agent, not one the plugin enforces.

The token is kept in Obsidian's own secret storage, not in the plugin's `data.json`, so it does not travel with the vault: a synced copy, a git remote or a backup carries your settings and your cards but not the credential to the server. It is per install — replace it on one computer and the others keep theirs — and it is generated fresh on any install where agent access is on but no token has been minted yet. A vault opened on a second computer therefore has agent access on with a token of that machine's own, which is what you want, since the server it would host is that machine's too. There is no way back: a token that was in `data.json` when this version first ran is moved into secret storage and removed from the file.

One upgrade case is worth knowing about, because it looks like a bug while it lasts. If the same vault is open on two computers and only one of them has this version, the old one keeps writing its token back into `data.json` and this one keeps taking it out again — and each time the old one finds the file without it, it mints itself a *new* token. So during that window the agent configured against the old computer stops working, and keeps stopping until that computer is updated too. Update both, or switch agent access off on the one you are not using.

What none of this does is protect the token from anything already running as you on this computer, which is where Obsidian decrypts it to use it. On the default loopback bind that is the end of it, because software running as you already has your files and did not need the server to get them.

Moving the bind address off loopback changes that argument, and it is the reason the setting warns you where it lives. From that moment the token is a credential other machines can use, and it is travelling as plain text over plain HTTP: there is no TLS here, so anything that can watch the connection can take it. The plugin does not fix that for you. Keep a non-loopback bind to a network you trust, keep it on only while you need it, and replace the token afterwards.
