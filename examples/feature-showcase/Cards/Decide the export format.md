---
status: todo
order: 4
priority: C
area: docs
blocks:
  - "[[Draft the announcement post]]"
a-result-of:
  - "[[Design the on-disk format]]"
---

# Decide the export format

Context: [[Design the on-disk format]]

This card's `blocks` property says the announcement can't be drafted until the format is settled. It is written on **this** end only: the other card shows a read-only **Blocked by** entry the plugin derives at load time, and both tiles get a marker — "Blocks 1" here, "Blocked" there. Nothing is enforced: you can still drag either card anywhere.

`a-result-of` is a second relationship type, one the board note declares itself under `relations` (`key: a-result-of`, `inverse: results-in`). Same mechanics, different words: this tile shows *A result of 1*, the design card shows *Results in 1*, and the panel gives each type its own pair of lists. It carries no meaning beyond the link, so it stays visible even though the design card is done — only blocking fades when either end is finished.

## Question

Which format should a board export emit by default, and what does the flag look like for the other one?

## Answer

CSV by default, since that is what spreadsheets open without asking. JSON stays available behind `--json` for anyone scripting against it.

## Comments
- _2026-06-14 09:10 @agent:_ This whole note lives under its own `## Question` / `## Answer` headings, and the detail panel shows all of it — only the sections the plugin owns are cut off.
