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

**What would change this:** live evidence of clipping or poor legibility in a supported desktop theme. The toolbar, cards, detail panel and edit-column dialog still need visual review in dark and light mode after this change.

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
