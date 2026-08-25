# Waiver: 0004 — legacy file size + function complexity

> Pre-existing files that exceed the §25 size/complexity limits enabled when the strict
> agent-control harness landed. The rules are ON for all new code; these files are relaxed
> until they are split, per the blueprint's existing-project migration order (§35 Phase 3).

| Field | Value |
| --- | --- |
| **Rule violated** | ESLint `max-lines` (400), `max-lines-per-function` (80), `complexity` (10) — blueprint §25 |
| **Status** | `active` |
| **Owner** | @stavarengo |
| **Created date** | 2026-06-18 |
| **Expiry date** | 2026-12-31 (review — split the worst offenders before this) |
| **Scope** | Exactly the 15 files listed in the `eslint.config.mjs` override block. `max-params` and `max-depth` are NOT waived (already within limits). Every other file is fully gated. |

## Reason

These files predate the §25 guard. Refactoring all 15 in the same change that introduces the
guard would be a large, high-risk diff across the drag-and-drop board, forms, and the parse/model
core — exactly what the blueprint's §35 warns against ("do not refactor everything at once").
The guard is enabled now so **new** bloat is blocked; the existing debt is tracked here with an
exit plan rather than hidden.

## Risk

While this waiver is live, the listed files can keep growing without the size/complexity guard.
Mitigation: new files are fully gated, and the worst offenders are scheduled for splitting first.

## Current offenders (worst first)

```text
src/ui/CardDetail.tsx   file 767 lines; CardDetail() 626 lines, complexity 32
src/ui/App.tsx          file 544 lines; App() 484 lines, complexity 19; effects arrow 208 lines
src/ui/CardItem.tsx     CardItemInner() 274 lines, complexity 50
src/ui/Column.tsx       Column() 322 lines, complexity 33
src/ui/Board.tsx        Board() 229 lines, complexity 11
src/ui/Toolbar.tsx      Toolbar() 165 lines, complexity 12
src/ui/ColumnEditModal.tsx  ColumnEditModal() 214 lines
src/ui/ColumnMenu.tsx   ColumnMenu() 164 lines
src/ui/CardContextMenu.tsx  CardContextMenu() 162 lines
src/main.ts             SettingTab.display() 124 lines
src/model/columns.ts    normalizeColumns() complexity 26; an arrow complexity 13
src/model/board.ts      buildBoard() complexity 28; planDrop() complexity 11
src/obsidian/vaultRepo.ts  loadContexts() complexity 14
src/ui/cardView.ts      matchToken() complexity 12
src/model/card.ts       a parse arrow complexity 12
```

## Exit plan

Split top-down, removing each file from the `eslint.config.mjs` override as it clears the limits:

1. **UI components** — extract sub-components and custom hooks (e.g. `CardDetail` → header / body /
   comments / history sections; `CardItem` → presentational + interaction hook; `Column` →
   header + body + composer). The structural visual-regression snapshot + a11y axe gate guard
   these refactors.
2. **Model functions** — `normalizeColumns` / `buildBoard` split into smaller pure helpers; covered
   by the existing unit tests (`columns.test.ts`, `board.test.ts`).
3. Re-run `pnpm lint`; drop each file from the override block once green; retire this waiver when
   the list is empty.

## Replacement

The §25 ESLint limits become the sole gate once the files are split — no waiver, no override block.
