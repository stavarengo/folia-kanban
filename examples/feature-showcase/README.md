# Feature Showcase

A single "kitchen-sink" board that exercises **every feature** of the Markdown Kanban plugin — columns, lanes, contexts, priorities, due-date buckets, subcards, comments, history, custom properties, and more. Use it to see the plugin's full surface without building a board from scratch.

## How to open it

The plugin resolves `card-folder` **relative to the vault root**, so the simplest path is:

1. **Open the repository root as an Obsidian vault** (`Open folder as vault` → pick this repo).
2. Enable **Markdown Kanban** under Settings → Community plugins (install it manually first if needed — see the repo README).
3. Open **`Showcase Board.md`** and run the command **"Open Kanban board"** (or click the layout-grid ribbon icon).

> If you'd rather drop this into your own vault, copy the whole `feature-showcase/` folder anywhere, then edit one line in `Showcase Board.md`: set `card-folder:` to the new folder's vault-relative path (e.g. `My Stuff/feature-showcase/Cards`).

## What's where

- `Showcase Board.md` — the board note (`kanban-board: true` + the `columns:` config).
- `Cards/` — every card (this is the `card-folder`).
- `Cards/Engineering/`, `Cards/Design/` — context subfolders; each `_context.md` gives its cards a coloured strip + badge.

## Feature tour

**Columns** (all configured in `Showcase Board.md`):

| Column | Shows off |
| --- | --- |
| **Todo** | plain string column (auto-titlecased from `todo`) |
| **Next Up** | object column with a custom `color` |
| **In Progress** | a soft **WIP limit** of 2 — it holds 3 cards, so the header nudges (alert icon, never blocks) — plus `sort: priority` (A → B → D, top to bottom) |
| **In Review** | `group: due` — cards bucket into Overdue / Today / Soon / Later / No due date |
| **⭐ A-priority lane** | a `filter: "priority:a"` **lane** — it pulls every A-priority card from *all* columns, regardless of status. A lane is a view, not an owner: a card can appear here *and* in its real column at once. |
| **Parked** | `parked: true` + `opacity: 0.45` + `hoverOpacity: 0.95` — a faded "someday" lane that brightens on hover |
| **Done** | done column; past-due cards here stay neutral (done is never "overdue") |

**Cards** — across the board you'll find every priority (`A`/`B`/`C`/`D`, plus an unknown `someday` that renders muted), every due-date state (overdue, today, soon, later, none), tags (list and string form), an `area:`, custom properties (`energy`, `effort`, `blocked`), subtask checklists with progress, **subcards** (`- [ ] [[Child]]` rendered nested), comments, and auto-history.

## Things to try (features you can't see in a static file)

- **Open a card** (click it) to see the **detail panel** — edit status, priority, due date, custom properties, subtasks, comments. Try both presentations: Settings → *Card details — presentation* → `side` vs `modal`.
- **Next actions on cards:** Settings → *Card — next todos shown* → `3`. Cards now surface their next unchecked todos inline.
- **Search:** press `/` and try `priority:a`, `due:overdue`, `due:soon`, `area:work`, `tag:bug`, `context:Engineering`. Tokens **AND** together; quotes allow spaces (`area:"release plan"`); there's no negation. The **Overdue** / **Due soon** chips are shortcuts for `due:overdue` / `due:soon`.
- **Drag** a card between columns (pointer or keyboard — pick up with Space, drop with Space). The card's `status`, a fractional `order`, and a `## History` line are written to its file.
- **Right-click** a card for the context menu (mark done, change priority, move, add subcard, delete). Right-click a surfaced next-todo to toggle or remove it.
- **Manage columns** from each column's `⋯` menu (rename, recolour, set WIP limit, reorder, delete) — changes are written back to `Showcase Board.md`.
- **Live reload:** edit a card `.md` in another pane and watch the board update.

## Authoring gotchas (worth knowing)

- `card-folder` is **vault-root-relative**, never relative to the board note.
- A card joins a column by `status` matching a column **`id`** exactly (case-sensitive); an unknown/missing status lands in the first column.
- The tile shows the **filename**; the `# H1` inside is the card's parsed title.
- A subcard (`- [ ] [[Child]]`) is pulled out of its own column and shown nested under its parent.
- A column `filter:` **replaces** its status bucket (it's a lane). The `context:` search token matches the **folder name**.
