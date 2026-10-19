# Agents in columns

A column can start an AI agent on every card that enters it. Drop a card into a column the board note marks with `agent:`, and after a short wait the plugin runs a command of your choosing on that card. The default command opens a [Claude Code](https://code.claude.com) session in a terminal window of its own, which works the card through the board's [agent access (MCP)](mcp.md) like a teammate would: it assigns itself, comments, ticks subtasks, and moves the card where it belongs when it is done.

Desktop only, macOS and Linux. Agent access has to be on: the agent reaches the board through it, and no launch happens without it.

## Marking a column

Give a column an `agent:` key in the board note. A mapping marks it, even an empty one; `agent: null`, or no key at all, does not.

```yaml
agent:            # board-wide defaults; this does not make any column an agent column
  effort: medium
  cwd: ~/projects/app
columns:
  - id: review
    title: In Review
    agent:
      model: sonnet
```

| Key | What it is |
| --- | --- |
| `cwd` | The folder the command runs in. See the table below. |
| `model` | Handed to the command as `{{model}}` and `FOLIA_MODEL`. The default command passes it to `claude --model`. |
| `effort` | Handed over as `{{effort}}` and `FOLIA_EFFORT`; the default passes it to `claude --effort`. |
| `args` | A list of extra arguments, as `{{args}}` and `FOLIA_ARGS`. One string is read as a list of one. |

Each field is taken from the column first, then from the board note's top-level `agent:`, so a column without `cwd` runs in the board's. A card can carry `agent:` too, but only its `model` and `effort` count, and they win over both. Keys the plugin does not read are kept, and editing the column from the board keeps the whole mapping. A column with `filter:` (a lane) is never an agent column, and the Edit column dialog has no field for `agent:`: it is written by hand in the board note.

`cwd` resolves like this:

| Written | Runs in |
| --- | --- |
| absent or empty on the column and the board note | the vault's folder |
| `"~"` | your home folder; quote it, since YAML reads a bare `~` as no value at all |
| `~/projects/app` | that folder under your home |
| `/srv/app` | that folder, as written |
| `code/app` | that folder, relative to the vault's folder |

`~user` is not expanded; it is read as a relative path. The folder has to exist when the agent starts, or the launch is refused with a notice naming it.

## What starts an agent, and what calls it off

A card moved into an agent column by the board (a drag, the card menu, the keyboard, the detail panel's status field, the subcard picker, a ticked checkbox that sends a linked subcard to its column) or by an agent through MCP `move_card` starts a countdown on its tile: **Agent in 10s · Cancel · Now**. When it ends, the agent starts.

- **Cancel** calls it off. So does the card leaving the column in that time, by anyone's hand, a hand edit or a sync from another computer included. A hand edit or a sync is seen when this computer reads the changed note, so one that moves the card out and straight back before that read looks like no move at all.
- **Now** skips the rest of the wait.
- A hand edit or a sync moving a card *into* the column never starts one. That is what keeps two computers sharing a vault from starting two agents for one move. Deleting a column, a new card created in the column, and a checklist line moved into it do not start one either; [Decisions](decisions.md#what-does-not-start-an-agent) says why.
- A card that already carries `agent-run` is never launched again.
- Closing the board does not call a countdown off; quitting Obsidian does.

## While it runs: `agent-run`

At launch the plugin writes a marker into the card's frontmatter, and the tile shows an **Agent** chip for as long as it is there:

```yaml
agent-run: { id: 3f9a1c2b, started: "2026-10-19 14:05", column: review }
```

The marker means "a session was handed this card". It goes when:

- the card leaves `column`, by anyone's hand, on any computer that has the vault open with the plugin;
- the agent stops without moving the card and clears it itself, with `update_card` and `properties: {"agent-run": null}`, as the default prompt asks it to;
- the command fails before the agent starts (it exits non-zero), together with a notice saying why.

A marker written without a `column` (by hand, or by an older build) is kept when Obsidian starts, and goes the next time the card moves out of the column it was in. A session you close by hand leaves its marker until the card is moved out; moving it back in then starts a new one.

Each launch also adds `Agent launch requested (run <id>)` to the card's history, unless **What history records** is set to moves only.

## Settings

**Settings → Folia Kanban → Agents in columns**. The rows are greyed until agent access is on.

| Setting | What it is |
| --- | --- |
| **Command** | The shell command a launch runs, through `/bin/sh -c`, in the column's `cwd`, detached from Obsidian so it outlives it. Empty it to go back to the default. |
| **Prompt** | What the agent is asked to do, handed to the command as `{{prompt}}` and `FOLIA_PROMPT`. Empty it to go back to the default. |
| **Wait before starting** | 0 to 60 seconds, 10 by default. 0 starts the agent the moment the card lands. |

Both templates are kept in the plugin's `data.json`, which travels with the vault. Until you edit one, it follows the default the installed release ships.

## Placeholders and variables

The command and the prompt can name the card's context as `{{placeholders}}`. The command gets the same values as environment variables:

| Placeholder | Variable | Value |
| --- | --- | --- |
| `{{vaultPath}}` | `FOLIA_VAULT_PATH` | The vault's folder on disk |
| `{{board}}` | `FOLIA_BOARD` | The board note's vault path |
| `{{card}}` | `FOLIA_CARD` | The card's vault path |
| `{{cardFile}}` | `FOLIA_CARD_FILE` | The card's absolute path |
| `{{cardSlug}}` | `FOLIA_CARD_SLUG` | The card's file name as `[a-z0-9-]`, at most 40 characters |
| `{{column}}` | `FOLIA_COLUMN` | The column's id |
| `{{cwd}}` | `FOLIA_CWD` | The resolved working folder |
| `{{model}}` | `FOLIA_MODEL` | The model, or empty |
| `{{effort}}` | `FOLIA_EFFORT` | The effort, or empty |
| `{{args}}` | `FOLIA_ARGS` | The extra arguments, as shell words |
| `{{mcpUrl}}` | `FOLIA_MCP_URL` | Agent access's URL, `http://127.0.0.1:27125/mcp` by default |
| `{{modDir}}` | `FOLIA_MOD_DIR` | `<vault>/<plugin folder>/folia-mod` |
| `{{runId}}` | `FOLIA_RUN_ID` | The run's id, the one in `agent-run` |
| `{{prompt}}` (command only) | `FOLIA_PROMPT` | The prompt, filled in |

In the command, write placeholders bare, never inside quotes: each one becomes exactly one shell word, whatever it holds, and `{{args}}` becomes exactly the list of arguments (nothing at all for an empty list). In the prompt they are filled in word for word. An unknown `{{name}}` is left as written.

The agent token is not a placeholder. It reaches the command only as `FOLIA_MCP_TOKEN` in its environment, never on a command line and never in a file. The URL uses the address agent access listens on, in brackets for IPv6, with `0.0.0.0` and `::` turned into the loopback address of their family; a link-local address with an interface (`fe80::1%eth0`) cannot be put in a URL, so a launch is refused there.

`FOLIA_EXPORTS` holds one `export NAME='…'` line per variable above, quoted so `eval "$FOLIA_EXPORTS"` gives back every value exactly. The token is not in it. It is for a command that hands the context to a shell of its own, as the default does.

`FOLIA_MOD_DIR` names a folder nothing creates yet; it is where a later release ships the Claude Code side of this feature. Until then, a session reaches the board only if you registered agent access with Claude Code yourself, as [Connecting a client](mcp.md#connecting-a-client) shows, and for every folder a column runs in. `claude mcp add` registers a server for the folder you run it in unless you add `--scope user`, which registers it for all of them. A session that cannot reach the board still starts, and the plugin cannot tell: its card keeps the marker until it is moved out.

## The default command

It needs `tmux` 3.2 or later (for `remain-on-exit failed`) and `claude` on the `PATH` it sets, which adds `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` to the one Obsidian was started with.

It runs a tmux server of the plugin's own, `tmux -L folia`, never your own tmux server, with one session, `agents`, and one window per card, named after the card. That server starts without your `~/.tmux.conf` (`-f /dev/null`), so tmux's default key bindings apply in it, and plugins such as tmux-resurrect or tmux-continuum never restore your sessions into it or save it over yours. Attach to watch or talk to an agent:

```sh
tmux -L folia attach -t agents
```

A window whose `claude` fails stays open, showing why. The plugin hears only whether the window was opened: a session that starts and then fails keeps its card's marker until the card is moved out.

The context, the token and the `PATH` reach the window through a tmux paste buffer read from standard input, which the window reads and deletes at once; a scheduled cleanup deletes it after 30 seconds if the window never did. No value goes on tmux's own command line.

Flatpak and Snap builds of Obsidian run sandboxed and cannot reach the computer's `tmux`; the default command does not work there.

## Writing your own command

Anything `/bin/sh` can run. The command's exit code is what the plugin reads: 0 means "handed off", anything else clears the marker and shows a notice (exit 127 adds a hint about the `PATH`). Keep it short-lived and let it hand the session to something that outlives it, the way the default hands it to tmux.

The token is in the command's environment only. Anything you write to a file, a log or another process's command line leaves that boundary.

## Security

A launch runs a command as you, on this computer, with arguments taken from the board note: `agent.args` and `cwd` in a board note, and the command in `data.json`, can run anything you can. That is the same trust you already give a synced vault's plugin code: anyone who can write your vault can change what it runs.

Agent access adds no way to change what runs: `update_card` refuses the `columns` and `agent` keys on any note it reaches, another board's note in this board's card folder included, and a card's own `agent:` carries only a model name and an effort. That is a limit on the MCP tools, not on the session a launch starts. The session runs as you, in the column's `cwd` (the vault's folder by default), with its own file and shell tools: it can edit a board note's `agent:` or the plugin's `data.json` like any program you run, and the next launch would run what it wrote. What stops it is the prompt and the agent's own permission prompts, so treat text on a card that someone else wrote as input to a program running as you. One agent can also clear another run's `agent-run` through `update_card`, after which the next move into the column starts a second agent on that card.

What agent access does add is a way to start one. Anything holding the token can `move_card` a card into an agent column, and a session then starts on this computer, reads that card and works on it. On the default loopback bind that is software already running as you; once the server listens on a network, it is any machine there with the token.

Software running as your user can still read a process's environment and the `folia` tmux server's buffers, as [What it does not protect you from](mcp.md#what-it-does-not-protect-you-from) already says of the token.
