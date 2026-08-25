# Folia Kanban — Example Vault

Welcome! This folder is a ready-to-open **Obsidian vault** with two example boards for learning the **Folia Kanban** plugin. Every card is a plain Markdown file — drag-and-drop, nested subcards, comments, and history, with no database.

## How to open it

1. **Open this `examples/` folder as a vault** in Obsidian (`Open folder as vault` → pick this `examples/` folder). The Feature Showcase board points `card-folder` at `feature-showcase/Cards`, read **from the vault root**, so this folder needs to be the vault root for it to resolve.
2. Enable **Folia Kanban** under Settings → Community plugins (install it manually first if needed — see the repo's main README). Trust the author if Obsidian prompts you.
3. Click either board note (below) in the file explorer — it opens as the board. The command **"Open Folia Kanban board"** and the layout-grid ribbon icon do the same thing without hunting for the note first. To see the note's raw Markdown, use the **Edit as markdown** button in the tab header; the button in the editor takes you back.

> [!note]
> Want these in your own vault instead? Copy a board's folder anywhere. `basic/` just works — its `card-folder: ./Cards` travels with the note. For `feature-showcase/` you also edit one line in its board note: set `card-folder:` to the new folder's vault-relative path (e.g. `My Stuff/feature-showcase/Cards`), or to `./Cards` to make it portable too.

## The boards

- **Basic** — folder [`basic/`](./basic/), board note [`Example Board.md`](<basic/Example Board.md>). A minimal 3-column board (Todo / Doing / Done) with a couple of sample cards. **Start here**: it shows the bare essentials — a board note, a `card-folder`, and cards as Markdown files.
- **Feature Showcase** — folder [`feature-showcase/`](./feature-showcase/), board note [`Showcase Board.md`](<feature-showcase/Showcase Board.md>). A "kitchen-sink" board that exercises **every feature** in one place — columns, lanes, contexts, priorities, due-date buckets, subcards, comments, history, and custom properties. **Explore here** once the basics click.

## Feature tour — what the Feature Showcase board demonstrates

**Columns** (all configured in `Showcase Board.md`):

| Column | Shows off |
| --- | --- |
| **Todo** | plain string column (auto-titlecased from `todo`) |
| **Next Up** | object column with a custom `color` |
| **In Progress** | a soft **WIP limit** of 2 — it holds 3 cards plus one placed subtask, so the header nudges (alert icon, never blocks) — plus `sort: priority` (A → B → D, top to bottom) |
| **In Review** | `group: due` — cards bucket into Overdue / Today / Soon / Later / No due date |
| **⭐ A-priority lane** | a `filter: "priority:a"` **lane** — it pulls every A-priority card from *all* columns, regardless of status. A lane is a view, not an owner: a card can appear here *and* in its real column at once. |
| **Parked** | `parked: true` + `opacity: 0.45` + `hoverOpacity: 0.95` — a faded "someday" lane that brightens on hover |
| **Done** | done column; past-due cards here stay neutral (done is never "overdue") |

**Cards** — across the board you'll find every priority (`A`/`B`/`C`/`D`, plus an unknown `someday` that renders muted; the board note's `priorities` property lists exactly that vocabulary, which is what the priority field and the right-click chips suggest — type a new value there and the board learns it), every due-date state (overdue, today, soon, later, none), tags (list and string form), an `area:`, custom properties (`energy`, `effort`), subtask checklists with progress, **subcards** (`- [ ] [[Child]]` rendered nested), comments (some signed `@alex` / `@agent`, which is what drives the unread markers), and auto-history. The cards live in context subfolders (`Cards/Engineering/`, `Cards/Design/`); each folder's `_context.md` gives its cards a coloured accent strip + badge.

**Subitems in a column of their own** — `Plan the v1.0 launch` (in Todo) carries all three cases of one rule at once, so you can compare them side by side:

| Subitem | Kind | Where it renders | Because |
| --- | --- | --- | --- |
| `Cut the release branch` | plain todo | **In Progress**, with a `↳ Plan the v1.0 launch` reference | its checklist line carries the inline field `[status:: doing]` |
| `Write the changelog` | subcard file | **Next Up**, with the same reference | the child note's own `status: next` |
| `Record the launch demo` | subcard file | nested under its parent in **Todo** | it claims nothing, which is the default for every subitem |

All three still count towards the parent's progress bar — moving the work somewhere visible does not take it off its ticket. Try dragging the `Cut the release branch` tile into **Done**: its line becomes `- [x] Cut the release branch [status:: done]`, and the parent's progress ticks up. Drag it back and it reopens. Right-click any of them for a column picker (**With its card** puts it back where its parent is), or open `Plan the v1.0 launch` and use the picker on each row under *Subtasks & subcards* — the same control for both kinds.

**Where card titles come from** — two cards demonstrate that the tile's title isn't always the file name (the board runs in the default `auto` mode, so it decides per card):

| Card file | Shows as | Why |
| --- | --- | --- |
| `04-tune-the-search-index.md` | Tune the search index | the filename is a numbered slug, so the first heading that looks like a real title wins |
| `Ship the release notes.md` | Cut the 1.0 release notes | a `title:` key in the card's own frontmatter beats every other source |

**Blocking relationships** — two cards show the two ways a blocking link can be written, and the plugin treats them as the same thing:

| Card file | Property | What you see |
| --- | --- | --- |
| `Decide the export format.md` | `blocks: ["[[Draft the announcement post]]"]` | this tile shows *Blocks 1*; `Draft the announcement post` shows *Blocked* and lists this card under a read-only **Blocked by** |
| `Record the launch demo.md` | `blocked-by: ["[[Fix keyboard-drag focus bug]]"]` | the same edge stated from the other end — the bug card shows *Blocks 1*, with nothing written to it |

Open either card's detail panel: the **Blocks** field adds and removes links (type to get suggestions from the board's own cards), while **Blocked by** is derived and read-only. The plugin only ever writes the `blocks` end, so a link it created lives in one note and has no second copy to fall out of step with; a `blocked-by` you wrote by hand stays exactly as you wrote it. State the same link from both ends and the row says so rather than offering a remove button that would only clear half of it. A marker fades once either end reaches **Done** — finished work neither waits nor holds anything up. Nothing is enforced: drag a *Blocked* card wherever you like.

**A note written under its own headings** — `Decide the export format.md` keeps its whole body under `## Question` and `## Answer`, the shape an issue-style note (or an agent) tends to produce. Open it: the Description box shows all of it, headings and all, because a card's description is everything between the title and the first section the plugin owns (`## Subtasks`, `## Comments`, `## History`). Edit the description and save, and that structure comes back unchanged.

## Things to try (features you can't see in a static file)

- **Open a card** (click it) to see the **detail panel** — edit status, priority, due date, custom properties, subtasks, comments. The priority field is free text with the board's own values as suggestions: type `blocker`, and it joins the board note's `priorities` list and shows up as a suggestion from then on, even after you delete the card again. Try both presentations: Settings → *Card details — presentation* → `side` vs `modal`.
- **Next actions on cards:** Settings → *Card — next todos shown* → `3`. Cards now surface their next unchecked todos inline.
- **Collapse/expand subitems:** `Plan the v1.0 launch` has a nested subcard (`Record the launch demo`), so it carries a **Subitems** toggle under its title — click it to fold the subcard group away into a `4 subitems, 1 done` summary (that count is every `## Subtasks` line on the card, including the two placed elsewhere), click again to bring it back. Try Settings → *Card — next todos shown* → `3` first, and it collapses the next-todos preview the same way. A column's `⋯` menu adds **Collapse all subitems** / **Expand all subitems** for everything shown in that column.
- **Unread comments:** open Settings → **Your name** and type `alex` — that is who the showcase vault pretends you are. Read-state lives in the plugin's own data, not in the notes, and tracking starts the moment the plugin first loads, so the comments shipped in this vault already count as read and nothing lights up by itself. Make something arrive: open `Cards/Decide the export format.md` as a note and add a line under `## Comments` stamped with the current date and time (or any later one), say `- _2030-01-01 09:00 @agent:_ any thoughts?` — and its tile's comment badge turns **blue** with a dot (*1 unread comment*). Do the same on `Cards/Plan the v1.0 launch.md`, which already holds two comments signed `@alex` (yours), and the badge turns **purple** with an arrow instead: *a reply to yours*. Open either card and the new comment is tinted and tagged, under a **New** rule; the tile goes quiet once you have visited it.
- **Search:** press `/` and try `priority:a`, `due:overdue`, `due:soon`, `area:work`, `tag:bug`, `context:Engineering`. Tokens **AND** together; quotes allow spaces (`area:"release plan"`); there's no negation. The **Overdue** / **Due soon** chips are shortcuts for `due:overdue` / `due:soon`.
- **Drag** a card between columns (pointer or keyboard — pick up with Space, drop with Space). The card's `status`, a fractional `order`, and a `## History` line are written to its file.
- **Right-click** a card for the context menu (mark done, change priority, move, add subcard, delete). Right-click a surfaced next-todo to toggle it, remove it, or send it to a column of its own.
- **Manage columns** from each column's `⋯` menu (rename, recolour, set WIP limit, reorder, delete) — changes are written back to the board note.
- **Live reload:** edit a card `.md` in another pane and watch the board update.
- **Swap the tab's view:** the tab header button flips between the board and the note's Markdown. Settings → *Board notes — open as* picks which one a board note starts in, and adding `folia-view: markdown` to one board note's frontmatter overrides that for that note alone.
- **Rename a title-sourced card:** rename `04-tune-the-search-index` from the board and its `# ` heading is rewritten — the file keeps its slug name. Rename `Ship the release notes` and its `title:` frontmatter value changes instead.

## Authoring gotchas (worth knowing)

- `card-folder` is read **from the vault root** and, when no folder is there but one sits beside the board note, **relative to the board note**. Write it as `./Cards` (or `../shared/Cards`) to mean the board-note reading and only that — which is what makes `basic/` portable, while `feature-showcase/Cards` names its path from the vault root. It can never resolve outside the vault, and the vault root itself is not a valid card folder.
- A card joins a column by `status` matching a column **`id`** exactly (case-sensitive); an unknown/missing status lands in the first column.
- The tile usually shows the **filename**, but a card whose filename is a slug (or that carries its own `title:` key) shows a different title — see the two title-source cards above. The board note's `card-title` property (`auto` / `filename` / `heading`) sets the policy; `[[wikilinks]]` always match the **filename**, never the displayed title.
- A subcard (`- [ ] [[Child]]`) is pulled out of its own column and shown nested under its parent.
- A column `filter:` **replaces** its status bucket (it's a lane). The `context:` search token matches the **folder name**.

## Learn more

For full plugin docs, installation, and configuration, see [the repo's main README](../README.md).
