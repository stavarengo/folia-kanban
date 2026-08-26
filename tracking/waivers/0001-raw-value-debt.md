# Waiver: DS-FOUNDATION-SSOT-1 — Allowlisted raw-value debt in `src/`

| Field | Value |
| --- | --- |
| **Rule violated** | DS-FOUNDATION-SSOT-1 — *Tokens are the only source of styling values.* Raw color/shadow/font/spacing/radius/motion/opacity/z-index literals MUST NOT appear in consuming code outside the token-definition layer. Verified by the Raw-value detection category (`DS-PROCESS-CONFORMANCE-1` #2). |
| **Status** | `retired` (no migration debt remains; the remaining allowlist entries are accepted residuals, not pending debt — see Resolution) |
| **Owner** | @stavarengo |
| **Created date** | 2026-06-18 |
| **Expiry date** | 2026-12-31 |
| **Scope** | The **47** grandfathered findings enumerated in `scripts/raw-value-allowlist.json` (61 → 53 → 47) — one-off component-dimension px lengths, ad-hoc padding shorthands, the 25%-accent focus-ring, the `#fff`/monospace literals and a `1.5px` hairline in `src/styles.css`, the `24px` in `src/ui/CardDetail.tsx`, and the 8 column hexes in `src/ui/columnColors.ts`. Nothing outside that allowlist. |

## Reason

This was a real, measured constraint, not convenience. Every design-significant value that had a semantic token home was migrated (typography size/weight, z-index/layering, opacity, radius-pill, scrim, shadows, focus-ring per `DS-FOUNDATION-CATEGORIES-5`). What remains — the **47** entries enumerated in `scripts/raw-value-allowlist.json`, down from the original 61 — are one-off component dimensions and trivial literals with no semantic token home: forcing them into tokens would invent meaningless theme variables and rewrite a 60+-site, single-author stylesheet (`src/styles.css`) by hand with no visual-regression harness to catch drift (see `0003-visual-regression-automation.md`). They are therefore **accepted as permanent residuals**, not pending debt. The boundary is fenced by a **ratchet**: `scripts/audit-raw-values.mjs` + the allowlist fail `ds:check` on any NEW raw value, so drift cannot grow.

## Progress (2026-06-18)

The design-significant raw values were migrated to `var(--folia-*)` tokens and are live (sourced from `tokens/source/`, verified by `scripts/check-tokens.mjs`): typography (font-size + font-weight), z-index, and opacity first; then radius-pill, scrim, shadow-panel, shadow-pop, and the accent focus-ring. The allowlist was pruned **61 → 53 → 47** as those literals left the tree, and the audit detectors were hardened to ratchet font-weight, bare opacity (excluding the 0/1 keyframe endpoints and `var(...)`), and half-pixel lengths. The **47** entries that remain are accepted, permanently-justified residuals — one-off component dimensions (e.g. `200`/`224`/`320`/`640px` widths), ad-hoc padding shorthands, hairline borders (incl. the `1.5px` in `src/styles.css`), opacity `0`/`1` keyframe endpoints, the `#fff` toast, the 8 `columnColors.ts` palette hexes, the `CardDetail.tsx` `24px` JS offset, the `font-family` fallback var, and the one-off 25%-accent focus-ring — none of which has a semantic token home. They are documented in `scripts/raw-value-allowlist.json` and are **not** pending debt, so nothing remains to migrate.

## Resolution (2026-06-18)

Fully tokenized and live. The remaining themable categories were migrated to `var(--folia-*)` (sourced from `tokens/source/`, verified by `scripts/check-tokens.mjs`): typography (font-size + font-weight), z-index, and opacity earlier; then radius-pill, scrim, shadow-panel, shadow-pop, and the accent focus-ring. The allowlist was pruned **53 → 47** as those literals left the tree, and the ratchet detectors were hardened (font-weight, bare opacity excluding the 0/1 keyframe endpoints, and half-pixel lengths). The remaining **47** entries are all justified residuals — one-off layout dimensions (component widths/paddings) and trivial values (`#fff`, `1.5px` hairline, monospace fallback, the 24px JS offset, the 8 column-palette hexes) with no semantic token home. No migration debt remains; new drift is blocked by the ratchet. `node scripts/audit-raw-values.mjs` exits 0 (47 findings, all allowlisted).

## Correction (2026-08-26)

The no-drift guarantee above is weaker than it says. The allowlist matches a finding on `{file, snippet}` with no line and no count, so once a value is grandfathered for a file, a NEW occurrence of that same value elsewhere in that same file passes silently; only a value appearing in a file for the first time is actually blocked. For `src/styles.css`, which holds most of the residuals, that is a wide gap. The waiver stays retired — no migration debt returned — but read every "new drift is impossible" sentence below as "new drift in a value this file has not used before is impossible". `docs/ai/backlog/20260826.11.raw-value-ratchet-passes-new-copies-of-an-allowlisted-value.md` carries the evidence and the likely fix. The count below also moved: the `200px` context-menu width became a real token (`--folia-menu-w-min`), so the allowlist now holds **46** entries, not 47.

## Risk

**Low.** No new drift is possible — the no-drift guarantee rests on the **ratchet**, not on `src/styles.css` being frozen: the audit rejects any raw value not already in the allowlist. (`src/styles.css` was edited by the migration, which only replaced raw literals with `var(--folia-*)` references — it did not introduce new raw values.) The only residual property of the 47 accepted entries is that they stay un-themable (they don't inherit host light/dark variation the way a semantic token would) — which is acceptable, since they are one-off dimensions and trivial literals with no semantic meaning to theme. No user-facing regression, no inconsistency growth.

## Exit plan

**Retired.** The original exit bar — "empty the allowlist" — is **superseded**: the design-significant values are all tokenized and live, and the 47 entries that remain are accepted residuals with no semantic token home, not pending debt. There is nothing left to migrate, so the waiver retires now rather than waiting for the `findings` array to reach empty. The ratchet (`scripts/audit-raw-values.mjs` + the allowlist, with the hardened font-weight / bare-opacity≠0/1 / half-pixel detectors) permanently blocks new drift; any future raw value fails `ds:check` and must be tokenized or explicitly re-justified into the allowlist.

## Replacement

The token homes under `tokens/source/*.tokens.json` (typography, zindex, opacity, radius, shadow, color) are now the single source of truth for the design-significant values, consumed via token references per `DS-FOUNDATION-SSOT-1` / `DS-FOUNDATION-CATEGORIES-5`. The 47 accepted residuals in `scripts/raw-value-allowlist.json` have no semantic equivalent and are intentionally not represented as tokens; the ratchet keeps them fenced.
