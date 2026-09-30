# The theme domain

Everything that paints the plugin lives here. `index.css` is the bundle esbuild builds into `dist/styles.css`; it imports `tokens.css` first, then one file per section of the board. That order is not alphabetical and not cosmetic — several rules only beat the ones they refine because they come later in the file, as with the link refinements — so a guard or a test that reads the stylesheet reads it through this import list, never through a directory listing.

## Obsidian's variables first

A rule reads the host variable that describes its object: `var(--background-primary)`, `var(--size-4-2)`, `var(--radius-l)`, `var(--font-ui-small)`. "Documented" means Obsidian's developer docs, the pages under `Reference/CSS variables`, and nothing else: a variable the app happens to define but the docs do not list is off-limits, however stable it looks (the `--shadow-*` and `--anim-*` families, `--menu-shadow`, `--background-modifier-cover`, `--font-monospace`). The legal way to get the host's elevation or motion is an API component, which brings its own CSS. `docs/decisions.md`, "A host variable has to describe the object, not sit near it", has the cases where a documented name still did not fit.

A value Obsidian publishes nothing for is written where it is used when one rule needs it (`backdrop-filter: blur(3px)`, `cursor: grab`, `transition-duration: 0.01ms`), and named in `tokens.css` when several rules must move together or the board decides it against a published default. Every name there carries its reason on its line or right above it, and `docs/decisions.md`, "The board's own design values", says why the list is what it is. The rest of `tokens.css` is channels: names the board's code, or a component rule, writes onto an element below the block, declared there with the value everything else reads. Colours are the exception to "write it where it is used": a raw colour belongs to the theme, so the only ones in the bundle are the elevation shadows in `tokens.css`.

The block hangs off `.folia-scope`, not the board root, because the drag overlay, the detail dialog's content and the edit-column swatch row live outside the root. `pnpm portals:check` keeps each of those carrying the class, and keeps it off anything portalled back inside, where it would re-declare the channel defaults below the live values.

## The allowlist and the floor

`host/variables.json` lists exactly the host variables the board reads, in the stylesheet or as a `var(--x)` in its code (the column palette included, read through `columnAccent`), each as the docs describe it, with the docs commit it was read at. It is generated, not edited: clone `obsidianmd/obsidian-developer-docs` at the commit to pin and run `pnpm theme:sync <checkout>`; `pnpm theme:sync <checkout> --check` fails if the file differs from what the docs say at that commit, including a read the docs do not list. Reading a new host variable therefore means re-running the sync, and the diff is the review.

`host/floor.json` lists every variable Obsidian `manifest.json`'s `minAppVersion` declares, and where that list came from. Nothing warns when a variable is missing at runtime (the property quietly inherits), so every name on the allowlist must be in it. Raising `minAppVersion` means regenerating it for the new version, from that release's app bundle, the way its `source` field describes.

## What `pnpm theme:check` enforces

The header of `scripts/check-theme.mjs` lists the rules and the file prints the line and what to do instead: every `var()` is on the allowlist or a name `tokens.css` declares; `tokens.css` holds only the scope block, its light and dark overrides and a reason for each name; nothing declared goes unread or leads back to itself; only the names after its `Channels:` comment may be written, by a component rule or by the board's code; no raw colour outside `tokens.css`; the allowlist matches what is read and the floor has all of it; buttons keep their scoped faces; and no focus rule removes the outline. It reads declarations, not the cascade, and it does not decide whether a documented variable fits its use. That part is review, and `docs/decisions.md` records it.

## Which space a `color-mix` mixes in

Obsidian mixes colours in OKLCH as of 1.13, and its own documentation writes the idiom as `color-mix(in oklch, var(--color-red) 20%, transparent)`. The bundle follows that for every mix whose second colour is `transparent`, which is thirty-seven of the fifty-five: mixing a colour into `transparent` is pure alpha, so the two spaces rasterise to the same pixel and the change is free.

The eighteen that mix two opaque colours stay `in srgb`, where the two spaces differ by a few units per channel and every percentage was set against a contrast in both light and dark. The chip, link, missing-link and context-chip percentages were measured in a live Obsidian on 2026-09-29, see `docs/decisions.md`. `test/a11y.axe.test.tsx` disables the contrast rule because jsdom cannot compute one, so contrast is checked by hand with `pnpm contrast:live` (the script's header says how to start an Obsidian for it); it is not part of `pnpm verify`. What guards visual regression here is a structural-snapshot net rather than a pixel diff — `tracking/waivers/0003-visual-regression-automation.md` retired itself on that basis, and named the residual it accepted: a rendered-pixel change that alters no structure. A re-tuned mix percentage is precisely that change, so run `pnpm contrast:live` again after one.

## Scheme overrides

The elevation shadows are the only values that differ by scheme: `tokens.css` declares the dark ones in the base block and the light ones in `.theme-light .folia-scope`, a descendant of the theme class so a portalled surface receives them too. A component file never declares a scheme override.

Icon containers set the `--folia-icon-size` and `--folia-icon-stroke` channels from the host icon scale. Only `.folia-icon` maps them onto the documented `--icon-size` and `--icon-stroke` shorthands, so host-rendered Markdown does not inherit Folia's defaults. `Icon` is a slot the host draws its own Lucide icon into (`setIcon`), and the host's `svg-icon` rule sizes and strokes that icon from those two shorthands, so the slot sets no size of its own and has no numeric size prop.

`test/themeGeometry.test.ts` checks the compact-container icon size and stroke pairs, the sums the card's hover cluster and the drag overlay are built from, the hit-size floor, the drop animation's copy of the easing curve, and that every column colour is on the allowlist and in the floor. These source contracts complement the DOM snapshots; they do not replace live layout checks.

## Focus in forced-colours mode

A text field that hides its outline on `:focus` signals focus with its border and `--folia-ring`, and forced-colours mode (Windows High Contrast) drops every box-shadow and repaints every border in one system colour. So such a field writes `outline: var(--folia-focus-ring-w) solid transparent` rather than `none`: it draws nothing itself and is repainted in a system colour when colours are forced. `theme:check` refuses `outline: none` on a focus selector. It reads declarations, not the cascade: `.folia-desc` and `.folia-comment-edit` tie with `.folia-scope :focus-visible`, which loads later and draws the accent outline on them in every mode. The toolbar search is Obsidian's own field and hides nothing, so the board's accent outline marks it in every mode.

## Button faces and specificity

Text and icon buttons are Obsidian's own components, mounted through `src/ui/hostControls.tsx`, and wear the host's faces. Folia dresses them only through its own classes on their elements (`folia-btn`, `folia-card-action`, `folia-mini`…), never through the classes the component puts on itself. Every mounted control also wears `folia-host-control`, through which `host-controls.css` removes the host's focus ring so the board's accent outline is the only one.

The `<button>`s the board still draws are the groups `docs/decisions.md` names as staying hand-drawn. Their rules use `.folia-scope` plus their own class to beat the host plain-button rule. Keep base rules before their refinements; hover exclusions use `:where()` so they do not outweigh selected states. Bordered tiles and chips keep their resting fills during pointer states; flat links declare their shadow beside their own face. Chips and swatches keep their semantic geometry and selection rings.

To see the host controls live, open the Feature Showcase board and follow "Buttons, dropdowns and the progress bar are Obsidian's own" in `examples/README.md`: each control focused from the keyboard should show the accent outline alone. A dropdown focused by a click shows no ring, as every dropdown in Obsidian does (see `docs/decisions.md`).

`theme:check` calls `scripts/theme-buttons.mjs`. It fails a JSX `<button>` anywhere under `src` that wears none of the hand-drawn groups' base classes or that a later spread could re-class, a `HostButton` or `HostIconButton` whose `className` is not written out, and a group whose `docs/decisions.md` entry is gone. It also checks scoped face selectors and unconditional resting background/colour/shadow coverage. Only top-level rules count toward resting coverage; nested rules, including `@media`, `@supports`, `@container` and cascade layers, may refine that base but cannot replace it. Only the filter chip and column-add classes deliberately inherit the host shadow. The check parses selectors and rejects button subjects without a direct Folia class, including subjects inside `:is()` and `:where()` branches, so no rule reaches host-rendered Markdown buttons. It enforces the supported selector shape instead of calculating arbitrary specificity. It fails a later rule that sets a hover colour on the card and panel icon buttons, or on Mark done and Delete themselves, which would repaint their hover, but does not prove that arbitrary state refinements win against each other.

Hover and pressed outlines use a Folia-owned width and the control's label colour, because host fill pairs may be identical and shadows may be absent. These signals are separate from selected-filter fills, choice rings and keyboard focus. `docs/decisions.md` records the measured collisions and the per-control choices.

The button guard pins the pointer-outline selectors, including their fixed owned widths. These checks prevent removal of known signals; they do not compute contrast or resolve arbitrary state interactions.
