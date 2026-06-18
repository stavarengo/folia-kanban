# Waiver: DS-PROCESS-CONFORMANCE-1 #5 — No automated visual-regression harness

| Field | Value |
| --- | --- |
| **Rule violated** | **DS-PROCESS-CONFORMANCE-1**, conformance category **#5 "Visual regression"** — *visual output is protected against unintended change.* (No dedicated `DS-VISUAL-*` rule exists; this is the category that mandates the check.) Satisfied under **DS-PROCESS-CONFORMANCE-4 — Proportionate enforcement**, which requires the category be enforced but lets the *mechanism* be chosen for proportionality. |
| **Status** | `retired` |
| **Owner** | @stavarengo |
| **Created date** | 2026-06-18 |
| **Expiry date** | 2027-06-18 (no longer enforced — retained for history) |
| **Scope** | The absence of an automated screenshot / pixel-diff visual-regression harness for the plugin UI. Limited to the visual-regression conformance category; all other categories (token validation, raw-value detection, spec coverage, a11y) are unaffected. |

## Reason

Retired: the visual-regression conformance category is now enforced by a proportionate mechanism wired into `ds:check`, so this waiver is resolved. There is still no Storybook or standalone component-preview harness, and an Obsidian plugin renders only inside the host app — but a full pixel-diff harness (headless host, snapshot baselines, flake management) remains disproportionate for a solo repo. Per `DS-PROCESS-CONFORMANCE-4` the category is enforced by a lighter-weight mechanism instead of the heaviest tool: a **structural-snapshot regression net** (`test:visual`, `test/visual-regression.test.tsx`) that snapshots the focused outerHTML of the stable token-consuming units (a rendered `.folia-card`, a `.folia-column-header`), paired with the **token drift-check** (`tokens:check`, `scripts/check-tokens.mjs`) that guards the token↔consumer mapping.

## Risk

**Low, and now actively guarded.** Styling is centralized in one `src/styles.css`; the token drift-check guards the token↔consumer mapping, the raw-value ratchet blocks new literals, and the structural-snapshot net catches unintended changes to the class/attribute scaffolding the tokens hang off of. The residual gap is a *rendered-pixel* change that alters no structure and no token — caught by manual review through the `examples/` vault until (and unless) a pixel-diff harness is adopted. This residual is accepted as proportionate for an in-Obsidian-rendered solo plugin.

## Resolution

The visual-regression category is satisfied by two checks that together form the safety net, both wired into `ds:check`:

1. **Structural-snapshot regression net** — `test/visual-regression.test.tsx` (`pnpm test:visual`) renders a representative board and snapshots small, targeted units (`.folia-card`, `.folia-column-header`) so unintended structural change to token-consuming markup fails the gate.
2. **Token drift-check** — `scripts/check-tokens.mjs` (`pnpm tokens:check`) guards the token↔consumer mapping.

A full pixel-diff / browser harness (Storybook + Playwright or equivalent) is **intentionally deferred** as disproportionate for a plugin that renders only inside Obsidian in a solo repo; if such a harness is ever adopted, a screenshot/pixel-diff stage can be added under `ds:check` at that point. No renewal is required: this waiver is closed, not renewed.

## Replacement

The standing mechanism for `DS-PROCESS-CONFORMANCE-1` #5, at a cost proportionate to a solo repo: the **structural-snapshot regression net** (`test:visual`) + the **token drift-check** (`tokens:check`), both enforced in `ds:check`, complemented by the **`examples/` vault** for manual visual review of pure-pixel changes.
