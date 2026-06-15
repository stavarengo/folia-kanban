# Markdown Kanban

A real, interactive Kanban board for [Obsidian](https://obsidian.md) — columns, drag-and-drop, nested subcards, comments and history — with **plain Markdown files as the single source of truth**. Every card is one `.md` file, and everything about it (description, subtasks, subcards, comments, history) lives inside that file as ordinary Obsidian-flavoured Markdown. No database, no lock-in, no weird syntax inside your files: your board is just plain markdown notes.

## Features

- **Drag-and-drop that persists** — by pointer or keyboard. Dropping a card writes its `status` and a fractional `order` (one card rewritten per move, never a mass reindex) and appends a `## History` line.
- **Quick actions on every card** — mark done, open the note, or delete (with confirm), straight from the board.
- **Card detail panel** — a dialog (takes focus on open, Escape closes and restores focus) to edit description, status, priority and due date, manage subtasks/subcards, and add comments. Priority accepts any scale (`A`/`B`/`C`/`D` or `urgent`/`high`/`medium`/`low`).
- **Search & quick filters** — press `/` to search by title, tag or priority; one-click **Overdue** / **Due soon** filters.
- **Soft WIP limits** — set a per-column limit; the board nudges (never blocks) when you go over.
- **In-app column management** — add, rename, recolour, set limits, reorder and delete columns; changes are written back to the board note's `columns` frontmatter.
- **Subtasks & subcards in one checklist** — a plain `- [ ] todo`, or `- [ ] [[Child]]` which is a full child card with its own board data, navigable from the detail panel.
- **Relative due dates** — *Today*, *Tomorrow*, *in 3d*, *Yesterday*, with overdue cards flagged.
- **Comments** and auto-generated **history**, appended to the card file with timestamps.
- **Live reload** when files change outside the board, with a self-write echo guard.
- **Accessible & themed** — keyboard-navigable, ARIA roles and focus management throughout; styled with Obsidian's own CSS variables (light + dark) for a clean, shadcn-grade look.

## How a card looks on disk

```md
---
status: doing        # which column
order: 2.5           # position within the column (fractional)
priority: A
due: 2026-06-15
---

# Card title

Description text…

## Subtasks
- [ ] a plain todo
- [x] a done todo
- [ ] [[A Subcard]]      ← a nested child card (its own file)

## Comments
- [2026-06-13 14:32] looks good

## History
- [2026-06-13 14:30] Moved from Todo to Doing
```

Parentage has a single source of truth: a card is a subcard of P **iff** P's `## Subtasks` links to it. Body edits splice only the touched section; frontmatter is written via Obsidian's `processFrontMatter`, so unrelated bytes in your notes are never rewritten.

## Set up a board

1. Make a **board note** — any note with this frontmatter (see `examples/Example Board.md`):
   ```yaml
   kanban-board: true
   card-folder: Cards      # folder holding the card notes
   columns:
     - todo
     - doing
     - done
   ```
2. Put card notes (each with a `status` matching a column) in that folder.
3. Run the command **“Open Kanban board”** or click the layout-grid ribbon icon.

Columns can be edited by hand in the board note's `columns` property, or managed in-app from each
column's `⋯` menu (rename, recolour, WIP limit, reorder, delete) and the **Add column** button — the
plugin reads and writes that frontmatter list either way. A column entry may be a plain string
(`- todo`) or an object (`{ id, title, color, limit }`).

## Install

**Manual:** build (below) or download a release, then copy `main.js`, `manifest.json` and `styles.css` into `<your-vault>/.obsidian/plugins/markdown-kanban/`, and enable it under Settings → Community plugins.

## Develop

```bash
pnpm install
pnpm build       # production bundle -> main.js
pnpm dev         # watch build
pnpm test        # vitest: model, board graph, drag, and UI flows
pnpm typecheck   # tsc --noEmit
```

The pure model (`src/model`), board graph + drag reducer, and UI logic are unit-tested, including a byte-stability round-trip over the fixtures in `test/fixtures/` that proves edits never corrupt untouched bytes of a card file. `main.js`, `node_modules` and the pnpm store are git-ignored; releases ship the built `main.js`.

## License

[MIT](LICENSE) © Rafael Stavarengo
