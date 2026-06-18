# Waiver: DS-A11Y-* — Automated a11y gate landed; substantially remediated, 4 behavioral items remain

| Field | Value |
| --- | --- |
| **Rule violated** | The **DS-A11Y-\*** Accessibility Baseline family (`spec.md` §5), enforced via the **Accessibility checks** conformance category (`DS-PROCESS-CONFORMANCE-1` #4). The remaining items map to DS-A11Y-MODAL-6 (`aria-modal` without focus trap / inert background), DS-A11Y-DISCOVERABLE-4 (no keyboard path to a pointer-only reveal), and DS-A11Y-TARGET-10 / color-contrast (unmeasurable in jsdom — needs a real-browser audit). |
| **Status** | `active` |
| **Owner** | @stavarengo |
| **Created date** | 2026-06-18 |
| **Expiry date** | 2026-09-30 |
| **Scope** | The automated a11y gate is now installed and enforced; what remains is a small, specific set of **behavioral** interaction gaps in `src/ui/` (focus-trap + `inert`, keyboard access to the card context menu, arrow-key reach to the priority radio group) plus one **measurement** gap (color-contrast, not evaluable in jsdom). Limited to `src/ui/`. |

## Reason

The a11y *contracts* were always real and documented — the per-component / per-pattern Accessibility sections capture the intended behavior, and a genuine baseline exists in code (keyboard DnD, focus management, roles/names, `:focus-visible`), so DoD item 11 was honestly MET. The **enforcement toolchain has now been delivered and the bulk of the documented gaps are closed**, but a handful of behavioral interaction gaps and one measurement gap remain. This waiver stays **active** to track that remaining scope honestly rather than overclaiming completion — an earlier `retired` marking that cited only a color-contrast residual understated the work that is still open.

## Risk

**Reduced, not eliminated.** The baseline is now enforced by an automated gate, so a change that regresses an a11y contract is caught rather than landing silently, and `0 serious/critical` axe violations are confirmed in the unit-test environment. The residual risk is concentrated in the four items below: modal dialogs (`ColumnEditModal`, modal `CardDetail`) declare a modal role without a real focus trap or background `inert`, so focus can escape behind the dialog; the card context menu is pointer-only, leaving keyboard users without a path to it; arrow-key navigation inside `CardContextMenu` doesn't reach the priority radio group; and color-contrast can't be measured here. Each is a targeted, manually-tested interaction fix rather than a systemic gap.

## Resolution

The automated a11y gate is installed and enforced. It is **two-layered**:

- **Static** — `eslint` + `eslint-plugin-jsx-a11y`, exposed as the `lint:a11y` script.
- **Runtime** — `vitest-axe` over the UI suite, exposed as the `test:a11y` script.

Both layers run under `ds:check` and the `lefthook` pre-commit/pre-push hooks, so the gate blocks regressions locally and in CI.

**Done:**

- Automated a11y gate installed and **enforced** in `ds:check` / `lefthook` — static (`eslint` + `jsx-a11y`, `lint:a11y`) and runtime (`vitest-axe`, `test:a11y`).
- **0 serious/critical** axe violations in the unit-test environment.
- Landmarks added: board `role=region`, toolbar `role=search`.
- Dialog panels use `div role=dialog` (fixing the prior false `aria-modal` / region / `aria-prohibited-attr` / `aria-allowed-role` / banner-landmark findings).
- Column-count badge uses `role=img`.
- Combobox now exposes `aria-activedescendant` + per-option `id`s.
- `ColumnMenu` delete-confirm now uses `role=alertdialog`.
- Dead `jsx-a11y` `eslint-disable` directives removed; the few remaining disables are justified (dnd-spread / dialog-keyboard false positives).

**Remaining (why this waiver stays `active`):**

1. **Modal focus-trap + background `inert` not implemented** (`ColumnEditModal`, modal `CardDetail`) — focus can leave the open dialog into the page behind it.
2. **`CardItem` context menu has no keyboard path** — it opens via `onContextMenu` / right-click only, so keyboard users cannot reach it.
3. **`CardContextMenu` arrow-key navigation doesn't reach the priority radio group** — the radio group is skipped by the menu's roving focus.
4. **`color-contrast` unmeasurable in jsdom** — axe cannot compute rendered colors in the unit-test environment; this needs a real-browser / Lighthouse audit.

These are careful, manually-tested interaction changes and are tracked under this waiver until each is delivered.

## Exit plan

Close this waiver only when all four remaining items are delivered and verified: (1) a real focus trap + background `inert` on the modal dialogs, (2) a keyboard path to the `CardItem` context menu, (3) arrow-key navigation that reaches the priority radio group in `CardContextMenu`, and (4) a real-browser / Lighthouse color-contrast audit confirming the palette passes. The per-component and per-pattern **Accessibility contracts** in `docs/design-system/components/` and `docs/design-system/patterns/` are the enforced source of truth, with the two-layer automated a11y gate (`lint:a11y` + `test:a11y`, run under `ds:check` / `lefthook`) as the conformance mechanism for `DS-PROCESS-CONFORMANCE-1` #4.
