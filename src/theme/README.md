# The theme domain

Everything that paints the plugin lives here. `index.css` is the bundle esbuild builds into `dist/styles.css`; it imports `tokens.css` first, then one file per section of the board. That order is not alphabetical and not cosmetic — several rules only beat the ones they refine because they come later in the file, which `base.css` explains — so a guard or a test that reads the stylesheet reads it through this import list, never through a directory listing.

## The one rule: alias or owned

`tokens.css` holds the `.folia-scope` block and nothing else. Every `--folia-*` token in it is one of two things:

- **an alias** of a CSS variable Obsidian's developer docs publish, written as exactly `var(--radius-m)` with no fallback;
- **owned**, with a reason in its JSON metadata saying what Obsidian has no answer for.

Raw design values — a colour, a length with a unit, a duration, an angle, a weight, a shadow, a cursor — are allowed in `tokens.css` and nowhere else in the bundle. The unitless numbers inside a `transform` are not among them: `scale(1.03)` is geometry the animation is made of, readable only next to the `translate` beside it, where `1.5deg` names a tilt that other rules share. Everything below `tokens.css` reads `var(--folia-…)`.

`host/variables.json` is the registry of what Obsidian documents. `pnpm theme:sync` regenerates it from a checkout of `obsidianmd/obsidian-developer-docs` — point `scripts/sync-host-variables.mjs` at that repository's `en/Reference/CSS variables` folder and commit the result, which records the commit it was read at. Re-sync when Obsidian ships a release whose docs add variables the board could use; the guard's answers change with the file, so the diff is the interesting part of that commit. `host/observed.json` is for the variables the running app defines but the docs do not list; each entry records the Obsidian version it was seen in and where, so the next reader can re-check it rather than trust it.

`pnpm theme:check` enforces all of this and prints the file, the line and what to do instead. Two gaps in it are chosen rather than missed, and `scripts/check-theme.mjs` names both at the top: a host variable read with a fallback counts as owned and is never asked whether the fallback can still happen, which is what keeps the inherited colour literals alive until the phase that removes them; and the unitless numbers inside a `transform` are left alone, because a scale factor only reads next to the translate beside it.

## Adding a token

1. Decide what it is FOR, and name it that. `size.hit-small`, not `size.24`.
2. Look for the value in `host/variables.json` first. If Obsidian documents a variable that means the same thing and carries the same default, the token is an alias of it — the guard will tell you so if you try to own it.
3. Declare it in the `.folia-scope` block of `tokens.css`, and add its metadata to the matching file in `tokens/`: `$value` (byte-identical to the CSS), `cssVar`, and `source` — either `{ "alias": "--radius-m" }` or `{ "owned": true, "reason": "…" }`.
4. If two places need the same value for the same reason, they share one token. The spacing rungs are that on purpose: a rung is the statement that everything on it moves together, which is what lets a later phase step the whole board onto Obsidian's grid in one edit instead of arguing it out three hundred times. A value that must be tunable on its own is not a rung, and gets its own name. If they need the same number for different reasons — a 24px hit target and a 24px margin — they are two tokens, and the later phase that moves one will thank you.

## Where the guard deliberately does not push

The guard asks an owned token to become an alias whenever Obsidian already documents that exact value, but only inside the family the token belongs to: the spacing grid, the radius ladder, the UI font sizes, the weight scale, the line heights, the border width. Three families are left out on purpose, because adopting each is a decision of its own that the repository has scheduled separately: Obsidian's cursor convention (`--cursor` / `--cursor-link`), its icon-size scale, and its `--layer-*` stack, whose numbers happen to collide with the board's in-leaf rungs without meaning the same thing. `scripts/check-theme.mjs` says the same thing next to the code that does it. Everything else that is a plain length is measured against the grid whatever file it is filed under, so the answer cannot be changed by moving the JSON; a token that must not follow the grid keeps `owned` and adds `"despite": "--size-2-1"`, which puts the argument in the reason where a reviewer reads it.
