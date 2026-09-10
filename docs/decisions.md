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

`manifest.json` used to declare `"isDesktopOnly": false`, which tells the community directory and every phone user that this plugin runs on a phone. Nothing was ever built for that. `src/styles.css` has one media query, `prefers-reduced-motion`, and no `.is-mobile`, `.is-phone` or `.is-tablet` selector at all, where Obsidian's own stylesheet carries hundreds of rules keyed on those classes. Hit targets are fixed at 24, 26 and 30 pixels; several affordances — a card's hover actions, a column's menu — are revealed on hover, which a touch device has no way to produce. No test in the repository exercises a mobile viewport or platform class. The claim was a manifest default nobody had revisited, not a decision.

Honouring it means real styling, real hit-target work and a device to test on. The manifest is what a directory listing and a phone's plugin browser read, so until that work exists the honest value is `true`: a phone will not install it rather than installing something unusable.

The second half of this is `await import("http")` in `src/obsidian/mcpHttpServer.ts`, the Node builtin that hosts agent access, which is reached only after `if (!Platform.isDesktop) throw`. Obsidian's submission requirements say a plugin using a Node API must declare `isDesktopOnly: true`, and the wording is unconditional — it does not carve out a runtime-gated import. That requirement is now met by the line above rather than by the gate, but the gate stays: `Platform.isDesktop` is checked at every path into the server (`buildMcp` and the token minting in `src/main.ts`, the settings group in `src/settingsDefinitions.ts`, and the throw immediately before the import), and it is what keeps the import out of a build that Obsidian nonetheless chose to load. A manifest flag is a promise made to a directory; a runtime check is one enforced in the code, and the two are worth having at once.

**What would change this:** someone wanting the board on a phone badly enough to fund the styling pass — touch-sized targets, the hover-only affordances given a tap route, and `.is-phone`/`.is-tablet` layouts — with a device to check it on. That is its own entry when it comes, not a manifest edit. Nothing about the gated `http` import changes with it: the server is desktop-only whatever the manifest says, because `http` does not exist on mobile.

## Folia does not decide for itself what colour goes on a pale accent

**Decided 2026-09-10. The board reads `--text-on-accent` flat, exactly as Obsidian's own buttons do.**

Obsidian publishes two variables for text drawn on an accent fill: `--text-on-accent` for a dark accent and `--text-on-accent-inverted` for a light one. The developer docs describe both but never say who chooses between them, which read as a gap in Folia — `src/styles.css` resolves `--folia-on-accent` from `--text-on-accent` alone and never mentions the inverted one, so a user picking a pale yellow accent looked like they would get white text on a near-white button. The open question was whether Folia should measure the accent's lightness itself and switch, or follow whatever the app does and accept the app's limits.

Reading the running app settled it. In Obsidian 1.13.7's `app.css` the two variables are defined once, on `body`, as `white` and `black`, and nothing branches between them: `button.mod-cta` sets `--text-color: var(--text-on-accent)` and stops, `button.mod-warning` does the same on the error fill, and the only rule in the whole stylesheet that names `--text-on-accent-inverted` is a Canvas group label. The choice is made at runtime instead. Setting the accent to `#f5f3a0` put `--text-on-accent: var(--text-on-accent-inverted)` into the inline style of `<body>`, beside the `--accent-h/s/l` triple derived from the same setting, and a popout window opened afterwards carried it too. Folia's token block inherits from that body, so its primary button and Obsidian's `mod-cta` both computed `rgb(0, 0, 0)` on `rgb(245, 243, 158)` — the same colour, from the same source, with no code in Folia that knows the accent is pale.

So the mechanism is the app's, and reading the variable flat is how a plugin joins it. Detecting lightness in Folia would mean overriding a decision Obsidian already made and that a theme can already override, and it would drift the day either of them changes their mind. What Folia owes instead is the declaration site: the override is on `<body>`, so it reaches only rules that inherit from a body. The token block does, because `.folia-scope` is always a descendant of one, and `scripts/check-portal-scope.mjs` keeps it that way through every portal. Hoisted to `:root` the same declaration would sit on `<html>`, body's parent, miss the override, and fall through to its own `#fff` fallback — white for good, and visibly wrong only to the users who picked a pale accent. Hoisting it fails `pnpm tokens:check`, which requires every live token to be declared in the `.folia-scope` block and nowhere else — so the site is enforced, and the comment on the declaration in `src/styles.css` says why at the point where someone would be tempted to move it. What is not enforced is the app's half of the bargain: nothing in CI can see Obsidian's inline override, and jsdom cannot compute contrast at all (`test/a11y.axe.test.tsx` disables the colour-contrast rule for that reason), so if Obsidian drops the override this decision goes quietly wrong. That is what the re-check below is for.

The toast is deliberately not part of this. It paints `color: #fff` on `--folia-success` or `--folia-danger`, fills that come from the theme's green and red rather than from the accent, and Obsidian's nearest equivalent, `.notice`, hard-codes `color: #FAFAFA` on a fixed dark background for the same reason. Routing the toast through `--folia-on-accent` would let an unrelated appearance setting flip its label to black on green.

**What would change this:** Obsidian branching between the two variables in CSS, or dropping the inline-body override in favour of something a plugin has to read for itself. The check is one line in the running app — set a pale accent in Settings → Appearance and read `document.body.getAttribute('style')`; if `--text-on-accent` is no longer rewritten there, this decision is stale and the contrast failure is real again.

## The community-directory action's release mode

**Decided 2026-08-26. Releases stay on release-it plus the repository's own pipeline.**

Obsidian's [`obsidianmd/obsidian-workflows`](https://github.com/obsidianmd/obsidian-workflows) action offers a release mode and a reusable `release.yml`. It creates a draft release for a human to publish, and it knows nothing about this repository's rules: a tag must be plain semver and reachable from `origin/main`, and the release notes come from the changelog section release-it wrote. Adopting it would replace an end-to-end pipeline with a draft and a second copy of checks CI already runs on the same commit. Its scanner half is still used, in PR mode, for drift detection (see `docs/releasing.md`).

**What would change this:** the action learning to publish rather than draft, or the directory starting to require its release mode for listed plugins.
