# Design Tokens — Source

Machine-readable source of truth for the design tokens of `folia-kanban`. One file per category, W3C Design-Tokens-style nested JSON. These files document the token surface; **`src/styles.css` stays hand-authored** — there is no live generator (see "Drift-check model" below).

## Files

| File | Category | Live in `styles.css` block? |
| --- | --- | --- |
| `color.tokens.json` | semantic colors + priority ramp + `column` product palette | semantic + priority: yes · `scrim`: new · `column`: checked vs `src/ui/columnColors.ts` |
| `typography.tokens.json` | font-size + font-weight scale | **NEW** — no var yet |
| `spacing.tokens.json` | spacing | yes |
| `radius.tokens.json` | corner radius | sm/md/lg/xl: yes · `pill`: new |
| `shadow.tokens.json` | elevation + focus ring | card/card-hover/overlay/pop: yes · `ring`/`panel`: new |
| `motion.tokens.json` | duration + easing | yes |
| `size.tokens.json` | layout / hit-target | yes |
| `zindex.tokens.json` | z-index ladder | **NEW** — no var yet |
| `opacity.tokens.json` | standalone UI opacity | **NEW** — no var yet |

## Naming rules

1. **Name by intended USAGE, never by appearance.** `shadow.ring` (it's the focus ring), not `shadow.blue-glow`. `opacity.disabled`, not `opacity.0-4`. `zindex.modal`, not `zindex.80`.
2. **File = category group; leaf = token.** The nested path maps to a CSS var as `--folia-<group>-<name>` only where a var exists; the exact var name is recorded explicitly (rule 4) because usage-names do not map to var-names by string (e.g. `radius.md` → `--folia-r`, `radius.sm` → `--folia-r-sm`).
3. **Semantic tokens reference primitives where applicable.** Colors that share a single source resolve through `color.primitive.*` via `{color.primitive.red}`-style refs. `color.danger` and `color.priority.1` both reference `color.primitive.red` because both are `var(--color-red, #e5534b)` in the CSS today. Categories with no shared source (spacing, radius, z-index, opacity, typography) keep flat values — there are no applicable primitives to reference.
4. **Every token that maps to a live CSS var records it** under `$extensions.folia.cssVar`, with `live: true`. Tokens whose value still exists raw in `styles.css` but has no `--folia-*` var yet carry `live: false`. The `color.column.*` palette tokens carry no `$extensions.folia` at all — they are not block-derived and are verified by check-direction 2 (against `columnColors.ts`), not by the live flag. This `cssVar` annotation is what lets check-direction 1 map a usage-name back to its CSS var.
5. **Obsidian `var()` references are preserved verbatim** as the `$value` string (e.g. `var(--background-modifier-border)`), never resolved or normalized.
6. **Deprecation:** mark a superseded token with `$deprecated: true` and `$extensions.folia.replacement` pointing at the successor token path. (No token is deprecated today; this documents the convention for future use.)

## Values

Token `$value`s **byte-match the LIVE `src/styles.css`** — including whitespace inside functions, e.g. `rgba(0, 0, 0, 0.16)` (with spaces). Where the upstream token-inventory dropped that spacing, the CSS is authoritative.

For tokens that reference a primitive, the literal CSS string is also recorded under `$extensions.folia.resolvedValue` so the check can byte-compare without a resolver.

## Drift-check model

**CSS is the sole consumer of the `--folia-*` token block. There is NO live generator** (no JSON→CSS emit). A full scan of `src/**/*.ts(x)` found no JavaScript that *reads* any `--folia-*` value; JS only writes a few passthrough vars. With exactly one output target — a single hand-maintained stylesheet — a generator's source-of-truth handoff costs more than it returns. So these JSON files are verified *against* the code, not used to *produce* it.

A check script (to be wired into CI + pre-commit) asserts two directions:

1. **JSON ↔ `styles.css`** — for every token with `$extensions.folia.live: true`, the script reads the `.folia-scope { … }` block in `src/styles.css`, finds the declaration named by `$extensions.folia.cssVar`, and asserts its value byte-matches the token's `$value` (using `resolvedValue` when the `$value` is a `{ref}`). It also asserts no live `--folia-*` declaration in the block is missing from the JSON. This is a bijection over the **live subset only**.
2. **`color.column` ↔ `src/ui/columnColors.ts`** — the script asserts the 8 `color.column.*` hexes equal, in order, the `COLUMN_COLORS` array exported by `src/ui/columnColors.ts`. That file is the single source of truth for the palette and is already imported by `src/ui/ColumnEditModal.tsx`, `src/ui/ColumnMenu.tsx`, and `src/ui/Column.tsx` (the palette is no longer duplicated across those files), so this half of the check is ready to run.

Tokens with `live: false` (all of `typography`/`zindex`/`opacity`, plus `radius.pill`, `shadow.ring`, `shadow.panel`, `color.scrim`) are **not** part of the bijection. They are the just-created *home* for values that still live raw in `styles.css`; the check does not assert them against the block until the corresponding `--folia-*` var is adopted in CSS. Adopting a var flips its token to `live: true`, at which point direction 1 begins enforcing it.
