# The theme domain

Everything that paints the plugin lives here. `index.css` is the bundle esbuild builds into `dist/styles.css`; it imports `tokens.css` first, then one file per section of the board. That order is not alphabetical and not cosmetic — several rules only beat the ones they refine because they come later in the file, as with link and icon-button refinements — so a guard or a test that reads the stylesheet reads it through this import list, never through a directory listing.

## The one rule: alias or owned

`tokens.css` holds one `.folia-scope` base block, followed by optional `.theme-light .folia-scope` and `.theme-dark .folia-scope` overrides. Every `--folia-*` token in it is one of two things:

- **an alias** of a CSS variable Obsidian's developer docs publish, written as exactly `var(--radius-m)`;
- **owned**, with a reason in its JSON metadata saying what Obsidian has no answer for.

A fallback does not change which of the two a token is. `var(--layer-menu, 65)` is still the board reading `--layer-menu`, so it stays an alias and the fallback is declared beside it — `"source": { "alias": "--layer-menu", "fallback": { "value": "65", "reason": "…" } }` — with the CSS reading exactly `var(--layer-menu, 65)`. A fallback is the one branch nothing can observe, so the guard asks it for a reason and, where the registry records a single documented default for that variable, asks it to agree with it rather than offer a second opinion. Before this rule a fallback quietly turned an alias into an owned value, which hid the relationship this layer exists to show.

Raw design values — a colour, a length with a unit, a duration, an angle, a weight, a shadow, a cursor — are allowed in `tokens.css` and nowhere else in the bundle. What a component file may name directly is a HOST variable: `var(--text-normal)`, `var(--divider-color)`, `var(--swatch-radius)`. That is not a loophole, it is the same contract one level down — the guard resolves every `var()` against the registry, so a component reading `--metadata-label-font-size` is making the same claim a token would, that Obsidian publishes this and means it here. Reach for a `--folia-*` token when two places need the value for the same reason, or when the value needs a name the host does not give it. The unitless numbers inside a `transform` are not among them: `scale(1.03)` is geometry the animation is made of, readable only next to the `translate` beside it, where `1.5deg` names a tilt that other rules share. Everything below `tokens.css` reads a `var()`, never a literal.

`host/variables.json` is the registry of what Obsidian documents. `pnpm theme:sync` regenerates it from a checkout of `obsidianmd/obsidian-developer-docs` — point `scripts/sync-host-variables.mjs` at that repository's `en/Reference/CSS variables` folder and commit the result, which records the commit it was read at. Re-sync when Obsidian ships a release whose docs add variables the board could use; the guard's answers change with the file, so the diff is the interesting part of that commit. `host/observed.json` is for the variables the running app defines but the docs do not list; each entry records the Obsidian version it was seen in and where, so the next reader can re-check it rather than trust it.

`pnpm theme:check` enforces all of this and prints the file, the line and what to do instead. What it deliberately leaves alone is listed at the top of `scripts/check-theme.mjs` rather than left to be discovered: whether a fallback can ever fire, which is a question only the running app answers; the unitless numbers inside a `transform`, left whole because a scale factor only reads next to the translate beside it; and a few properties whose numbers are counts rather than sizes.

A `calc()`, `min()`, `max()` or `clamp()` may use only `0`, `1`, `-1` and `2` as a plain number, which is what the theme needs today: negating a token, which CSS gives no other way to do, and a symmetric pair. That list is deliberately narrow rather than general — `calc(100% / 3)` for a three-column grid will fail — because a multiplier is usually a size someone chose. Widen it in `checkRawValues` when a real rule needs a number that is arithmetic rather than a decision, and say which rule in the commit.

## Which space a `color-mix` mixes in

Obsidian mixes colours in OKLCH as of 1.13, and its own documentation writes the idiom as `color-mix(in oklch, var(--color-red) 20%, transparent)`. The bundle follows that for every mix whose second colour is `transparent`, which is thirty-eight of the fifty-three: mixing a colour into `transparent` is pure alpha, so the two spaces rasterise to the same pixel and the change is free.

The fifteen that mix two opaque colours stay `in srgb`, and the reason is the same everywhere: the percentages were hand-tuned for contrast in both light and dark, the two spaces differ there by a few units per channel, and nothing in this repository can tell whether a re-tuned number still clears WCAG AA. `test/a11y.axe.test.tsx` disables the contrast rule because jsdom cannot compute one (`tracking/waivers/0002-automated-a11y-gate.md`), and what guards visual regression here is a structural-snapshot net plus this guard rather than a pixel diff — `tracking/waivers/0003-visual-regression-automation.md` retired itself on exactly that basis, and named the residual it accepted: a rendered-pixel change that alters no structure and no token. A re-tuned mix percentage is precisely that change. So it waits for a check. The audit's 02-09 has the measurements.

## Adding a token

1. Decide what it is FOR, and name it that. `size.hit-small`, not `size.24`.
2. Look for the value in `host/variables.json` first. If Obsidian documents a variable that means the same thing and carries the same default, the token is an alias of it — the guard will tell you so if you try to own it.
3. Declare it in the `.folia-scope` block of `tokens.css`, and add its metadata to the matching file in `tokens/`: `$value` (byte-identical to the CSS), `cssVar`, and `source` — either `{ "alias": "--radius-m" }` or `{ "owned": true, "reason": "…" }`.
4. If two places need the same value for the same reason, they share one token. The spacing rungs are that on purpose: a rung is the statement that everything on it moves together, which is what lets a later phase step the whole board onto Obsidian's grid in one edit instead of arguing it out three hundred times. A value that must be tunable on its own is not a rung, and gets its own name. If they need the same number for different reasons — a 24px hit target and a 24px margin — they are two tokens, and the later phase that moves one will thank you.

## Where the guard deliberately does not push

The guard asks an owned token to become an alias whenever Obsidian already documents that exact value, but only inside the family the token belongs to: the spacing grid, the radius ladder, the UI font sizes, the weight scale, the line heights, the border width. The icon-size scale and matching strokes also require aliases. `--layer-*` remains excluded because its numbers happen to collide with the board's in-leaf rungs without meaning the same thing. Cursors follow `--cursor` and `--cursor-link`. Everything else that is a plain length is measured against the grid whatever file it is filed under, so the answer cannot be changed by moving the JSON; a token that must not follow the grid keeps `owned` and adds `"despite": "--size-2-1"`, which puts the argument in the reason where a reviewer reads it.

Plain pixel lengths in spacing, size and runtime tokens must use the host grid, including arithmetic for dimensions larger than its published rungs. An off-grid exception must name the nearest rung with `despite` and explain why it cannot follow that rung.

Icon containers set `--folia-icon-size` and `--folia-icon-stroke` from the host icon scale. Only `.folia-icon` maps those tokens onto the documented `--icon-size` and `--icon-stroke` shorthands, so host-rendered Markdown does not inherit Folia's defaults. The two host properties may be assigned on the SVG rule; their values still pass the raw-value and variable checks. `Icon` reads them through CSS and has no numeric size prop.

## Scheme overrides

A token may add `themes.light` or `themes.dark` metadata containing its scheme-specific `$value` and `source`. The CSS override must match that value and appear in the corresponding rule in `tokens.css`. Rule D rejects other selectors, duplicate rules or declarations, overrides without a base token, missing metadata and non-token declarations in scheme rules. Source validation and cycle checks run for each scheme as well as the base. Both cycle walkers decode escapes, recognize function names case-insensitively and include fallback references. Component overrides are checked against every effective token map because a component, such as a portalled menu, can also carry `.folia-scope`. Component files cannot declare scheme overrides.

The five elevation shadows and the scrim use lighter light-mode values. Base values remain the dark-mode defaults. Declare scheme values on `.folia-scope` descendants of the theme class so body-portalled menus and dialogs receive them too.

`test/themeGeometry.test.ts` checks the compact-container size/stroke pairs, the default and empty-state scales, and isolation from rendered Markdown. These source contracts complement the DOM snapshots; they do not replace live layout checks. The icon token file also has a mutation test proving that rule E refuses an owned value matching the host icon scale.

The component cycle check is conservative: it checks possible overlap with a token scope rather than evaluating selectors and the CSS cascade. A descendant inherits already-computed custom-property values, so an apparent dependency loop spanning ancestors and descendants is not itself a browser cycle. The guard still rejects an override that would close a loop if placed on the scope element. It is not a proof covering every combination of component selectors.

## Button faces and specificity

Button rules use `.folia-scope .folia-btn` and the same scope for their variants and states. The existing board and portal scopes provide enough specificity to beat the host plain-button rule without repeating a class. Keep base rules before their refinements; disabled hover exclusions use `:where()` so they do not outweigh selected states.

Neutral controls read `--interactive-normal` and `--interactive-hover`. Raised buttons retain the host input shadow; flat links, icon buttons and menu rows declare their shadow beside their own face. Chips and swatches keep their semantic geometry and selection rings. The host button and icon radiuses apply to their corresponding controls, while the accent focus outline follows the decision in `docs/decisions.md`.
