# Folia Kanban — Example Vault

Welcome! This folder is a ready-to-open **Obsidian vault** with a few example boards for learning the **Folia Kanban** plugin. Every card is a plain Markdown file — drag-and-drop, nested subcards, comments, and history, with no database.

## How to open it

1. **Open this `examples/` folder as a vault** in Obsidian (`Open folder as vault` → pick this `examples/` folder). The Feature Showcase board points `card-folder` at `feature-showcase/Cards`, read **from the vault root**, so this folder needs to be the vault root for it to resolve.
2. Enable **Folia Kanban** under Settings → Community plugins (install it manually first if needed — see the repo's main README). Trust the author if Obsidian prompts you.
3. Click any board note (below) in the file explorer — it opens as the board. The command **"Open Folia Kanban board"** and the layout-grid ribbon icon do the same thing without hunting for the note first. To see the note's raw Markdown, use the **Edit as markdown** button in the tab header; the button in the editor takes you back.
4. Want a board of your own to play with? Run **Create board** from the command palette, or right-click a folder here and pick **Create Folia board here** — the note comes out with its properties already in place and opens as an empty board. **Convert this note into a board** does the same to a note you already have.

> [!note]
> Want these in your own vault instead? Copy a board's folder anywhere. `basic/` and `custom-scale/` just work — their `card-folder: ./Cards` travels with the note. For `feature-showcase/` you also edit one line in its board note: set `card-folder:` to the new folder's vault-relative path (e.g. `My Stuff/feature-showcase/Cards`), or to `./Cards` to make it portable too.

## The boards

- **Basic** — folder [`basic/`](./basic/), board note [`Example Board.md`](<basic/Example Board.md>). A minimal 3-column board (Todo / Doing / Done) with a couple of sample cards. **Start here**: it shows the bare essentials — a board note, a `card-folder`, and cards as Markdown files.
- **Custom Scale** — folder [`custom-scale/`](./custom-scale/), board note [`Custom Scale Board.md`](<custom-scale/Custom Scale Board.md>). A small board whose priorities are `blocker` / `steady` / `whenever` instead of `A`/`B`/`C` — it shows how the board note's `priorities` order becomes both the colour ramp and the sort order.
- **Feature Showcase** — folder [`feature-showcase/`](./feature-showcase/), board note [`Showcase Board.md`](<feature-showcase/Showcase Board.md>). A "kitchen-sink" board that exercises **every feature** in one place — columns, lanes, contexts, priorities, due-date buckets, subcards, relationships, comments, history, and custom properties. **Explore here** once the basics click.
- **Title modes** — folder [`title-modes/`](./title-modes/), three board notes over one card folder: [`Auto Board.md`](<title-modes/Auto Board.md>), [`Heading Board.md`](<title-modes/Heading Board.md>) and [`Filename Board.md`](<title-modes/Filename Board.md>). Each sets a different `card-title` policy, so the same three cards show under all three rules side by side (see [Title modes](#title-modes-side-by-side) below).

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

**Cards** — across the board you'll find every priority (`A`/`B`/`C`/`D`, plus a `someday` the plugin has no opinion about, which takes the calmest ramp colour because the board note lists it last; that `priorities` property is the board's whole vocabulary, which is what the priority field and the right-click chips suggest — type a new value there and the board learns it), every due-date state (overdue, today, soon, later, none), tags (list and string form), an `area:`, custom properties (`energy`, `effort`), subtask checklists with progress, **subcards** (`- [ ] [[Child]]` rendered nested), comments (some signed `@alex` / `@agent`, which is what drives the unread markers; `Design the on-disk format` has one written as a plain paragraph, and quotes the whole card format inside a code fence without it being read as structure), and auto-history. The cards live in context subfolders (`Cards/Engineering/`, `Cards/Design/`); each folder's `_context.md` gives its cards a coloured accent strip + badge.

**Subitems in a column of their own** — `Plan the v1.0 launch` (in Todo) carries all three cases of one rule at once, so you can compare them side by side:

| Subitem | Kind | Where it renders | Because |
| --- | --- | --- | --- |
| `Cut the release branch` | plain checklist item | **In Progress**, with a `↳ Plan the v1.0 launch` reference | its checklist line carries the inline field `[status:: doing]` |
| `Write the changelog` | subcard file | **Next Up**, with the same reference | the child note's own `status: next` |
| `Record the launch demo` | subcard file | nested under its parent in **Todo** | it claims nothing, which is the default for every subitem |

All three still count towards the parent's progress bar — moving the work somewhere visible does not take it off its ticket. Try dragging the `Cut the release branch` tile into **Done**: its line becomes `- [x] Cut the release branch [status:: done]`, and the parent's progress ticks up. Drag it back and it reopens. Now do the same with the `Write the changelog` tile: the child note's `status` becomes `done`, and the parent's line becomes `- [x] [[Write the changelog]]`, so `Plan the v1.0 launch` reads `2/4` instead of going on calling finished work outstanding. Drag it back to Next Up and the line unticks again. Right-click any of them for a column picker (**With its card** puts it back where its parent is), or open `Plan the v1.0 launch` and use the picker on each row under *Subtasks & subcards* — the same control for both kinds.

**Where card titles come from** — two cards demonstrate that the tile's title isn't always the file name (the board runs in the default `auto` mode, so it decides per card):

| Card file | Shows as | Why |
| --- | --- | --- |
| `04-tune-the-search-index.md` | Tune the search index | the filename is a numbered slug, so the first heading that looks like a real title wins |
| `Ship the release notes.md` | Cut the 1.0 release notes | a `title:` key in the card's own frontmatter beats every other source |

**Relationships** — the board note declares one relationship type of its own next to the built-in `blocks`:

```yaml
relations:
  - key: a-result-of
    inverse: results-in
```

Three cards then declare four links, covering both types written from either end, and the plugin treats both spellings of an edge as the same thing:

| Card file | Property | What you see |
| --- | --- | --- |
| `Decide the export format.md` | `blocks: ["[[Draft the announcement post]]"]` | this tile shows *Blocks 1*; `Draft the announcement post` shows *Blocked* and lists this card under a read-only **Blocked by** |
| `Record the launch demo.md` | `blocked-by: ["[[Fix keyboard-drag focus bug]]"]` | the same edge stated from the other end — the bug card shows *Blocks 1*, with nothing written to it |
| `Decide the export format.md` | `a-result-of: ["[[Design the on-disk format]]"]` | the board's own type: *A result of 1* here, *Results in 1* on the design card — still shown although that card is done, because only blocking fades on done |
| `Triage community feedback.md` | `results-in: ["[[Someday - board swimlanes]]"]` | the inverse key, hand-written: the swimlanes card shows *A result of 1* with nothing written to it |

Open any of them: the panel has one editable list per type (**Blocks**, **A result of** — type to get suggestions from the board's own cards) and one derived, read-only list for the other end (**Blocked by**, **Results in**). The plugin only ever writes the declaring end, so a link it created lives in one note and has no second copy to fall out of step with; an inverse you wrote by hand stays exactly as you wrote it. State the same link from both ends and the row says so rather than offering a remove button that would only clear half of it. A blocking marker fades once either end reaches **Done** — finished work neither waits nor holds anything up. Nothing is enforced: drag a *Blocked* card wherever you like, and press `/` and type `is:blocked` (or click the **Blocked** chip) to list what is waiting on something, `is:unblocked` for what is free to pick up.

**A note written under its own headings** — `Decide the export format.md` keeps its whole body under `## Question` and `## Answer`, the shape an issue-style note (or an agent) tends to produce. Open it: the Description box shows all of it, headings and all, because a card's description is everything between the title and the first section the plugin owns (`## Subtasks`, `## Comments`, `## History`). Edit the description and save, and that structure comes back unchanged.

## Title modes, side by side

The three boards in `title-modes/` share one `Cards/` folder and differ in one line: `card-title: auto`, `heading` or `filename`. What each card shows on each board:

| Card file | Heading in the note | `auto` | `heading` | `filename` |
| --- | --- | --- | --- | --- |
| `Notes.md` | `# Notes from the kickoff meeting` | Notes | Notes from the kickoff meeting | Notes |
| `02-write-docs.md` | `# Docs` | 02-write-docs | Docs | 02-write-docs |
| `Override.md` (has `title: Set from the frontmatter`) | `# The heading of this note` | Set from the frontmatter | Set from the frontmatter | Set from the frontmatter |

`auto` only reads a heading for a slug-shaped file name, and only when the heading reads as a real title, so `Notes.md` keeps its name and `02-write-docs.md` skips its one-word heading. A `title:` key wins everywhere; open `Override` and clear the **Display title** field in its detail panel to watch each board fall back to its own rule.

## Things to try (features you can't see in a static file)

- **Open a card** (click it) to see the **detail panel** — edit status, priority, due date, custom properties, subtasks, comments. The priority field is free text with the board's own values as suggestions: type `blocker`, and it joins the board note's `priorities` list and shows up as a suggestion from then on, even after you delete the card again. Try both presentations: Settings → *Card details — presentation* → `side` vs `modal`.
- **Next actions on cards:** Settings → *Card — next todos shown* → `3`. Cards now surface their next unchecked todos inline.
- **Collapse/expand subitems:** `Plan the v1.0 launch` has a nested subcard (`Record the launch demo`), so it carries a **Subitems** toggle under its title — click it to fold the subcard group away into a `4 subitems, 1 done` summary (that count is every `## Subtasks` line on the card, including the two placed elsewhere), click again to bring it back. Try Settings → *Card — next todos shown* → `3` first, and it collapses the next-todos preview the same way. A column's `⋯` menu adds **Collapse all subitems** / **Expand all subitems** for everything shown in that column.
- **Unread comments:** open Settings → **Your name** and type `alex` — that is who the showcase vault pretends you are. Read-state lives in the plugin's own data, not in the notes, and tracking starts the moment the plugin first loads, so the comments shipped in this vault already count as read and nothing lights up by itself. Make something arrive: open `Cards/Decide the export format.md` as a note and add a line under `## Comments` stamped with the current date and time (or any later one), say `- _2030-01-01 09:00 @agent:_ any thoughts?` — and its tile's comment badge turns **blue** with a dot (*1 unread comment*). Do the same on `Cards/Plan the v1.0 launch.md`, which already holds two comments signed `@alex` (yours), and the badge turns **purple** with an arrow instead: *a reply to yours*. Open either card and the new comment is tinted and tagged, under a **New** rule; the tile goes quiet once you have visited it. Before that, click the **Unread** chip (or type `unread:comments`) to see only the cards with something new, `unread:replies` for only the answers to you.
- **Search:** press `/` and try `priority:a`, `due:overdue`, `due:soon`, `area:work`, `tag:bug`, `context:Engineering`, `is:blocked`, `is:unblocked`, `unread:comments`. Tokens **AND** together; quotes allow spaces (`area:"release plan"`); there's no negation beyond `is:unblocked` and `unread:none`. The **Overdue** / **Due soon** / **Blocked** / **Unread** chips are shortcuts for `due:overdue` / `due:soon` / `is:blocked` / `unread:comments`.
- **Drag** a card between columns (pointer or keyboard — pick up with Space, drop with Space). The card's `status`, a fractional `order`, and a `## History` line are written to its file.
- **Right-click** a card for the context menu (mark done, change priority, move, copy the card file's path in four forms, add subcard, delete). Right-click a surfaced next-todo to toggle it, remove it, or send it to a column of its own.
- **Manage columns** from each column's `⋯` menu (rename, recolour, set WIP limit, reorder, delete) — changes are written back to the board note.
- **Live reload:** edit a card `.md` in another pane and watch the board update.
- **Swap the tab's view:** the tab header button flips between the board and the note's Markdown. Settings → *Board notes — open as* picks which one a board note starts in, and adding `folia-view: markdown` to one board note's frontmatter overrides that for that note alone.
- **Set a display title:** open any card and type into the **Display title** field near the top of its detail panel (or right-click the tile and pick **Display title**). The tile reads that from then on, whatever the board's `card-title` says; clear the field to go back.
- **Rename a title-sourced card:** rename `04-tune-the-search-index` from the board and its `# ` heading is rewritten — the file keeps its slug name. Rename `Ship the release notes` and its `title:` frontmatter value changes instead.

## Authoring gotchas (worth knowing)

- `card-folder` is read **from the vault root** and, when no folder is there but one sits beside the board note, **relative to the board note**. Write it as `./Cards` (or `../shared/Cards`) to mean the board-note reading and only that — which is what makes `basic/` portable, while `feature-showcase/Cards` names its path from the vault root. It can never resolve outside the vault, and the vault root itself is not a valid card folder.
- A card joins a column by `status` matching a column **`id`** exactly (case-sensitive); an unknown/missing status lands in the first column.
- The tile usually shows the **filename**, but a card whose filename is a slug (or that carries its own `title:` key) shows a different title — see the two title-source cards above. The board note's `card-title` property (`auto` / `filename` / `heading`) sets the policy; `[[wikilinks]]` always match the **filename**, never the displayed title.
- A subcard (`- [ ] [[Child]]`) is pulled out of its own column and shown nested under its parent.
- A column `filter:` **replaces** its status bucket (it's a lane). The `context:` search token matches the **folder name**. A lane filtering on `unread:` shows each reader their own set, since read-state is per install, not in the notes.

## Learn more

For full plugin docs, installation, and configuration, see [the repo's main README](../README.md).
