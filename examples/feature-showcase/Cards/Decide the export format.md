---
status: todo
order: 4
priority: C
area: docs
---

# Decide the export format

Context: [[Design the on-disk format]]

## Question

Which format should a board export emit by default, and what does the flag look like for the other one?

## Answer

CSV by default, since that is what spreadsheets open without asking. JSON stays available behind `--json` for anyone scripting against it.

## Comments
- _2026-06-14 09:10:_ This whole note lives under its own `## Question` / `## Answer` headings, and the detail panel shows all of it — only the sections the plugin owns are cut off.
