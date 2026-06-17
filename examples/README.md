# Folia Kanban — Example Vault

Welcome! This folder is a ready-to-open **Obsidian vault** with two example boards for learning the **Folia Kanban** plugin. Every card is a plain Markdown file — drag-and-drop, nested subcards, comments, and history, with no database.

## How to open it

1. **Open this `examples/` folder as a vault** in Obsidian (`Open folder as vault` → pick this `examples/` folder). It needs to be the vault root: the boards point `card-folder` at paths like `basic/Cards` and `feature-showcase/Cards`, which are resolved **relative to the vault root**.
2. Enable **Folia Kanban** under Settings → Community plugins (install it manually first if needed — see the repo's main README). Trust the author if Obsidian prompts you.
3. Open either board note (below) and run the command **"Open Folia Kanban board"**, or click the layout-grid ribbon icon.

> [!note]
> Want these in your own vault instead? Copy a board's folder (e.g. `feature-showcase/`) anywhere, then edit one line in its board note: set `card-folder:` to the new folder's vault-relative path (e.g. `My Stuff/feature-showcase/Cards`).

## The boards

- **Basic** — folder [`basic/`](./basic/), board note [`Example Board.md`](<basic/Example Board.md>). A minimal 3-column board (Todo / In Progress / Done) with a couple of sample cards. **Start here**: it shows the bare essentials — a board note, a `card-folder`, and cards as Markdown files.
- **Feature Showcase** — folder [`feature-showcase/`](./feature-showcase/), board note [`Showcase Board.md`](<feature-showcase/Showcase Board.md>). A "kitchen-sink" board that exercises **every feature** in one place — columns, lanes, contexts, priorities, due-date buckets, subcards, comments, history, and custom properties. **Explore here** once the basics click.

## Feature tour — what the Feature Showcase board demonstrates

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

**Cards** — across the board you'll find every priority (`A`/`B`/`C`/`D`, plus an unknown `someday` that renders muted), every due-date state (overdue, today, soon, later, none), tags (list and string form), an `area:`, custom properties (`energy`, `effort`, `blocked`), subtask checklists with progress, **subcards** (`- [ ] [[Child]]` rendered nested), comments, and auto-history. The cards live in context subfolders (`Cards/Engineering/`, `Cards/Design/`); each folder's `_context.md` gives its cards a coloured accent strip + badge.

## Things to try (features you can't see in a static file)

- **Open a card** (click it) to see the **detail panel** — edit status, priority, due date, custom properties, subtasks, comments. Try both presentations: Settings → *Card details — presentation* → `side` vs `modal`.
- **Next actions on cards:** Settings → *Card — next todos shown* → `3`. Cards now surface their next unchecked todos inline.
- **Search:** press `/` and try `priority:a`, `due:overdue`, `due:soon`, `area:work`, `tag:bug`, `context:Engineering`. Tokens **AND** together; quotes allow spaces (`area:"release plan"`); there's no negation. The **Overdue** / **Due soon** chips are shortcuts for `due:overdue` / `due:soon`.
- **Drag** a card between columns (pointer or keyboard — pick up with Space, drop with Space). The card's `status`, a fractional `order`, and a `## History` line are written to its file.
- **Right-click** a card for the context menu (mark done, change priority, move, add subcard, delete). Right-click a surfaced next-todo to toggle or remove it.
- **Manage columns** from each column's `⋯` menu (rename, recolour, set WIP limit, reorder, delete) — changes are written back to the board note.
- **Live reload:** edit a card `.md` in another pane and watch the board update.

## Authoring gotchas (worth knowing)

- `card-folder` is **vault-root-relative**, never relative to the board note. With this `examples/` folder opened as the vault, `basic/Cards` resolves to `examples/basic/Cards`.
- A card joins a column by `status` matching a column **`id`** exactly (case-sensitive); an unknown/missing status lands in the first column.
- The tile shows the **filename**; the `# H1` inside is the card's parsed title.
- A subcard (`- [ ] [[Child]]`) is pulled out of its own column and shown nested under its parent.
- A column `filter:` **replaces** its status bucket (it's a lane). The `context:` search token matches the **folder name**.

## Learn more

For full plugin docs, installation, and configuration, see [the repo's main README](../README.md).
