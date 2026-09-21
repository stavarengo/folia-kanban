# Decisions

Things deliberately *not* built, and why. Each entry records what was tried, what the constraint was, and what would have to change for the answer to change — so the same ground is not spiked a second time. A decision here is not a promise: bring it back when its "what would change this" actually happens.

## The board and a Markdown editor side by side, in one tab

**Decided 2026-08-26. Stays out until Obsidian exposes a supported way.**

The wish is a board note showing the board and a narrow, editable Markdown editor of the same note at once, in **one tab** — not two tabs, not an Obsidian split. That single-tab constraint is the whole point of the request: it exists so editing the note's frontmatter and watching the board react is one glance. Anything that ends up as two panes in the workspace is a different feature, and Obsidian already does that one.

A spike against the live API (Obsidian 1.7.2, the `examples` vault) settled feasibility while the board-vs-Markdown *swap* was being built:

- A `WorkspaceLeaf` carries a single `view`, so two views in one tab can only mean the board's own view drawing both panes inside itself.
- A live, editable Markdown editor **can** be hosted in an arbitrary DOM container: construct a leaf, attach its `containerEl` to a plain `div`, call `setViewState({ type: 'markdown', state: { file } })`. Typing into it and calling `view.save()` wrote the bytes to disk, and re-parenting the container left the editor intact.
- But there is no public way in: the only route to a leaf is `new (someLeaf.constructor)(app)`, a minified runtime constructor. For a plugin meant for the community store, that is an undocumented internal that can break in any release.
- And the resulting editor is half-inert. The leaf is not in the workspace tree, so `app.workspace.getLeavesOfType('markdown')` does not contain it and `getActiveViewOfType(MarkdownView)` cannot see it. Obsidian's own editor commands and hotkeys, and every plugin that acts on "the active editor" (Templater and friends), would not reach that pane. It would look like an editor and behave like one only for typing.

Re-checked on 2026-08-26 against the installed **obsidian 1.13.1** types, since the spike ran against 1.7.2:

- `Workspace.createLeafInParent(parent: WorkspaceSplit, index)` and `createLeafBySplit(leaf, …)` are public — but both put the new leaf **in the workspace tree**, which is precisely the second pane the constraint rules out. There is still no public way to make a leaf that lives inside another view's DOM.
- `WorkspaceSplit` has no public constructor; you can only get one from the workspace.
- `MarkdownEditView`'s only constructor is `constructor(view: MarkdownView)`, so it cannot be built without a `MarkdownView`, which cannot be built without a leaf.
- There is no embed registry in the public types at all — no `embedRegistry`, no `EmbedCreator`, no `registerEmbed`. The editable-embed route the spike hoped for is not public API either.

So the answer is unchanged: technically yes, cleanly no.

**What would change this:** a public API for creating a leaf (or hosting an editor) outside the workspace tree, or a supported editable Markdown embed. Before spiking again, re-check the four facts above against the installed `node_modules/obsidian/obsidian.d.ts`: whether a leaf can be created outside the workspace tree, whether `WorkspaceSplit` is constructible, what `MarkdownEditView`'s constructor takes, and whether an embed registry (`embedRegistry` / `EmbedCreator` / `registerEmbed`) exists at all. Note also the deferred-leaf behaviour recorded in `AGENTS.md` — Obsidian defers background leaves, so an off-screen board stays empty until focused — which applies to whatever would host the two panes.

Until then, the shipped answer is the swap: a board note opens as the board and the tab header button flips it to the Markdown editor and back, one tab either way (see the README, "The board and the Markdown editor are the same tab").

## Unread-comment ordering assumes one clock

**Decided 2026-08-26. Same-clock writers are the supported case.**

Comment timestamps are written by `stamp()` (`src/model/dates.ts`) in local time with no timezone, and read-state compares those minute strings as text (`src/model/unread.ts`). A writer on another clock — most realistically an agent or script on a UTC server writing straight into a note — produces stamps systematically offset from the reader's marker. Which way the offset runs decides the symptom: comments that sort below the marker and never light the card up, or already-read ones resurfacing as unread.

The line grammar is what makes carrying a timezone expensive rather than cheap. `TS_LINE_RE` in `src/model/card.ts` restricts the timestamp capture to `[0-9: -]`, so `Z` or `+02:00` does not parse at all (a `-05:00` suffix would parse by accident), and `sortKey` in `src/model/unread.ts` orders comments by zero-padding each run of digits and comparing text — it has no notion of an offset to normalize. Carrying a timezone therefore means changing the parse, the ordering and the write format together, and doing it in a way every note already written stays readable through. That is a feature with a design, not a cheap addition, and nobody has asked for it.

So the documented answer is the README caveat under "Unread comments": stamps are read as being on the reader's clock, and anything automated writing comments into a vault should stamp them in the reader's local time, exactly as the plugin does.

**What would change this:** a real report of comments written across timezones being missed. The design would then have to keep `- _YYYY-MM-DD HH:mm @name:_` readable for every existing note.

## Two guided board setups racing for the same card folder

**Decided 2026-09-09. The race stays, because no hand can reach it.**

`cardFolderFor` in `src/boardNote.ts` picks the first free `Cards`, `Cards 1`, `Cards 2`… and `makeBoard` in `src/main.ts` writes that path into the note before creating the folder. Two guided setups interleaving across the one `await` between check and create would both claim `Cards` and end up sharing a folder, each board showing the other's cards. Backlog entry 20260826.05 recorded this in full.

Each setup is a separate user gesture, a palette confirmation or a menu click, and the window between them is a single `await`. The sequential case, two boards created one after the other in the same folder, already gets `Cards` and `Cards 1`. An atomic claim would replace a path whose value is its simplicity, to guard against a timing no person produces.

**What would change this:** a report of two boards sharing a folder without anyone editing `card-folder` by hand, or a second caller of `makeBoard` that is not a user gesture (a command run in a loop, an MCP tool).

## Mobile is not supported, and the manifest now says so

**Decided 2026-09-10. `isDesktopOnly: true`, and the gated Node import stays gated.**

`manifest.json` used to declare `"isDesktopOnly": false`, which tells the community directory and every phone user that this plugin runs on a phone. Nothing was ever built for that. `src/theme/` has one media query, `prefers-reduced-motion`, and no `.is-mobile`, `.is-phone` or `.is-tablet` selector at all, where Obsidian's own stylesheet carries hundreds of rules keyed on those classes. Hit targets are fixed at 24, 26 and 30 pixels; several affordances — a card's hover actions, a column's menu — are revealed on hover, which a touch device has no way to produce. No test in the repository exercises a mobile viewport or platform class. The claim was a manifest default nobody had revisited, not a decision.

Honouring it means real styling, real hit-target work and a device to test on. The manifest is what a directory listing and a phone's plugin browser read, so until that work exists the honest value is `true`: a phone will not install it rather than installing something unusable.

The second half of this is `await import("http")` in `src/obsidian/mcpHttpServer.ts`, the Node builtin that hosts agent access, which is reached only after `if (!Platform.isDesktop) throw`. Obsidian's submission requirements say a plugin using a Node API must declare `isDesktopOnly: true`, and the wording is unconditional — it does not carve out a runtime-gated import. That requirement is now met by the line above rather than by the gate, but the gate stays: `Platform.isDesktop` is checked at every path into the server (`buildMcp` and the token minting in `src/main.ts`, the settings group in `src/settingsDefinitions.ts`, and the throw immediately before the import), and it is what keeps the import out of a build that Obsidian nonetheless chose to load. A manifest flag is a promise made to a directory; a runtime check is one enforced in the code, and the two are worth having at once.

**What would change this:** someone wanting the board on a phone badly enough to fund the styling pass — touch-sized targets, the hover-only affordances given a tap route, and `.is-phone`/`.is-tablet` layouts — with a device to check it on. That is its own entry when it comes, not a manifest edit. Nothing about the gated `http` import changes with it: the server is desktop-only whatever the manifest says, because `http` does not exist on mobile.

## Folia does not decide for itself what colour goes on a pale accent

**Decided 2026-09-10. The board reads `--text-on-accent` flat, exactly as Obsidian's own buttons do.**

Obsidian publishes two variables for text drawn on an accent fill: `--text-on-accent` for a dark accent and `--text-on-accent-inverted` for a light one. The developer docs describe both but never say who chooses between them, which read as a gap in Folia — the token block resolves `--folia-on-accent` from `--text-on-accent` alone and never mentions the inverted one, so a user picking a pale yellow accent looked like they would get white text on a near-white button. The open question was whether Folia should measure the accent's lightness itself and switch, or follow whatever the app does and accept the app's limits.

Reading the running app settled it. In Obsidian 1.13.7's `app.css` the two variables are defined once, on `body`, as `white` and `black`, and nothing branches between them: `button.mod-cta` sets `--text-color: var(--text-on-accent)` and stops, `button.mod-warning` does the same on the error fill, and the only rule in the whole stylesheet that names `--text-on-accent-inverted` is a Canvas group label. The choice is made at runtime instead. Setting the accent to `#f5f3a0` put `--text-on-accent: var(--text-on-accent-inverted)` into the inline style of `<body>`, beside the `--accent-h/s/l` triple derived from the same setting, and a popout window opened afterwards carried it too. Folia's token block inherits from that body, so its primary button and Obsidian's `mod-cta` both computed `rgb(0, 0, 0)` on `rgb(245, 243, 158)` — the same colour, from the same source, with no code in Folia that knows the accent is pale.

So the mechanism is the app's, and reading the variable flat is how a plugin joins it. Detecting lightness in Folia would mean overriding a decision Obsidian already made and that a theme can already override, and it would drift the day either of them changes their mind. What Folia owes instead is the declaration site: the override is on `<body>`, so it reaches only rules that inherit from a body. The token block does, because `.folia-scope` is always a descendant of one, and `scripts/check-portal-scope.mjs` keeps it that way through every portal. Hoisted to `:root` the same declaration would sit on `<html>`, body's parent, miss the override, and fall through to its own `#fff` fallback — white for good, and visibly wrong only to the users who picked a pale accent. Hoisting it fails `pnpm theme:check`, which requires every token to be declared in the `.folia-scope` block and nowhere else — so the site is enforced, and the comment on the declaration in `src/theme/tokens.css` says why at the point where someone would be tempted to move it. What is not enforced is the app's half of the bargain: nothing in CI can see Obsidian's inline override, and jsdom cannot compute contrast at all (`test/a11y.axe.test.tsx` disables the colour-contrast rule for that reason), so if Obsidian drops the override this decision goes quietly wrong. That is what the re-check below is for.

The toast is deliberately not part of this. It paints `color: #fff` on `--folia-success` or `--folia-danger`, fills that come from the theme's green and red rather than from the accent, and Obsidian's nearest equivalent, `.notice`, hard-codes `color: #FAFAFA` on a fixed dark background for the same reason. Routing the toast through `--folia-on-accent` would let an unrelated appearance setting flip its label to black on green.

**What would change this:** Obsidian branching between the two variables in CSS, or dropping the inline-body override in favour of something a plugin has to read for itself. The check is one line in the running app — set a pale accent in Settings → Appearance and read `document.body.getAttribute('style')`; if `--text-on-accent` is no longer rewritten there, this decision is stale and the contrast failure is real again.

## The community-directory action's release mode

**Decided 2026-08-26. Releases stay on release-it plus the repository's own pipeline.**

Obsidian's [`obsidianmd/obsidian-workflows`](https://github.com/obsidianmd/obsidian-workflows) action offers a release mode and a reusable `release.yml`. It creates a draft release for a human to publish, and it knows nothing about this repository's rules: a tag must be plain semver and reachable from `origin/main`, and the release notes come from the changelog section release-it wrote. Adopting it would replace an end-to-end pipeline with a draft and a second copy of checks CI already runs on the same commit. Its scanner half is still used, in PR mode, for drift detection (see `docs/releasing.md`).

**What would change this:** the action learning to publish rather than draft, or the directory starting to require its release mode for listed plugins.

## Identical checklist lines are told apart by count, not by identity

**Decided 2026-09-19. What occurrence counting cannot see stays, because closing it means writing into people's notes.**

Every write the board makes to a checklist line — a tick, a removal, a column from the menu or the panel, a drag — carries the reading it was decided against, and so does `move_card`; the note refuses the write when the line at that position no longer matches it (`subtaskDrift` in `src/model/card.ts`). A line is named by its position, its words, and which of the lines reading exactly those words it is (`SubItem.occurrence`, counted from the top of `## Subtasks`); a move also names the claim it replaces, and a move to a column the box as well. That closes what the words alone left open (#36, #53): a different line added or removed above a pair of identical lines shifts the position without shifting the count, so the write is refused instead of landing on the twin. `set_subtask_done` is held to the agent's count only when the agent passes it; without it, the tool counts from its own fresh read and the words alone guard against a shift.

What the count cannot see is an edit that slides an identical line into the meant line's place, moving the position and the count together: a twin inserted directly above it; a twin inserted or removed further up while the meant line has an identical line right next to it, which is the one that slides in; or the meant line deleted with its twin right below it. Position, words and count then all still agree, and a tick or a removal lands on the twin. A move is also held to the claim, and a move to a column to the box, so it still refuses whenever the twins differ there. The outcome is hard to tell apart for lines that read the same, and it needs two writers acting on one line in one card within seconds, so it is recorded rather than chased.

Two ways to close it were weighed and left out. Comparing the neighbouring lines as well would turn every edit next to a line into a refusal — an agent's `add_subtask` appending right below the last line would refuse every drag of it — and it still cannot see a twin inserted between the meant line and the neighbour. A stable identity per line (a block id such as `^abc123` written onto it) would settle it outright, and is exactly what #36 settled against: the plugin does not write identifiers into people's notes.

**What would change this:** a real report of a write landing on the wrong one of two identical lines, or a decision to let the plugin write a hidden identifier onto checklist lines. Either would reopen #36's reasoning first.

## Folia's components do not wear Obsidian's undocumented class names

**Decided 2026-09-21. The contract with the host is its documented CSS variables, and nothing else.**

Obsidian dresses its own interface through class names — `clickable-icon`, `mod-cta`, `checkbox-container`, `suggestion-item` and about twenty more — and a plugin can put any of them on its own elements and inherit the app's face for free. That is the obvious shortcut out of half the styling work this repository has in front of it, and it is the one thing this domain will not do.

None of those classes is API. They are not in the developer docs, they carry no compatibility promise, and what they paint is a theme's business: a community theme can redefine, restyle or simply not style any of them, and a release can rename one without it being a breaking change to anything Obsidian published. Wearing them makes Folia's appearance depend on an implementation detail of the app and of whatever theme the user installed, in a way nothing in this repository can check. What Obsidian *does* publish, page by page, is its CSS variables, and a variable is a contract a theme is expected to honour — which is precisely why the board is built on them.

`@layer` is not a way around this either, and it is worth writing down because it looks like one. Unlayered styles beat layered ones whatever their specificity, and Obsidian's `app.css` is unlayered, so moving Folia's rules into a layer would not raise them above the app's — it would push them underneath. The doubled-class convention that `base.css` documents stays the mechanism for the specificity fight, and `pnpm buttons:check` stays the guard over it.

The cost is real and accepted: every control the board draws is dressed by hand, and every hover, focus and disabled state with it. `src/theme/host/variables.json` is what makes that bearable — it is the registry of what Obsidian actually documents, so "is there a variable for this?" is a lookup rather than a memory, and `pnpm theme:check` fails any variable the board reads that is neither documented nor recorded as observed in `src/theme/host/observed.json`.

**What would change this:** Obsidian documenting a class-name contract for plugins — a published list with a compatibility promise, the way the CSS variables have one. A theme-only convention, or a class that merely appears stable across a few releases, is not that.

## Dense controls derive from the host input height

**Decided 2026-09-21. Search and filter chips share `--input-height`; icon buttons subtract one grid step, and mini buttons subtract two, with a fixed 24px minimum for both.**

The board keeps smaller actions inside cards and comments, but their height now moves with the theme's inputs. Making every action input-sized would enlarge those rows unnecessarily. Small print uses five-sixths and eleven-twelfths of the smallest host UI font, producing 10px and 11px at its 12px default without depending on spacing. Pill ends remain an owned shape because a fixed radius rung cannot guarantee a rounded end at every control height.

**Reviewed live 2026-09-21** in Obsidian 1.13.7, dark and light. The toolbar, cards, detail panel and edit-column dialog all hold: nothing clips, every control clears the 24px pointer-target minimum, and both schemes read the same. The review did surface that the mini tier never actually derives anything at Obsidian's own defaults, which is worth stating rather than leaving to be rediscovered: at `--input-height: 30px` the two-step reduction gives 22px, below the 24px minimum, so `--folia-hit-sm` resolves to a flat 24px and only starts tracking the host above `--input-height: 32px`. The floor binding is the intended outcome — a pointer target below 24px is not an acceptable thing to derive — and 24px is also what the token was before it became a formula, so this changes no pixels today. It is kept as a `max()` rather than rewritten as a literal because a theme with taller inputs should still get taller mini buttons.

**What would change this:** live evidence of clipping or poor legibility in a supported desktop theme.

## Popover icons are the host's extra-small tier

**Decided 2026-09-21 after live review. Icons inside menu items, swatches and chips are `--icon-xs`; icons on card and header buttons are `--icon-s`.**

A live review read the popover icons as having shrunk from 16px to 14px during the move onto the host icon scale. They had not. Before that move every menu-item icon was written `<Icon name="…" size={14} />` in `ColumnMenu.tsx` and `CardContextMenu.tsx`, and the theme carried no `.folia-icon` width rule, so the SVG attribute governed and those icons rendered at 14px. Deleting the `size` prop and setting `--folia-icon-size: var(--icon-xs)` on the containers reproduced the same 14px through the host variable that defines it. The two-tier reading — lighter icons inside a popover, full-weight icons on the buttons you click on the board — is therefore the pre-existing design, now expressed in Obsidian's own scale instead of in hand-written numbers, and it survives a user changing the host icon scale.

Two icons did change size, both upward and both toward the scale: the "no colour" and "no priority" ✕ went from a hand-written 11px to 14px, and the card quick actions from 15px to 16px.

**What would change this:** Obsidian redefining `--icon-xs` far from 14px, or live evidence that a popover icon at the extra-small tier is hard to recognise.

## Keep standard scrollbars and reduced-motion detection

**Decided 2026-09-21. Keep `scrollbar-width: thin` and `prefers-reduced-motion`.**

Custom scrollbar colours would add platform-specific styling for a small difference with no reported mismatch. The standard reduced-motion query already suppresses entrance animations and drag transforms, and the audit's earlier host inspection found no replacement facility. Phase 2 confirms both mechanisms in source; the unavailable DevTools bridge means it supplies no new live evidence about Obsidian itself.

**What would change this:** a reported scrollbar mismatch in a supported desktop theme, or a documented host motion preference that the standard media query cannot express.

## Hairlines follow visual purpose rather than drawing technique

**Decided 2026-09-21 after Phase 2 review. Dashed drag placeholders, unchecked todo markers and filled separators follow `--border-width`.**

The former 1.5px token was described as lighter than ordinary borders, but ordinary borders were 1px. Keeping that numeric difference would make these outlines heavier, and the dashed outline and unchecked shape already distinguish their roles. A separator drawn with a background fill serves the same purpose as a border, so its element height follows the host hairline too. This deliberately replaces the earlier argument that a different drawing technique requires a separate thickness.

The status-bar clearance is different. Its 32px fallback estimates a runtime measurement until the board measures the host status bar; it remains owned with the `--size-4-8` exception. Grid changes must not change that estimate.

**What would change this:** live evidence that a supported theme's border width makes the markers ambiguous or separators unusable. A runtime measurement changing the status-bar clearance is expected and does not reopen the spacing decision.

## Check component token dependencies conservatively

**Decided 2026-09-21 after cycle-guard review. Component overrides must not lead back to themselves through any base, light or dark token map.**

Portalled menus carry both their component class and `.folia-scope`, so a component declaration can close a cycle with declarations from the token block on that same element. The guard checks that possible overlap without attempting to evaluate every selector and cascade combination.

This is stricter than browser cycle detection for descendants. [CSS resolves custom properties before inheritance](https://www.w3.org/TR/css-variables-1/#cycles), so a descendant can read an inherited computed value without reintroducing its ancestor's dependency edges. The guard deliberately rejects that pattern when it would become cyclic on a scope element. Its diagnostic names the possible overlap rather than claiming every descendant use is invalid.

**What would change this:** a necessary component override that the conservative rule rejects despite demonstrably safe selector placement. That would require a narrower check with a regression test, not a claim that inheritance preserves unresolved dependency edges.

## The board's selects carry no dropdown chevron

**Decided 2026-09-21. Folia's `<select>` elements take Obsidian's own dropdown face and go without its arrow.**

Obsidian 1.13.7 dresses every bare `<select>` through `select, .combobox-button, .dropdown`, so background, padding, height, radius, shadow and the focus ring arrive for free once the board stops overriding them. The chevron does not: it is an inline data-URI SVG declared on the `.dropdown` class alone, with a second declaration under `.theme-dark` for the light-on-dark version. `--dropdown-background-position`, `--dropdown-background-size` and `--dropdown-background-blend-mode` describe that image's three background layers and paint nothing without it, so declaring them would be three inert lines.

The only way to the glyph is putting `.dropdown` on the element, which is the undocumented-class contract the owner ruled out (`docs/ai/reports/…/02…md` decision 5 in the phase context). Drawing a chevron from Folia's own icon set is not available to a `<select>`, whose shadow DOM takes no children. Leaving `appearance` alone and letting the platform draw its native arrow would restore an indicator and lose the app's look, which is the divergence 02-19 is about.

This has a visible cost and it is worth naming. The board's selects show no dropdown indicator, which was already true before this decision — the app's own rule sets `appearance: none` on every bare select — but the decision is what keeps it true. `--dropdown-padding` is therefore not adopted either: its end padding is `2.4em` against `0.8em` on the other side, room reserved for the glyph, and holding that space open while drawing nothing in it would advertise the gap. The selects use the board's own symmetric padding and its own type size, so they sit correctly beside the text inputs in the same field grid. Everything else about them is the app's, hover included. Focus is the one exception in the other direction: Obsidian's own ring for a focused select is 3px of `--background-modifier-border-focus`, `#555555` on the select's own `#333333`, which is about 1.7:1, so the board's accent `:focus-visible` outline keeps drawing over it instead of deferring to it.

**What would change this:** Obsidian publishing the dropdown indicator as a variable (an `--dropdown-icon` or equivalent), or the board replacing `<select>` with a button-plus-popover it draws itself, at which point the indicator is Folia's to draw.

## Focus stays the board's accent until Obsidian ships the focus outline

**Decided 2026-09-21. A focused border keeps `--folia-accent`; `--background-modifier-border-focus`, `--input-focus-outline` and `--input-focus-border-color` are not used.**

The theme-authoring guide shows both declared on `:root` with system keywords (`Highlight`, `Canvas`), which would put focus on the operating system's own colour. Neither is on a `Reference/CSS variables` page, so neither is in the registry, and the theme guard refuses a host variable that is neither documented nor observed — a fallback does not buy an exemption, by design. Read live in Obsidian 1.13.7 both compute to the empty string on `body`: the application does not define them at all, and the only rules naming them belong to the bundled PDF.js annotation layer. So there is nothing to observe and nothing to record; using them would mean writing a value the board invented behind a host variable's name.

`--background-modifier-border-focus` was adopted in their place and then withdrawn, which is the part worth recording. It computes to `#555555`: 2.3:1 against the panel and 1.7:1 against the resting `#333333` border, where the accent it replaced is about 4:1. Eight of the board's inputs suppress `outline` and carry their whole indication on that border plus a 2px accent ring, and at three of them the board's own `:focus-visible` outline is out-specified, so the weakened border *was* the indicator. The audit's plan was the border together with `--input-focus-outline`; with the outline half unavailable, the border half stops being a free swap and becomes a contrast loss.

This is a general shape and not only a focus story: a variable that is right as part of a set can be wrong on its own, and "half of it is still an improvement" is the assumption to check rather than the conclusion to reach.

**What would change this:** Obsidian defining the focus-outline pair in a shipped build, or documenting it on a CSS-variables reference page. Either makes it a registry entry, and then the whole set arrives together and the question reopens with the OS colour on the table.

## The settings-shaped on/off row stays a checkbox

**Decided 2026-09-21. `.folia-field-toggle` keeps a native checkbox; the `--toggle-*` variables are not used.**

Obsidian's toggle is a track with a sliding thumb, and its eleven variables describe exactly that: `--toggle-width`, `--toggle-radius`, `--toggle-border-width`, `--toggle-thumb-width/height/radius/color`, plus a small variant for dense rows. Read live in 1.13.7, the app builds it entirely out of `.checkbox-container` — a wrapper element with `::before` and `::after` pseudo-elements, holding a visually hidden `input` — so the shape exists in the markup, not in the input. A native checkbox cannot wear it: it has no children to make a thumb from, and faking one would mean drawing a whole control by hand to imitate a control the host already draws.

Nothing is lost by waiting. The same build styles every bare `input[type="checkbox"]` from the `--checkbox-*` set, so the row already shows Obsidian's own checkbox, correctly sized, filled and ticked. What is left is the difference between a checkbox and a toggle on a settings-shaped row, which is a markup question rather than a variable one.

**What would change this:** the board adopting the host's `checkbox-container` markup for that row, which is the same decision as whether these panels should be built from Obsidian's `Setting` API at all.

## A host variable has to describe the object, not sit near it

**Decided 2026-09-21 during Phase 3, after several unprimed reviews. Five host variables are not used, because each describes a different object from the one the board would have spent it on.**

The theme domain's rule is that a `--folia-*` token is an alias or an owned value with a reason. It says nothing about whether the aliased variable *means* the thing it is attached to, and a guard cannot: `pnpm theme:check` validates registry membership and token shape, not fit. These are where fit failed, and they are recorded together because the same mistake produced all of them — reaching for the nearest published name rather than the one whose object matches.

- **`--popover-max-height` on the column menu.** The `--popover-*` family is the file-preview card: `--popover-width: 450px`, `--popover-height: 400px`, `--popover-pdf-width`, `--popover-pdf-height`. Its `95vh` ceiling would have raised a 440px action menu to roughly 760px on an 800px window. A ceiling looked generic enough to borrow while rejecting the family's widths; it is not, and `none` is a legal value for it, which would have made the call site's `min()` invalid and removed the cap entirely.
- **`--blockquote-border-thickness` on the comment rail.** That left border's colour is how read, unread and reply are told apart, so a theme that draws borderless quotes would erase a state cue by changing something about quotations. Comments are not quotations.
- **`--checkbox-radius` on the to-do preview marker.** The radius is the corner chosen for a 16px control, and the marker is 8px and keeps its own size on purpose. Half of a coupled pair leaves a theme free to turn the marker into a dot.
- **`--metadata-property-radius` on the property input.** That is the property *row's* corner; the row is `.folia-prop-row` and the input is the value inside it. The input takes `--input-radius`, because with the border the board keeps on it, a text input is what it is.
- **`--pill-padding-x` on the filter chip.** Obsidian never spends it as box padding: `.multi-select-pill` sets `padding: var(--pill-padding-y) 0`, and this variable is an inline-start margin on the pill's content and an end margin on its remove button. Read as symmetric padding it is a number without its meaning, and it took 4.2px a side off every chip.

A second, narrower rule came out of the same reviews, and it accounts for three more. **A variable a theme sets to zero must not be the only thing holding up a signal.** `--blockquote-border-thickness` on the comment rail — which fails both rules, and is listed above for the first — `--nav-indentation-guide-width` on the subcard group and `--pill-border-width` on the filter chip each govern the *existence* of a line that the board then colours to say something: read against unread against reply, "these belong to the card above", on against off. A theme that draws borderless quotes, hides indentation guides, or ships a flat pill — Obsidian's own property pills declare `--pill-border-width: 0` — would take the signal with the line. The same test is what keeps `--tag-border-width` out of the card chips, whose translucent tints have no other edge.

**What would change this:** for the menu, Obsidian publishing dimensions for its own action menus. For the others, the board changing what the element is — a comment rail that no longer carries state, a preview marker that follows the host checkbox size, a property row drawn as Obsidian draws one without a border, a filter chip whose on-state stops using its border. For the zero rule specifically, a second cue strong enough to carry the state on its own would make the line safe to hand over.

## What the board keeps painting itself, now that Obsidian's colour variables are in reach

**Decided 2026-09-21. Eight things keep a colour of Folia's own, plus two gaps this phase found and did not close, because the host variable would erase a distinction the board is making on purpose, or because taking it would be a change nobody here can check.**

Phase 1 of the theme work moved the board onto Obsidian's semantic colour variables wherever the board was inventing an answer the app already publishes: form fields, accent text, error, warning and success surfaces, icon colours, the done-item decoration, links, and the drop target. The audit's own reading (`docs/ai/reports/20260829.what-obsidian-already-provides/02.styling-theme-and-design-language.md`, findings 02-04 and 02-07) marks some of those as trade-offs rather than wins, and this is where the trade-offs landed.

**The two inline rename inputs keep the page background.** `.folia-card-title-input` and `.folia-column-title-input` replace a piece of text in its own slot, inheriting its weight, size and line height so that entering and leaving edit mode does not shift anything. `--background-modifier-form-field` is a recessed fill whose whole job is to announce "this is a field", which is the opposite of what these two are for. Every field the user goes *to* — the search box, the menu field, the add-column input, the card and inline add inputs, the detail fields, the property input, the description and comment editors, the modal fields — takes it.

**The tinted chips keep their hand-tuned mixes.** `.folia-chip-prio-1` to `-4`, `.folia-chip-warn` and `.folia-chip-danger` mix a percentage of the priority ramp into `--text-normal`, and the percentages were tuned for WCAG AA in both light and dark (the comment on the rule in `src/theme/chips.css` records the tuning). `--text-error` and `--text-warning` are single colours with no relationship to that tuning, so swapping them in would re-open a contrast question nothing in CI can answer: jsdom cannot compute contrast (`tracking/waivers/0002-automated-a11y-gate.md`), and visual regression is guarded by a structural-snapshot net and the theme guard rather than by a pixel diff — `tracking/waivers/0003-visual-regression-automation.md` retired itself on that basis and accepted one residual, a rendered-pixel change that alters no structure and no token, which is exactly what a re-tuned percentage is. The same absence of a check is why the fifteen `color-mix`es that blend two opaque colours stay `in srgb` while the thirty-eight that blend into `transparent` moved to `in oklch`; `src/theme/README.md` states that rule where the mixes are.

The plain warning and error surfaces beside them did move. The confirm bar mixes a tenth of `--background-modifier-error` into the column background rather than taking the surface whole: measured in 1.13.7 that variable is `#fb464c` in dark and `#e93147` in light, a saturated red, and the bar carries `--text-normal` (`#dadada` in dark), so the pairing Obsidian's plugin guidelines show is a button face rather than a notice bar. What moved is the source — it used to mix the palette red that also fills the danger button — so a theme that recolours the error state now reaches it. The folder notice and the "behind" bar take `--text-warning` as their hue rather than the priority ramp's orange, which is what they were built out of; they still mix, because Obsidian documents no warning background at all.

**The toast keeps its own fill.** It is a saturated pill with a white label, and that white is a decision of its own, recorded above: it must not follow an unrelated appearance setting. The documented pairing for `--background-modifier-error` is `--text-normal`, which says that variable is a surface text sits on rather than a pill — so filling the toast with it while keeping the white label would be exactly the mismatch the earlier decision exists to prevent. `--folia-danger` and `--folia-success` therefore stay on the palette's red and green, and stay separate from `--folia-text-error` and `--folia-text-success`, which are what every foreground reads. One token doing both duties is how a fill ends up painting text.

**The filter chip's "on" state keeps its accent tint.** `--background-modifier-active-hover` is the app's answer for a plain active surface, and `.folia-column-body.is-over` now uses it. The filter chip is not that: an active filter is a statement about what the whole board is currently showing, and the accent tint is the signal. A neutral active background would flatten it into the same grey as a hovered row.

**The swatch and priority rings stay shape rather than colour.** `.folia-swatch.is-active` and `.folia-menu-prio.is-active` draw a two-tone ring, which reads on any fill including the eight column colours themselves. There is no host variable for "this swatch is the chosen one", and a colour-based marker would be invisible on the swatch whose colour it matched.

**Three of Obsidian's link variables are unread, and the same rule blocks all three.** The community-directory CSS scan refuses every `text-decoration-*` longhand and every multi-keyword `text-decoration` shorthand, and it refuses the *property*, so putting a variable in the value changes nothing — verified each time by `pnpm obsidian-scan:check`, which reported the lines the moment they were written and cleared when they were removed. That costs the board `--link-decoration-thickness` on a resolved link, and `--link-unresolved-decoration-style` and the pairing that would carry it on a missing one. A theme that thickens its links, or draws unresolved ones wavy, reaches every link in the vault except the board's. The plain `--link-decoration` and the unresolved colour, opacity and filter are all readable and all read.

**Beyond the scan, the unresolved marker could not take `--link-unresolved-decoration-style` anyway.** It reads the other four of that set — colour, opacity, filter and decoration colour. The dashes stay a literal, and would have to even if the scan changed its mind: the marker is drawn as a `border-bottom`, and a border cannot take that variable safely, because `text-decoration-style` accepts `wavy`, which is not a border style. A `border-bottom` shorthand that inherited `wavy` would be invalid and draw nothing, so a theme choosing it would erase the missing-link marker rather than restyle it.

**The subitems chevron does not take `--nav-collapse-icon-color`.** It was adopted and then reverted on measurement, which is the useful part. The pair Obsidian publishes for a collapse arrow — the colour and its collapsed variant — are the **same value** in the default theme, `#666666` in dark and `#ababab` in light, so the collapsed state gains no colour from them and the rotation remains the whole signal either way. Worse, they are sidebar colours, tuned against `--background-secondary`; this chevron sits on a card, against `--background-primary`, where `#ababab` on `#ffffff` is about 2.3:1 — under the 3:1 minimum for a non-text indicator. Adopting a variable because its name matches the widget would have made the control harder to see in light mode in exchange for nothing. The chevron keeps its label's colour.

**Icon buttons are dimmer at rest than they were, and that is the point.** `--icon-color` measures the same `#b3b3b3` as the `--text-muted` the buttons used before, and `--icon-color-hover` is that same value again, so the whole hover response now lives in `--icon-opacity` 0.85 → 1 rather than in a colour step from `#b3b3b3` to `#dadada`. The resting icon is therefore slightly dimmer and the hover lands where the old resting state was. That is not a loss to be fixed: it is precisely what Obsidian's own `.clickable-icon` does, so the board's icon buttons now behave like every other icon button in the window, which is the whole point of this phase. Contrast stays above the 3:1 non-text minimum in both modes (about 5.6:1 in dark, 4.6:1 in light).

**Nothing guards a refinement that weighs the same as the rule it refines.** `pnpm buttons:check` compares the board's rules against *Obsidian's*, which is what it was built for; it says nothing about two of the board's own rules at equal specificity, where source order decides and `src/theme/index.css` fixes that order. `.folia-action-done:hover` and `.folia-action-delete:hover` lost to `.folia-icon-btn:hover` that way for releases, drawing no tint at all, and the same trap caught the detail panel's title row from the other side when a `:hover` rule out-weighed the refinement meant to override it. Both are fixed; neither was caught by anything but a reader. Closing it properly means a guard that reads `index.css`'s order and compares selectors that target the same elements, which is a real piece of work and not this phase's.

**`--folia-font-mono` no longer has `monospace` behind it, and that is a small accepted risk.** `--font-monospace` is not in Obsidian's published variable list; `src/theme/host/observed.json` records it from the running 1.13.7, while `manifest.minAppVersion` is `1.11.4`. Nobody here has checked 1.11.4. If that build does not define it, `font-family: var(--folia-font-mono)` is invalid at computed-value time and the two places that use it fall back to the interface font — a wrong font, not a broken board. The fallback went because the audit's 02-05 asked for it, and the guard would now refuse to put it back anyway: a literal nobody documents is exactly what it no longer accepts.

**What would change this:** a visual-regression harness plus an automated contrast gate would unfreeze the chip percentages and the fifteen srgb mixes, which are held by the absence of a check rather than by an argument; that is what the two waivers above are tracking, and it would also let the toast's fill and label be re-decided together against a measured contrast instead of a documented pairing. For the rename inputs, Obsidian documenting a variable for an in-place edit affordance — a field that is meant not to look like one — would settle it the other way. For the missing-link marker, the community scan accepting the text-decoration longhands would remove the first half of the reason; the `wavy` problem would still need a shape that is not a border.
