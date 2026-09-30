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

## The card detail panel as a side panel, split or floating

**Decided 2026-09-29. Card details open only in Obsidian's own dialog.**

The detail panel used to have three presentations: split (the panel docked beside the columns, shrinking them), float (the panel over the columns' right edge) and modal (a dialog). Split and float were drawn by Folia inside the board's own tab, with a hand-made resize edge, a click-outside close that had to recognise Obsidian's suggestion popup by its undocumented `.suggestion-container` class, and bookkeeping to tell whose Escape it was. The dialog was hand-made too, with no focus trap.

Only the dialog has a native form. Obsidian's `Modal` gives it the backdrop, the focus trap, Escape, the close button and focus restore, and a child `Scope` pushed onto the keymap is how Escape stays inside the description editor. For the other two there is nothing to build on: the API documents no way to put a pane inside a view, and nothing documented is a persistent overlay inside a view. That is the same missing piece as the entry above, and the same answer. A workspace leaf beside the board would be a different feature, a second pane, and Obsidian already does that one. So split and float went, with everything that existed only for them: the width setting, the resize edge and its two open bugs (#76, #85), the click-outside close and the popup tracking. Settings that chose them are dropped on load, which puts those users on the dialog.

**What would change this:** a public API for a pane or a persistent overlay inside a view. Before trying again, check `node_modules/obsidian/obsidian.d.ts` for one, the same way the entry above says to.

## Board notes open as the board by swapping after the open

**Decided 2026-09-29. Documented API only, at the cost of a brief flash, heading links and a history entry.**

Until 0.4.2 the plugin wrapped `WorkspaceLeaf.prototype.setViewState` for the whole app and rewrote every `markdown` open of a board note into a board open, before the editor was drawn. It read the undocumented `eState` keys `line`, `subpath` and `match` to leave heading, block and search-result opens in the editor, and passed the undocumented `popstate` flag so neither swap between board and editor entered the navigation history. That was one global mutation of a core prototype, in the path of every plugin's leaves, that any Obsidian release could break silently.

Now `redirectToBoard` in `src/main.ts` listens to `file-open` (the active tab changed its note) and `active-leaf-change` (a background or deferred tab came forward), and swaps a Markdown tab showing a board note to the board with `leaf.setViewState`. Each editor is decided about once per note, so switching back to a tab is not an open, while the same note opened again after the tab showed something else is. A tab still finishing its own open silently ignores a second `setViewState`, and nothing documented says when it is done, so the swap checks what the tab shows and tries again every 16 ms for up to two seconds. It never saves the editor first: mid-load, the editor can hold the previous note's text under the new note's name, and a save then would write that text into the board note. A note the metadata cache has not read yet is asked about again on that note's first `changed` event. Taking over the `md` extension was rejected because it would give every note to the board view.

What the documented route costs, measured on Obsidian 1.13.7 against the `examples` vault, as frames in which the editor was painted and the time from the first of them to the painted board:

| Route | Frames | ms |
| --- | --- | --- |
| File explorer | 1–2 | 25–73 |
| File explorer keyboard preview (Mod+Arrow) | 1–2 | 19–54 |
| Link in a note | 1–2 | 31–76 |
| Search result | 1–2 | 42–68 |
| Quick switcher | 1–2 | 31–126 |
| Heading link | 1 | 35–89 |
| New split | 3–4 | 61–136 |
| Background tab brought forward | 1–3 | 25–73 |
| Deferred tab restored at startup | 2–3 | 40–53 |
| Back and Forward | 0 | 0 |

Back and Forward show no flash because history replays the tab's board state, not the editor. The tab in front at startup is swapped when the layout is ready; that one was not measured.

- **Heading, block and search links open the board.** Nothing documented tells them apart from a plain link: `file-open` carries only the file, and what `getEphemeralState()` holds is not typed. The editor at the heading is one click away with the tab's button. Heading links and search results were checked live; block links take the same path and were not.
- **History entries.** Only a swap into Obsidian's editor records one, and nothing documented on the plugin's side reaches that. So Back from the editor returns to the board first, and after board → editor → board the entry left behind is the board itself: the first Back press lands on the board already showing. `ViewStateResult.history` is not the lever; it is what a view reports about its own state changes.
- **Background tabs.** A board note opened in a tab that is not brought forward stays Markdown, title included, until the tab is activated. Sidebars still always show the editor.
- **Keyboard Back on a board.** The board is not navigable (`navigation = false`), so the Back and Forward hotkeys do nothing there, as before this change. The arrows in the tab header work.

**What would change this:** a documented hook that runs before a leaf opens a file, a way to register a view as the default for notes matching a condition, or typed eState for link targets. Any of those gives back the flash or the heading links without touching a prototype.

## Unread-comment ordering assumes one clock

**Decided 2026-08-26. Same-clock writers are the supported case.**

Comment timestamps are written by `stamp()` (`src/model/dates.ts`) in local time with no timezone, and read-state compares those minute strings as text (`src/model/unread.ts`). A writer on another clock — most realistically an agent or script on a UTC server writing straight into a note — produces stamps systematically offset from the reader's marker. Which way the offset runs decides the symptom: comments that sort below the marker and never light the card up, or already-read ones resurfacing as unread.

The line grammar is what makes carrying a timezone expensive rather than cheap. `TS_LINE_RE` in `src/model/card.ts` restricts the timestamp capture to `[0-9: -]`, so `Z` or `+02:00` does not parse at all (a `-05:00` suffix would parse by accident), and `sortKey` in `src/model/unread.ts` orders comments by zero-padding each run of digits and comparing text — it has no notion of an offset to normalize. Carrying a timezone therefore means changing the parse, the ordering and the write format together, and doing it in a way every note already written stays readable through. That is a feature with a design, not a cheap addition, and nobody has asked for it.

So the documented answer is the README caveat under "Unread comments": stamps are read as being on the reader's clock, and anything automated writing comments into a vault should stamp them in the reader's local time, exactly as the plugin does.

**What would change this:** a real report of comments written across timezones being missed. The design would then have to keep `- _YYYY-MM-DD HH:mm @name:_` readable for every existing note.

## Two guided board setups racing for the same card folder

**Decided 2026-09-09. The race stays, because no hand can reach it.**

`cardFolderFor` in `src/obsidian/boardNote.ts` picks the first free `Cards`, `Cards 1`, `Cards 2`… and `makeBoard` in `src/main.ts` writes that path into the note before creating the folder. Two guided setups interleaving across the one `await` between check and create would both claim `Cards` and end up sharing a folder, each board showing the other's cards. Backlog entry 20260826.05 recorded this in full.

Each setup is a separate user gesture, a palette confirmation or a menu click, and the window between them is a single `await`. The sequential case, two boards created one after the other in the same folder, already gets `Cards` and `Cards 1`. An atomic claim would replace a path whose value is its simplicity, to guard against a timing no person produces.

**What would change this:** a report of two boards sharing a folder without anyone editing `card-folder` by hand, or a second caller of `makeBoard` that is not a user gesture (a command run in a loop, an MCP tool).

## Mobile is not supported, and the manifest now says so

**Decided 2026-09-10. `isDesktopOnly: true`. Revised 2026-09-30 (#102): that flag is the only desktop gate; the code no longer checks `Platform.isDesktop`.**

`manifest.json` used to declare `"isDesktopOnly": false`, which tells the community directory and every phone user that this plugin runs on a phone. Nothing was ever built for that. `src/theme/` has two media queries, `prefers-reduced-motion` and `forced-colors`, and no `.is-mobile`, `.is-phone` or `.is-tablet` selector at all, where Obsidian's own stylesheet carries hundreds of rules keyed on those classes. Hit targets are fixed at 24, 26 and 30 pixels; several affordances — a card's hover actions, a column's menu — are revealed on hover, which a touch device has no way to produce. No test in the repository exercises a mobile viewport or platform class. The claim was a manifest default nobody had revisited, not a decision.

Honouring it means real styling, real hit-target work and a device to test on. The manifest is what a directory listing and a phone's plugin browser read, so until that work exists the honest value is `true`: a phone will not install it rather than installing something unusable.

The second half of this is Node's `http`, which hosts agent access. `src/obsidian/mcpHttpServer.ts` imports it statically, so the bundle `require`s it when the plugin loads. That is safe because the manifest is enforced, not just advertised: Obsidian's `enablePlugin` returns early for an `isDesktopOnly` plugin whenever `Platform.isDesktopApp` is false, so on a phone the plugin's code never runs at all (read off the app bundle, `docs/ai/reports/20260829.what-obsidian-already-provides/07.guidelines-mcp-build-and-the-rest.md`). The Obsidian lint preset reads the same flag and switches `obsidianmd/no-nodejs-modules` off when it is set. Until 2026-09-30 the import was a dynamic `import("http")` behind `if (!Platform.isDesktop) throw`, with matching checks before building the server, before minting its token and around the settings group; it needed a waiver, an ESLint override and an esbuild override to exist. All of it guarded a case the manifest already rules out, so it went. One side effect: Obsidian's mobile emulation on a desktop sets `isDesktop` false but leaves `isDesktopApp` true, and agent access now keeps running there, which is correct since Node is present.

**What would change this:** someone wanting the board on a phone badly enough to fund the styling pass — touch-sized targets, the hover-only affordances given a tap route, and `.is-phone`/`.is-tablet` layouts — with a device to check it on. That is its own entry when it comes, not a manifest edit. That entry would also have to move the `http` import behind a runtime check again, because the manifest would no longer keep the plugin off phones and `http` does not exist there.

## Agent access stays an HTTP server the plugin hosts, not a command on Obsidian's CLI

**Decided 2026-09-27 (#98). The MCP server keeps its own Streamable HTTP endpoint; `Plugin.registerCliHandler` is not used for it.**

`Plugin.registerCliHandler` (since Obsidian 1.12.2) is the nearest native API, and it is a different behaviour rather than a native form of this one. It registers a command the `obsidian` command line can run: the handler receives one flat map of `string | 'true'` values (`CliData`) and returns one string (`CliHandler`), and the typings give it nothing else, no stdin and no way to write before it returns. An MCP client cannot be pointed at that. It speaks JSON-RPC over stdio or over HTTP, so the handler would sit behind a second program, shipped and installed outside the plugin, that turns every tool call into `obsidian folia-kanban:… key=value` and back, with the nested arguments the tools take (`properties`, whose values can be lists such as `assignee`, and `move_card`'s `line`, an object of its own) squeezed into strings.

What that route would lose, per [Obsidian's CLI help](https://obsidian.md/help/cli):

- **An agent in a container.** It reaches its host through the container's gateway, which is why the bind address exists (see "Moving it off this computer" in `docs/mcp.md`); the help documents no way to reach the CLI from another machine or a container, and no authentication for it, so the bind address and token model have nothing to attach to.
- **A server that is either there or not.** The CLI needs the app running, and when it is not, the first command launches it: an agent's call would open Obsidian on the desktop. The HTTP server refuses the connection instead.
- **Working with no setup outside the plugin.** The CLI needs the Obsidian 1.12 installer, not only the app version, so a user on an older installer has to download and reinstall Obsidian. It is then off until the user enables it under Settings → General and registers it on their PATH, and the handler needs 1.12.2 where the manifest's `minAppVersion` is 1.11.4.

**What would change this:** Obsidian hosting MCP tools for plugins itself, which would replace the server outright, or a documented way for a CLI command to stay open and exchange messages over stdin and stdout, which would let a client launch it as a stdio server with nothing else installed. The second would be a reason to add stdio beside HTTP, not to move off it, since a client that is not on this computer would still need the HTTP server.

## A property row keeps the type its value already has, not the type Obsidian registered for the name

**Decided 2026-09-29 (#77). Editing a custom property in the detail panel keeps the YAML type of the value in the note: a number stays a number, `true`/`false` stays a boolean, and text that type cannot hold is refused with the reason under the field.**

Obsidian's Properties view goes by the type registered for the property name across the vault, but that registry (`metadataTypeManager`) is not in the documented API, and moving off undocumented API is where the plugin is heading. The value in the note is the one type the panel can read without it. The cost: a number that should have been text cannot be turned into text in its own row. The refusal names the way out, adding the property again under the same name in the add row, which writes text; Obsidian's own Number field refuses text as well. A `title:` row always edits as text, whatever YAML read it as.

**What would change this:** Obsidian documenting a way to read a property's registered type. Then both the row and the add row could follow it, and the refusal's way out would have to change with them.

## Folia does not decide for itself what colour goes on a pale accent

**Decided 2026-09-10; updated 2026-09-30 (#103). The text on an accent is Obsidian's choice, as on Obsidian's own buttons.**

Obsidian publishes two variables for text drawn on an accent fill: `--text-on-accent` for a dark accent and `--text-on-accent-inverted` for a light one. The developer docs describe both but never say who chooses between them, which read as a gap in Folia: its primary button's own face read `--text-on-accent` alone, so a user picking a pale yellow accent looked like they would get white text on a near-white button. The open question was whether Folia should measure the accent's lightness itself and switch, or follow whatever the app does and accept the app's limits.

Reading the running app settled it. In Obsidian 1.13.7's `app.css` the two variables are defined once, on `body`, as `white` and `black`, and nothing branches between them: `button.mod-cta` sets `--text-color: var(--text-on-accent)` and stops, `button.mod-warning` does the same on the error fill, and the only rule in the whole stylesheet that names `--text-on-accent-inverted` is a Canvas group label. The choice is made at runtime instead. Setting the accent to `#f5f3a0` put `--text-on-accent: var(--text-on-accent-inverted)` into the inline style of `<body>`, beside the `--accent-h/s/l` triple derived from the same setting, and a popout window opened afterwards carried it too. Folia's primary button and Obsidian's `mod-cta` both computed `rgb(0, 0, 0)` on `rgb(245, 243, 158)`, with no code in Folia that knew the accent was pale.

So the mechanism is the app's, and following it is how a plugin joins it. Detecting lightness in Folia would mean overriding a decision Obsidian already made and that a theme can already override, and it would drift the day either of them changes their mind. Since #103 there is nothing left for Folia to read: its calls to action are `ButtonComponent`s marked with `setCta`, so the text on the accent comes from the app's own rule. Nothing in CI can see Obsidian's inline override, and jsdom cannot compute contrast at all (`test/a11y.axe.test.tsx` disables the colour-contrast rule for that reason), so if Obsidian drops the override the board goes wrong together with Obsidian's own buttons. That is what the re-check below is for.

**What would change this:** Obsidian branching between the two variables in CSS, or dropping the inline-body override in favour of something a plugin has to read for itself. The check is one line in the running app — set a pale accent in Settings → Appearance and read `document.body.getAttribute('style')`; if `--text-on-accent` is no longer rewritten there, this decision is stale and the contrast failure is real again.

## The community-directory action's release mode

**Decided 2026-08-26. Releases stay on release-it plus the repository's own pipeline.**

Obsidian's [`obsidianmd/obsidian-workflows`](https://github.com/obsidianmd/obsidian-workflows) action offers a release mode and a reusable `release.yml`. It creates a draft release for a human to publish, and it knows nothing about this repository's rules: a tag must be plain semver and reachable from `origin/main`, and the release notes come from the changelog section release-it wrote. Adopting it would replace an end-to-end pipeline with a draft and a second copy of checks CI already runs on the same commit. Its scanner half is still used, in PR mode, for drift detection (see `docs/releasing.md`).

**What would change this:** the action learning to publish rather than draft, or the directory starting to require its release mode for listed plugins.

## A push does not run `pnpm verify`

**Decided 2026-09-10 (#45). The pre-push hook runs `pnpm typecheck` and nothing else.**

The hook used to run the full `pnpm verify`, about a minute per push, and the `verify` job in `.github/workflows/pipeline.yml` runs the identical chain on every push to `main` and every pull request into it; `release` needs that job. CI checks after the push, not before: `main` takes direct pushes with no required check, so a commit that fails lands and leaves `main` red, and releases blocked, until the next fix. That is the accepted cost. The release job installs the hooks too, so release-it's push used to re-verify the version bump on top of the verified commit. That re-run goes too: the bump adds a changelog section and rewrites three version fields, and the push still typechecks it. The checks that take a file list run in pre-commit instead. `vitest related` was tried as a push-time subset and left out: a push touching a model file ran half the test files, the slow ones among them, and took as long as the full `pnpm test`.

**What would change this:** a release cut from a machine rather than the pipeline, a release step that changes more than the version and the changelog, CI no longer running `verify` on every push to `main`, or a red `main` becoming common enough to cost more than the minute each push saved.

## Identical checklist lines are told apart by count, not by identity

**Decided 2026-09-19. What occurrence counting cannot see stays, because closing it means writing into people's notes.**

Every write the board makes to a checklist line — a tick, a removal, a column from the menu or the panel, a drag — carries the reading it was decided against, and so does `move_card`; the note refuses the write when the line at that position no longer matches it (`subtaskDrift` in `src/model/card.ts`). A line is named by its position, its words, and which of the lines reading exactly those words it is (`SubItem.occurrence`, counted from the top of `## Subtasks`); a move also names the claim it replaces, and a move to a column the box as well. That closes what the words alone left open (#36, #53): a different line added or removed above a pair of identical lines shifts the position without shifting the count, so the write is refused instead of landing on the twin. `set_subtask_done` is held to the agent's count only when the agent passes it; without it, the tool counts from its own fresh read and the words alone guard against a shift.

What the count cannot see is an edit that slides an identical line into the meant line's place, moving the position and the count together: a twin inserted directly above it; a twin inserted or removed further up while the meant line has an identical line right next to it, which is the one that slides in; or the meant line deleted with its twin right below it. Position, words and count then all still agree, and a tick or a removal lands on the twin. A move is also held to the claim, and a move to a column to the box, so it still refuses whenever the twins differ there. The outcome is hard to tell apart for lines that read the same, and it needs two writers acting on one line in one card within seconds, so it is recorded rather than chased.

Two ways to close it were weighed and left out. Comparing the neighbouring lines as well would turn every edit next to a line into a refusal — an agent's `add_subtask` appending right below the last line would refuse every drag of it — and it still cannot see a twin inserted between the meant line and the neighbour. A stable identity per line (a block id such as `^abc123` written onto it) would settle it outright, and is exactly what #36 settled against: the plugin does not write identifiers into people's notes.

**What would change this:** a real report of a write landing on the wrong one of two identical lines, or a decision to let the plugin write a hidden identifier onto checklist lines. Either would reopen #36's reasoning first.

## The model splits frontmatter itself, where Obsidian's reader does

**Decided 2026-09-29 (#95). The model keeps one splitter, following Obsidian's metadata reader; the adapter does not call `getFrontMatterInfo`.**

Every byte-stable body edit in `src/model/card.ts` runs inside `vault.process` as a pure text transform, and `src/model/cardTitle.ts` reads the same split. `src/model/` cannot import `obsidian`, so it cannot call `getFrontMatterInfo`, and having the adapter split with Obsidian while the model splits the body its own way would be two splitters that can disagree. So the adapter takes the YAML text from the model's `frontmatterYaml` too, and `FRONTMATTER_RE` is the only splitter in the code. This is why #27's ask to split with the offsets Obsidian already computed is not taken for frontmatter.

It follows the reader behind `metadataCache`, because that is where Folia's card fields and board detection come from, and what Obsidian shows as the note's properties: the block ends at the first line after the opening `---` that starts with `---`, the very next line included, so a `---`/`---` block is an empty one rather than no block. It agrees with the reader in Obsidian 1.10.6, 1.12.7 and 1.13.7 on every note with LF or CRLF line endings; `test/frontmatter.test.ts` checks it against a copy of that reader. It still differs where a note uses a lone carriage return as a line ending, which the reader accepts and the rest of the model does not, since it splits every body on `\n`.

Obsidian's writer is stricter: `getFrontMatterInfo`, and so `processFrontMatter`, needs a closing line that is exactly `---`. On a note whose closing line carries anything after the three dashes, a property write from Folia therefore stacks a second block on top of the one Obsidian shows. That is Obsidian's own disagreement and predates this split; it is tracked in the backlog entry "Obsidian's reader and writer frontmatter rules disagree, and a property write can corrupt a note".

**What would change this:** Obsidian changing its reader's rule, which the tests cannot see. When in doubt, compare `obsidianReader` in `test/frontmatter.test.ts` with the tokenizer in the installed Obsidian's `worker.js`.

## Folia's components do not wear Obsidian's undocumented class names

**Decided 2026-09-21. The contract with the host is its documented CSS variables, and nothing else.**

Obsidian dresses its own interface through class names — `clickable-icon`, `mod-cta`, `checkbox-container`, `suggestion-item` and about twenty more — and a plugin can put any of them on its own elements and inherit the app's face for free. That is the obvious shortcut out of half the styling work this repository has in front of it, and it is the one thing this domain will not do.

None of those classes is API. They are not in the developer docs, they carry no compatibility promise, and what they paint is a theme's business: a community theme can redefine, restyle or simply not style any of them, and a release can rename one without it being a breaking change to anything Obsidian published. Wearing them makes Folia's appearance depend on an implementation detail of the app and of whatever theme the user installed, in a way nothing in this repository can check. What Obsidian *does* publish, page by page, is its CSS variables, and a variable is a contract a theme is expected to honour — which is precisely why the board is built on them.

`@layer` is not a way around this either, and it is worth writing down because it looks like one. Unlayered styles beat layered ones whatever their specificity, and Obsidian's `app.css` is unlayered, so moving Folia's rules into a layer would not raise them above the app's — it would push them underneath. Phase 4 replaced the doubled classes with the existing `.folia-scope` ancestor, which gives component rules enough specificity without repeating their class. The doubling guard and shared shadow reset were removed.

The cost is real and accepted: every control the board draws is dressed by hand, and every hover, focus and disabled state with it. `src/theme/host/variables.json` is what makes that bearable — it is the registry of what Obsidian actually documents, so "is there a variable for this?" is a lookup rather than a memory, and `pnpm theme:check` fails any variable the board reads that is neither documented nor recorded as observed in `src/theme/host/observed.json`.

A component from the API is a different matter (#103). `ButtonComponent`, `ExtraButtonComponent`, `DropdownComponent` and `ProgressBarComponent` put `mod-cta`, `clickable-icon`, `dropdown` or `setting-progress-bar` on the elements they create, and that is the component keeping its own promise, not Folia wearing a class. What the rule still forbids is Folia reading those classes: every rule that dresses a host control selects a Folia class added to its element, never the host's.

**What would change this:** Obsidian documenting a class-name contract for plugins — a published list with a compatibility promise, the way the CSS variables have one. A theme-only convention, or a class that merely appears stable across a few releases, is not that.

## Dense controls derive from the host input height

**Decided 2026-09-21. Search and filter chips share `--input-height`; icon buttons subtract one grid step, and mini buttons subtract two, with a fixed 24px minimum for both.**

The board keeps smaller actions inside cards and comments, but their height now moves with the theme's inputs. Making every action input-sized would enlarge those rows unnecessarily. Small print uses five-sixths and eleven-twelfths of the smallest host UI font, producing 10px and 11px at its 12px default without depending on spacing. Pill ends remain an owned shape because a fixed radius rung cannot guarantee a rounded end at every control height.

**Reviewed live 2026-09-21** in Obsidian 1.13.7, dark and light. The toolbar, cards, detail panel and edit-column dialog all hold: nothing clips, every control clears the 24px pointer-target minimum, and both schemes read the same. The review did surface that the mini tier never actually derives anything at Obsidian's own defaults, which is worth stating rather than leaving to be rediscovered: at `--input-height: 30px` the two-step reduction gives 22px, below the 24px minimum, so `--folia-hit-sm` resolves to a flat 24px and only starts tracking the host above `--input-height: 32px`. The floor binding is the intended outcome — a pointer target below 24px is not an acceptable thing to derive — and 24px is also what the token was before it became a formula, so this changes no pixels today. It is kept as a `max()` rather than rewritten as a literal because a theme with taller inputs should still get taller mini buttons.

Since #103 the text buttons are Obsidian's own and take the host's `--input-height` whole; the dropdowns are Obsidian's too and keep a property value's height (see "The board's dropdowns are Obsidian's"). The icon buttons are Obsidian's too and stay on the two tiers above through Folia classes on their elements. Their glyph is the host's size, not the tier's (see the next entry).

**What would change this:** live evidence of clipping or poor legibility in a supported desktop theme.

## Popover icons are the host's extra-small tier

**Decided 2026-09-21 after live review. Icons inside swatches and chips are `--icon-xs`; icons on card and header buttons are `--icon-s`. The card, todo and column menus have since become Obsidian's own `Menu`, which sizes its own icons.**

A live review read the popover icons as having shrunk from 16px to 14px during the move onto the host icon scale. They had not. Before that move every menu-item icon was written `<Icon name="…" size={14} />` in `ColumnMenu.tsx` and `CardContextMenu.tsx`, and the theme carried no `.folia-icon` width rule, so the SVG attribute governed and those icons rendered at 14px. Deleting the `size` prop and setting `--folia-icon-size: var(--icon-xs)` on the containers reproduced the same 14px through the host variable that defines it. The two-tier reading — lighter icons inside a popover, full-weight icons on the buttons you click on the board — is therefore the pre-existing design, now expressed in Obsidian's own scale instead of in hand-written numbers, and it survives a user changing the host icon scale.

Two icons did change size, both upward and both toward the scale: the "no colour" and "no priority" ✕ went from a hand-written 11px to 14px (both have since become words, see "No value" below), and the card quick actions from 15px to 16px.

The icon buttons have since become Obsidian's `ExtraButtonComponent` (#103), which draws its own glyph at the host's `--icon-size`, 18px at the defaults. The card actions, the detail panel's header actions and ⋯ grew from 16px to that size, and the panel's small row actions grew from 14px. They are left at the host's size on purpose. Folia sets `--icon-size` only on its own `.folia-icon`, so that host-rendered Markdown never inherits Folia's sizes, and resizing a host glyph would mean reaching into the component's SVG. Every icon button in the app draws at this size, so the board now matches them.

**What would change this:** Obsidian redefining `--icon-xs` far from 14px, or live evidence that a popover icon at the extra-small tier is hard to recognise.

## Keep standard scrollbars and reduced-motion detection

**Decided 2026-09-21. Keep `scrollbar-width: thin` and `prefers-reduced-motion`.**

Custom scrollbar colours would add platform-specific styling for a small difference with no reported mismatch. The standard reduced-motion query already suppresses entrance animations and the drag overlays' lift tween, and the audit's earlier host inspection found no replacement facility. Phase 2 confirms both mechanisms in source; the unavailable DevTools bridge means it supplies no new live evidence about Obsidian itself.

The drag motion itself is out of that query's reach: dnd-kit writes the sortable slide as an inline `transition` and the drop as a Web Animation, neither of which a stylesheet overrides. `useReducedMotion` reads the same query through `matchMedia` and switches those off through dnd-kit's own options.

**What would change this:** a reported scrollbar mismatch in a supported desktop theme, or a documented host motion preference that the standard media query cannot express.

## Hairlines follow visual purpose rather than drawing technique

**Decided 2026-09-21 after Phase 2 review. Dashed drag placeholders, unchecked todo markers and filled separators follow `--border-width`.**

The former 1.5px token was described as lighter than ordinary borders, but ordinary borders were 1px. Keeping that numeric difference would make these outlines heavier, and the dashed outline and unchecked shape already distinguish their roles. A separator drawn with a background fill serves the same purpose as a border, so its element height follows the host hairline too. This deliberately replaces the earlier argument that a different drawing technique requires a separate thickness.

**What would change this:** live evidence that a supported theme's border width makes the markers ambiguous or separators unusable.

## Check component token dependencies conservatively

**Decided 2026-09-21 after cycle-guard review. Component overrides must not lead back to themselves through any base, light or dark token map.**

Portalled surfaces carry both their component class and `.folia-scope`, so a component declaration can close a cycle with declarations from the token block on that same element. The guard checks that possible overlap without attempting to evaluate every selector and cascade combination.

This is stricter than browser cycle detection for descendants. [CSS resolves custom properties before inheritance](https://www.w3.org/TR/css-variables-1/#cycles), so a descendant can read an inherited computed value without reintroducing its ancestor's dependency edges. The guard deliberately rejects that pattern when it would become cyclic on a scope element. Its diagnostic names the possible overlap rather than claiming every descendant use is invalid.

**What would change this:** a necessary component override that the conservative rule rejects despite demonstrably safe selector placement. That would require a narrower check with a regression test, not a claim that inheritance preserves unresolved dependency edges.

## The board's dropdowns are Obsidian's, chevron included

**Decided 2026-09-21; rewritten 2026-09-30 (#103). The detail panel's Status and subtask column pickers are `DropdownComponent`s. Folia keeps their type and height, never their side padding.**

This entry used to keep the selects bare and go without the chevron, because the glyph is a data-URI declared on the `.dropdown` class alone and wearing an undocumented class is ruled out (see "Folia's components do not wear Obsidian's undocumented class names" above). `DropdownComponent` puts that class on its own element, which is the component's business, not Folia's, so the chevron, its dark variant and the host's hover and disabled states now arrive with the component. Folia's rules reach the element only through Folia classes it adds (`folia-status-select`, `folia-subtask-column`).

What stays the board's is what made the bare selects work in the field grid. Type: the host sets `--font-ui-small`, and beside the panel's text inputs, which all take the metadata input size, 13px reads as a mistake, so the Status picker takes the value's size and height. Padding: `--dropdown-padding` holds `2.4em` at the end, against `0.8em` at the start, for the chevron. That gutter used to be a reason to refuse the variable. Now the chevron is drawn in it, so both pickers keep the host's side padding, and the subtask picker sets only its vertical padding. Focus stays the board's accent outline. The host's 3px `--background-modifier-border-focus` ring, `#555555` on `#333333` and about 1.7:1, is removed on every host control rather than drawn inside it.

**What would change this:** Obsidian dropping the chevron from `DropdownComponent`, or a picker that needs something a `<select>` cannot hold, which would make it a button with a menu instead.

## Focus stays the board's accent until Obsidian ships the focus outline

**Decided 2026-09-21. A focused border keeps `--folia-accent`; `--background-modifier-border-focus`, `--input-focus-outline` and `--input-focus-border-color` are not used.**

The theme-authoring guide shows both declared on `:root` with system keywords (`Highlight`, `Canvas`), which would put focus on the operating system's own colour. Neither is on a `Reference/CSS variables` page, so neither is in the registry, and the theme guard refuses a host variable that is neither documented nor observed — a fallback does not buy an exemption, by design. Read live in Obsidian 1.13.7 both compute to the empty string on `body`: the application does not define them at all, and the only rules naming them belong to the bundled PDF.js annotation layer. So there is nothing to observe and nothing to record; using them would mean writing a value the board invented behind a host variable's name.

`--background-modifier-border-focus` was adopted in their place and then withdrawn, which is the part worth recording. It computes to `#555555`: 2.3:1 against the panel and 1.7:1 against the resting `#333333` border, where the accent it replaced is about 4:1. Eight of the board's inputs suppress `outline` and carry their whole indication on that border plus a 2px accent ring, and at three of them the board's own `:focus-visible` outline is out-specified, so the weakened border *was* the indicator. The audit's plan was the border together with `--input-focus-outline`; with the outline half unavailable, the border half stops being a free swap and becomes a contrast loss.

This is a general shape and not only a focus story: a variable that is right as part of a set can be wrong on its own, and "half of it is still an improvement" is the assumption to check rather than the conclusion to reach.

**What would change this:** Obsidian defining the focus-outline pair in a shipped build, or documenting it on a CSS-variables reference page. Either makes it a registry entry, and then the whole set arrives together and the question reopens with the OS colour on the table.

## A host variable has to describe the object, not sit near it

**Decided 2026-09-21 during Phase 3, after several unprimed reviews. Five host variables are not used, because each describes a different object from the one the board would have spent it on.**

The theme domain's rule is that a `--folia-*` token is an alias or an owned value with a reason. It says nothing about whether the aliased variable *means* the thing it is attached to, and a guard cannot: `pnpm theme:check` validates registry membership and token shape, not fit. These are where fit failed, and they are recorded together because the same mistake produced all of them — reaching for the nearest published name rather than the one whose object matches.

- **`--popover-max-height` on the column menu** (since replaced by Obsidian's own menu). The `--popover-*` family is the file-preview card: `--popover-width: 450px`, `--popover-height: 400px`, `--popover-pdf-width`, `--popover-pdf-height`. Its `95vh` ceiling would have raised a 440px action menu to roughly 760px on an 800px window. A ceiling looked generic enough to borrow while rejecting the family's widths; it is not, and `none` is a legal value for it, which would have made the call site's `min()` invalid and removed the cap entirely.
- **`--blockquote-border-thickness` on the comment rail.** That left border's colour is how read, unread and reply are told apart, so a theme that draws borderless quotes would erase a state cue by changing something about quotations. Comments are not quotations.
- **`--checkbox-radius` on the to-do preview marker.** The radius is the corner chosen for a 16px control, and the marker is 8px and keeps its own size on purpose. Half of a coupled pair leaves a theme free to turn the marker into a dot.
- **`--metadata-property-radius` on the property input.** That is the property *row's* corner; the row is `.folia-prop-row` and the input is the value inside it. The input takes `--input-radius`, because with the border the board keeps on it, a text input is what it is.
- **`--pill-padding-x` on the filter chip.** Obsidian never spends it as box padding: `.multi-select-pill` sets `padding: var(--pill-padding-y) 0`, and this variable is an inline-start margin on the pill's content and an end margin on its remove button. Read as symmetric padding it is a number without its meaning, and it took 4.2px a side off every chip.

A second, narrower rule came out of the same reviews, and it accounts for three more. **A variable a theme sets to zero must not be the only thing holding up a signal.** `--blockquote-border-thickness` on the comment rail — which fails both rules, and is listed above for the first — `--nav-indentation-guide-width` on the subcard group and `--pill-border-width` on the filter chip each govern the *existence* of a line that the board then colours to say something: read against unread against reply, "these belong to the card above", on against off. A theme that draws borderless quotes, hides indentation guides, or ships a flat pill — Obsidian's own property pills declare `--pill-border-width: 0` — would take the signal with the line. The same test is what keeps `--tag-border-width` out of the card chips, whose translucent tints have no other edge.

**What would change this:** the board changing what the element is — a comment rail that no longer carries state, a preview marker that follows the host checkbox size, a property row drawn as Obsidian draws one without a border, a filter chip whose on-state stops using its border. For the zero rule specifically, a second cue strong enough to carry the state on its own would make the line safe to hand over.

## What the board keeps painting itself, now that Obsidian's colour variables are in reach

**Decided 2026-09-21. Eight things keep a colour of Folia's own, plus two gaps this phase found and did not close, because the host variable would erase a distinction the board is making on purpose, or because taking it would be a change nobody here can check.**

Phase 1 of the theme work moved the board onto Obsidian's semantic colour variables wherever the board was inventing an answer the app already publishes: form fields, accent text, error, warning and success surfaces, icon colours, the done-item decoration, links, and the drop target (links later took a colour of their own; see [Readable text beats the host's exact colour](#readable-text-beats-the-hosts-exact-colour)). Some of those are trade-offs rather than wins, and this is where the trade-offs landed.

**The two inline rename inputs keep the page background.** `.folia-card-title-input` and `.folia-column-title-input` replace a piece of text in its own slot, inheriting its weight, size and line height so that entering and leaving edit mode does not shift anything. `--background-modifier-form-field` is a recessed fill whose whole job is to announce "this is a field", which is the opposite of what these two are for. Every field the user goes *to* — the search box, the menu field, the add-column input, the card and inline add inputs, the detail fields, the property input, the description and comment editors — takes it.

**The tinted chips keep their own mixes rather than the host's warning and error colours.** `.folia-chip-prio-1` to `-4`, `.folia-chip-warn` and `.folia-chip-danger` mix a percentage of the priority ramp into `--text-normal`, and since 2026-09-29 those percentages come from a measurement rather than from tuning by eye: 50% of the ramp colour, 40% for the yellow `prio-3`. `--text-error` and `--text-warning` are single colours with no relationship to that measurement, so swapping them in would re-open the contrast question. CI cannot answer it — jsdom cannot compute contrast, and `test/a11y.axe.test.tsx` disables that rule for exactly this reason — so it is answered by hand in a live Obsidian with `pnpm contrast:live`; [Readable text beats the host's exact colour](#readable-text-beats-the-hosts-exact-colour) has the method and the numbers, and third-party themes were not measured. Visual regression is guarded by a structural-snapshot net and the theme guard rather than by a pixel diff — `tracking/waivers/0003-visual-regression-automation.md` retired itself on that basis and accepted one residual, a rendered-pixel change that alters no structure and no token, which is exactly what a re-tuned percentage is, so a change to one needs `pnpm contrast:live` run again. The mixes that blend two opaque colours stay `in srgb` while those that blend into `transparent` moved to `in oklch`; `src/theme/README.md` states that rule where the mixes are.

The plain warning surfaces beside them did move. The folder notice and the "behind" bar take `--text-warning` as their hue rather than the priority ramp's orange, which is what they were built out of; they still mix, because Obsidian documents no warning background at all.

**The danger fill stays on the palette.** `--folia-danger` fills the over-limit badge and the urgency tint, and Obsidian publishes no fill for it: the documented pairing for `--background-modifier-error` is `--text-normal`, which makes it a surface text sits on rather than a fill. It stays on the palette's red, and separate from `--folia-text-error`, which is what every foreground reads. The success fill went when the progress bar became Obsidian's (see "The card progress bar is Obsidian's"). One token doing both duties is how a fill ends up painting text.

**The filter chip's "on" state keeps its accent tint.** `--background-modifier-active-hover` is the app's answer for a plain active surface, and `.folia-column-body.folia-is-over` now uses it. The filter chip is not that: an active filter is a statement about what the whole board is currently showing, and the accent tint is the signal. A neutral active background would flatten it into the same grey as a hovered row.

**The swatch ring stays shape rather than colour.** `.folia-swatch.folia-is-active` draws a two-tone ring, which reads on any fill including the eight column colours themselves. There is no host variable for "this swatch is the chosen one", and a colour-based marker would be invisible on the swatch whose colour it matched.

**And the ring marks what the note stores, not what the column is wearing.** A column whose note assigns no colour is painted from `autoColor`, which derives a palette colour from the column's id so that a plain `columns: [todo, doing, done]` board still reads as colour-coded. Until 2026-09-21 such a column ringed nothing: it offered nine choices and marked none of them, in both schemes. The ring now goes on the "No colour" choice, because that is the true statement — ringing the palette swatch the column happens to resolve to would claim a decision nobody made, and would make clicking that swatch, which does change the note, look like a no-op.

**Three of Obsidian's link variables are unread, and the same rule blocks all three.** The community-directory CSS scan refuses every `text-decoration-*` longhand and every multi-keyword `text-decoration` shorthand, and it refuses the *property*, so putting a variable in the value changes nothing — verified each time by `pnpm obsidian-scan:check`, which reported the lines the moment they were written and cleared when they were removed. That costs the board `--link-decoration-thickness` on a resolved link, and `--link-unresolved-decoration-style` and the pairing that would carry it on a missing one. A theme that thickens its links, or draws unresolved ones wavy, reaches every link in the vault except the board's. The plain `--link-decoration` and the unresolved colour and filter are all readable and all read; the unresolved opacity is readable but left unread for contrast, see [Readable text beats the host's exact colour](#readable-text-beats-the-hosts-exact-colour).

**Beyond the scan, the unresolved marker could not take `--link-unresolved-decoration-style` anyway.** It reads three others of that set — colour, filter and decoration colour — and leaves the opacity out for contrast. The dashes stay a literal, and would have to even if the scan changed its mind: the marker is drawn as a `border-bottom`, and a border cannot take that variable safely, because `text-decoration-style` accepts `wavy`, which is not a border style. A `border-bottom` shorthand that inherited `wavy` would be invalid and draw nothing, so a theme choosing it would erase the missing-link marker rather than restyle it.

**The subitems chevron does not take `--nav-collapse-icon-color`.** It was adopted and then reverted on measurement, which is the useful part. The pair Obsidian publishes for a collapse arrow — the colour and its collapsed variant — are the **same value** in the default theme, `#666666` in dark and `#ababab` in light, so the collapsed state gains no colour from them and the rotation remains the whole signal either way. Worse, they are sidebar colours, tuned against `--background-secondary`; this chevron sits on a card, against `--background-primary`, where `#ababab` on `#ffffff` is about 2.3:1 — under the 3:1 minimum for a non-text indicator. Adopting a variable because its name matches the widget would have made the control harder to see in light mode in exchange for nothing. The chevron keeps its label's colour.

**Icon buttons are Obsidian's own now, so their colours and opacity are the host's.** Phase 1 copied Obsidian's icon-button response (`--icon-color` with the hover in `--icon-opacity` 0.85 → 1) onto a button of the board's. Since #103 the button is the host's `ExtraButtonComponent`, and the copy is gone. Only the Mark done and Delete hover colours are the board's.

**Equal-specificity refinements still depend on import order.** `pnpm theme:check` enforces scoped button face rules and resting property coverage through `scripts/theme-buttons.mjs`. It does not simulate the full cascade between the board's own state rules. Source-order regression tests protect the known link refinements. The Mark done and Delete hover colours win over the host's icon button by weight, and the guard fails any later rule of the board's that sets a hover colour on the same buttons. A new state interaction still needs a live check.

**`--folia-font-mono` no longer has `monospace` behind it, and nothing needs to stand behind it.** `--font-monospace` is not in Obsidian's published variable list, so if a build did not define it, `font-family: var(--folia-font-mono)` would be invalid at computed-value time and the filter suggestion key, its one reader, would silently take the interface font. The fallback went because the audit's 02-05 asked for it, and the guard would refuse to put it back anyway: a literal nobody documents is exactly what it no longer accepts. What makes that safe is a check someone made, not a guess: the variable was found declared on `body` in the app bundle of every release from 1.11.4, the manifest's `minAppVersion`, to 1.13.7 that was looked at (the builds and the command are in `src/theme/host/observed.json`; Insider-only builds were not), and `pnpm theme:check` now fails if an observed variable's `oldestChecked` is newer than `minAppVersion`, so lowering the floor, or recording a new undocumented variable seen only on a newer build, fails until someone checks the older one. The guard trusts `oldestChecked` as written; it cannot open a bundle itself. Documented variables have no such check: `host/variables.json` records no version they arrived in.

**What would change this:** a visual-regression harness plus an automated contrast gate would let the chip percentages and the other srgb mixes move freely. `pnpm contrast:live` is the contrast half, but manual rather than in CI. The visual-regression half has no open tracker — `tracking/waivers/0003-visual-regression-automation.md` retired itself and accepted that residual. For the rename inputs, Obsidian documenting a variable for an in-place edit affordance — a field that is meant not to look like one — would settle it the other way. For the missing-link marker, the community scan accepting the text-decoration longhands would remove the first half of the reason; the `wavy` problem would still need a shape that is not a border.

## Readable text beats the host's exact colour

**Decided 2026-09-29, after measuring the board live. Where a host colour fails WCAG AA's 4.5:1 for text the board draws, the board takes a readable colour derived from it; where the text is Obsidian's own rendered Markdown, the host colour stays.**

`pnpm contrast:live` runs axe-core's `color-contrast` rule inside a running Obsidian (the script's header says how to start one and what it opens). axe alone misses two kinds of text, and the script covers both. It skips text scrolled out of its container, which is most of a board, so every scroll container (the board, each column, the detail dialog) is stepped through its whole range. And it reports text as "incomplete" when it cannot resolve the colours behind it: a card's priority bar is a pseudo-element, an urgency tint is a gradient, and Chrome serialises the host's hover fill as an `oklch(… none …)` it cannot parse. Those are most of the card chips. The script measures each such Folia node from pixels instead: it hides the text, captures the window under the text's box, and composites the text colour, with its alpha and every ancestor's opacity, over each colour covering at least 5% of that box, keeping the worst. The result counts like an axe failure. Text Obsidian owns is listed but not counted.

On 2026-09-29, in Obsidian 1.13.7 with the default themes and accent and axe-core 4.13.0, it found these failures, fixed as follows. Ratios are on the background the text actually sits on, the worst one where it appears on several. The detail panel was still a side panel on `#f6f6f6` in light and `#282828` in dark when the "before" numbers were taken; it has since become Obsidian's own dialog, on `--modal-background` (`#ffffff` and `#1c1c1c`), and every panel "after" number below was measured there. The board measures with no dialog open, and the dialog on its own, since its backdrop covers the board.

| Text | Before | After |
|---|---|---|
| Context chip, light (`DSGN`, `ENG` in the showcase) | 1.95:1 and 2.44:1 | 7.65:1 and 8.26:1 |
| `.folia-muted` (the title reason, "No subtasks yet." and the other empty lists) | 2.12:1 light, 2.56:1 dark | 6.68:1 light, 8.12:1 dark |
| "Why this title?" and every other `.folia-link`, light | 3.94:1 | 5.93:1 |
| The same links under the pointer, light (computed before, colour measured after) | 2.54:1 | 5.87:1 |
| Subtask column picker, faded at rest | 4.26:1 light, 4.41:1 dark | 5.89:1 light, 5.72:1 dark |
| Other `--text-faint` text: group headings ("Overdue") and a lane's rule on a column; comment timestamps and the title trace's labels in the dialog | 2.12:1 light, 2.56:1 dark | column 6.18:1 light, 7.03:1 dark; dialog 6.68:1 and 8.12:1 |
| WIP over-limit count, white on the palette red | 4.2:1 light, 3.45:1 dark | 10.27:1 light, 6.61:1 dark |
| A relation or subtask link naming no card (`.folia-link-missing`), computed before | 2.53:1 light, 3.37:1 dark | 5.48:1 light, 7.04:1 dark |
| Priority chips on a card, light (`prio-3`, `prio-2`) | 3.47:1, 4.09:1 | 5.15:1, 4.92:1 |
| Danger and `prio-1` chips on an overdue card, dark | 4.55:1 | 4.93:1 and 5.05:1 |

- **No text the board draws reads `--text-faint`.** Faint is `#ababab` in light and `#666666` in dark, which no background Obsidian ships makes readable, so `.folia-muted` and every other label that used it read `--text-muted`; italics, size and capitals keep them secondary. Faint stays on dashed edges, which are not text. The empty-column placeholder also lost the opacity it faded with, for the same reason.
- **The chips on a card mix half their colour into `--text-normal`, the yellow `prio-3` 40%.** They sit on their own tint over a card that may carry an urgency tint of its own, and at the old 58–60% the light priority chips measured 3.47–4.09:1. At the new values every tone measured at least 4.9:1 in both schemes on the plain and overdue cards the showcase shows; on a due-soon card, which the showcase cannot show because its dates are fixed and now all past, the same mixes computed at least 4.9:1 from Obsidian's default palette. The WIP over-limit count, which was white on the palette red, now uses `--text-normal` on the danger tint; the column's red edge and header tint carry the alarm.
- **The context chip's text is 30% of the context colour and 70% `--text-normal`.** The colour comes from a `_context.md`, so it can be anything; at 30% every sRGB colour, white and black included, stays above 5:1 on its own tint over each card, panel and urgency-tinted background of both default themes. The tint, the border and the strip still carry the hue. The sibling chips mix more of their colour because their colours are a known ramp.
- **The subtask column picker fades a little less.** Faded to `--folia-opacity-subtle`, 0.6, its label fell just under 4.5:1 in both schemes. It now fades to `--folia-opacity-muted`, 0.7, which keeps the whole control, frame and chevron included, quieter than the subtask text and clears 4.5:1. A disabled picker, on a link naming no card, stays faded when its row is hovered.
- **Folia's own links mix a quarter of `--text-normal` into `--link-color`.** Obsidian's default light `--text-accent` and `--link-color` are `#8a5cf5`, which is 4.26:1 on `#ffffff`, the lightest surface the app has, so no background Folia could choose makes it pass; only the foreground can change. The mix, 75% link colour and 25% `--text-normal`, keeps the theme's hue and follows any accent, and for the default accent clears 4.5:1 on `--background-primary`, `--background-secondary` and `--background-primary-alt` in both schemes (at least 5.5:1 in light and 6.4:1 in dark). The hover colour is a lighter accent in light, which at 75% measured 3.8:1, so it mixes 55%. Neither is a guarantee for every accent: a pale accent chosen in Settings can still fall short, as Obsidian's own links do with it. `--folia-link-color` and its hover are therefore owned tokens now, not aliases.
- **A link naming no card is dimmed by colour, not by opacity.** Obsidian draws an unresolved link as its accent at `--link-unresolved-opacity`, 0.7, which was 2.53:1 on the side panel in light and 3.37:1 in dark, and would be 2.65:1 and 3.71:1 on the dialog. The board's `.folia-link-missing` instead takes half the unresolved colour mixed into `--text-muted`: quieter and greyer than a resolved link, with its dashed underline, and above 5:1 in both schemes.
- **Links in rendered Markdown keep Obsidian's colour, and fail in light.** The description and the comments are rendered by Obsidian's `MarkdownRenderer`, and their links are coloured by the app's own rule from `--link-color`. The board could override that with its own rules inside its rendered Markdown, but it would then own the link, hover, external, unresolved and tag colours there, and the same link would look different on the board than in the note it came from, which is exactly the consistency with the vault that reading host variables is for. That rendered link was the one failure the 2026-09-29 run still reported: 4.25:1, `#8a5cf5` on the dialog's `#ffffff`, in light only (6.18:1 in dark). It was 3.94:1 on the old side panel's `#f6f6f6`. `#8a5cf5` is Obsidian's default light `--link-color`, and the dialog's white is already the lightest surface the app has, so no background the board could choose would clear 4.5:1. `pnpm contrast:live` still lists it, and prints it, in the light theme only, as this documented host exception instead of failing; the same link failing in dark would fail the run. The exception is only as wide as what was measured: the script grants it only while the link is drawn in Obsidian's own `--link-color` and stays at 4.2:1 or better, so a darker dialog or a recoloured link fails the run. Likewise, an external link, a tag or an unresolved link in rendered Markdown is not in the example and not exempt, so the first one to appear fails the run until it is measured and decided.
- **Highlights and code-block tokens in rendered Markdown keep Obsidian's colours too, and fail where the host's do.** Measured 2026-09-30 (#92), when `Polish the detail panel` gained a highlight and a code block: in dark, a `==highlight==` is 4.15:1 (`--text-normal` #dadada on `--text-highlight-bg`, #776411 over the dialog); in light, the default syntax colours are 1.99-2.49:1 on `--code-background` #fafafa. The same text in the note fails identically, and did before #92, which only moved the highlight rule from the host's reading-view class to the panel's own rule with the same variables. Both are exceptions for the reason the link is, and as narrow: the highlight only in dark, only while its text is the live `--text-normal` on a fill that is exactly the live `--text-highlight-bg`, and at 4.1:1 or better; a code token only in light, only inside a rendered code block whose fill is exactly the live `--code-background`, only in one of the `--code-*` colours, and at 1.9:1 or better. The light highlight and the dark tokens pass and are not exempt.

**What would change this:** a new surface or state the script does not open (the column settings are not measured yet; the card and column menus are Obsidian's own); Obsidian darkening its default light accent, or otherwise shipping a `--link-color` that passes on its own surfaces, which would close the host exception and let Folia's links go back to plain aliases; a panel whose Markdown is not Obsidian's rendered output; or a decision that the board's rendered Markdown should diverge from the vault's for legibility.

## A column the board note fades

**Decided 2026-09-29. Text in a column the board note fades is allowed to fall under 4.5:1 while it is faded, because the fade is the user's choice and hovering or focusing the column undoes it.**

A board note can give a column `opacity` and `hoverOpacity` (the parked lane of the Feature Showcase uses 0.45 and 0.95). Folia applies the first to the whole column at rest and the second while the pointer is over it or focus is inside it. At the example's 0.45, everything in the column measures between 2.0:1 and 3.5:1 in the default themes: its title 3.14:1 in dark and 2.72:1 in light, a card title 3.54:1 and 2.74:1, "Add a card" 2.4:1 and 2.02:1, its muted chips about 2.6:1 and 2.0:1. No fade deep enough to be seen keeps that text readable: `--text-muted` stops passing somewhere below 0.85.

So `pnpm contrast:live` prints those nodes as this documented exception, and only while the column is actually faded: `.folia-column.folia-is-faded`, an opacity below 1, not hovered and without focus inside. It then measures every faded column again at its `hoverOpacity` and counts that like any other text. At the example's 0.95 all of it passes (the muted chips at 6.3:1 in dark and 5.2:1 in light), which shows the fade is the only reason it fails. A `hoverOpacity` below about 0.85 would fail in its revealed state too, and that is the same kind of choice by the note's author.

**What would change this:** a report that the reveal is not discoverable, so a faded lane reads as unreachable rather than set aside; a request to clamp the fade to a floor that keeps text readable; or a fade applied to the column's frame and fill but not to its text.

## Button faces share the host palette without flattening board semantics

**Decided 2026-09-21; updated 2026-09-30 (#103). Text and icon buttons are Obsidian's own components and wear its faces. Links, disclosures, chips, swatches and the add tiles keep the shapes and signals that describe their purpose.**

Since #103 the board draws no neutral or primary button face of its own. A primary action is a `ButtonComponent` set as the call to action, so it takes the host's accent. The hand-drawn controls that remain are the groups named in "Icon-and-label controls stay hand-drawn" and "In-text links and disclosures stay hand-drawn". The filter chip keeps Phase 3's pill radius and coloured on-state. Card chips keep their tag geometry and tuned tints, and colour swatches keep the host swatch radius and shadow. Applying the button radius or neutral fill to those would erase distinctions established in earlier phases. Links and disclosure controls remain transparent. The column-add button keeps the host raised shadow, and the dashed add-column tile stays transparent and flat so its border remains visible.

Every control's focus indicator is the board's accent outline from Phase 3. The host's own focus ring is removed from its controls, because its default border-focus colour has the contrast limitation recorded above. The same reset also takes away the hover shadow Obsidian gives a dropdown that has focus from a click. Keeping it would mean excluding the class the host adds to mark that focus, which is a selector on a host class, so the shadow goes. That same host rule also hides the outline, the board's included, while a dropdown has focus from a click: the component marks such focus on mousedown and clears it on blur, as every dropdown in Obsidian does. Focus that arrives from the keyboard shows the board's outline. Overriding the host there would draw a ring after every click, which `:focus-visible` exists to avoid.

**What would change this:** a change to what these controls represent, or a shipped host focus indicator that meets the earlier decision's conditions.

## Host button fills cannot be the only interaction signal

**Decided 2026-09-21 after Phase 4 review. Keep host button colours, and draw an independent pointer cue where the host pairs can collapse.**

Obsidian 1.13.7 gives macOS the same resting and hover neutral fill, with no input shadow in either state. Its default error and error-hover fills are equal in dark and light on Linux too. A published pair therefore does not promise two distinct appearances. The earlier removal of the brightness filter lost the danger button's independent cue; adopting both host variables did not replace it.

Since #103 the text buttons are Obsidian's own (neutral, and the accented call to action; the board draws no danger text button), and they, the filter chips, the add-column tile and the column-add controls carry the pointer outline. The icon buttons, destructive ones included, are the host's too and take its hover alone. The danger-button measurements below are the history of how the outline was chosen. These controls keep their host fills. Their hover adds a 1px inset outline in the label's current colour. Pressing thickens it to 2px **and moves it deeper**, to twice that inset, so the pair differs in where the ring sits as well as how heavy it is and the two lines never overlap. The thickening alone was the whole pressed signal until the final verification measured it: one pixel of line at dpr 1, and under `.mod-macos`, where the fill pair collapses and `--input-shadow` is `none`, hovered and pressed were the same picture. Obsidian draws no pressed state on its own buttons, so there is nothing to alias here.

Two richer mechanisms were tried first and both withdrawn on measurement, and the two rejections have the same shape: **a pressed cue may not spend something the control needs.**

The first was a tinted face. A veil in the label's own colour moves the face **towards** the label, so on a filled control it eats the very contrast that makes the label readable. Measured in the default dark theme, a 12% white veil takes the primary button's resting face from 4.26:1 to about 3.52:1, and its hovered face — which is where a press actually happens, since the pointer is on the control — from 2.75:1 to 2.40:1. A veil in the opposite direction only relocates the failure, because "away from the label" points one way on an accent face and the other way on a neutral one, differently again per scheme. There is no single tint direction safe for every control in the pointer set, so it spends contrast.

**A measurement worth keeping separate from that argument:** the primary button's white label is already at 2.75:1 against its hovered face, in both schemes, and 3.43:1 against its resting face in light. That predates all of this and none of it was introduced here, but it means the ring's "inherits the label's own contrast" guarantee inherits a number that is itself under 3:1 while the pointer is on an accent button. The ring is still the safest of the three mechanisms, because it adds nothing to the deficit and the other two subtract from it; it is not a certificate that the accent face is fine.

The second was `transform: scale(0.97)`. It spends the hit area. A transform scales the element's real hit box, so with the pointer stationary the boundary moves inward under it — 0.9px a side on a filter chip, 3.3px on the add-column tile — and a press that begins in that outer strip lands its `mousedown` on the button and its `mouseup` on the parent, which fires no `onClick` at all. Nearly every control in this set commits on click and none captures the pointer. It was also too small to be the cue it was meant to be: 3% of a 60×30 chip is under a pixel a side.

Moving the ring spends neither. An outline is paint: it changes no layout and takes part in no hit testing, and because it is drawn in `currentColor` **on the control's own face**, its visibility is exactly the label's own contrast on that same face — whatever that number is, the ring neither improves nor worsens it. That last clause is why the pressed offset is negative rather than zero. An outline drawn outside the border box would be answerable to whatever surface the control happens to sit on instead, and a primary or danger button, whose label is `--text-on-accent`, would paint a white ring onto a white menu in light mode — the cue vanishing exactly where it is needed. Staying inside also keeps the ring off the selected-choice shadow, which is drawn outside the border box and whose 2px neutral separator an outside ring would cover.

This is not the only mechanism that could have worked; it is the one that costs the control nothing it already spends elsewhere. A cue that displaces an inner layer while leaving the hit box alone would satisfy the same constraints and is worth reaching for if this one ever proves too quiet.

The outline width and its two offsets belong to Folia because a theme may zero its border widths and shadows. Neither moves layout, alters the selected-choice shadow, or recolours the entire control with a brightness filter. Keyboard focus keeps its separate 2px accent outline; disabled controls and the add-column form do not receive the pointer outline.

Suggestions need no signal of Folia's. Every suggesting input, the search box included, opens Obsidian's own popup (`AbstractInputSuggest`), and the popup draws its selected row itself. The 2px inset marker Folia's hand-built filter dropdown carried went with that dropdown.

Borders must remain distinguishable from the fills they enclose. The dashed add-column tile returns to transparent with no shadow, and filter chips rest on `--background-primary`. Bordered controls retain these fills while hovered or pressed; `--interactive-hover` can equal their border by definition on macOS. Their pointer outline supplies the state change. The add-column editing form keeps its resting appearance under the pointer. Selected colours and rings remain unchanged.

A disabled custom-colour swatch is a read-only sample, so it retains full opacity and its selection ring. A disabled button is dimmed by Obsidian, and none of the hand-drawn controls is ever disabled, so the board draws no disabled face of its own. Focus rounding is local to the column title and parent reference, which otherwise have no corner; controls with a radius retain their own.

Mutation tests protect the pointer-outline consumers and pressed width, including their owned token values. These are source contracts, not a contrast or general state-cascade resolver: default-theme and macOS-variable checks in the running app remain the evidence for distinct appearances.

**What would change this:** an equally dependable host contract for hover and pressed signals across platforms and themes. A difference in the default Linux values alone is not enough.

## "No value" is words in the row, not an icon

The colour row ends with the choice that removes the value, and says so as text: **No color**. An unlabelled ✕ read as "close" rather than as a choice, and in light themes faded into its surface. A ⊘ glyph and a detached clear icon at the row's end were compared live in both schemes: the glyph stays an icon to decode, and the detached icon's selection ring, which this choice needs because a column with no stored colour is making it, sat oddly on a borderless icon. It is drawn as an empty slot, with no fill and a dashed `--text-faint` edge, the Add column tile's "nothing here yet", and its pointer cue is that tile's dashed outline.

The card menu's priority rows end the same way, with **No priority**, but they are Obsidian's menu rows now, so how the row looks and how the current choice is marked are the host's. What stays the board's is the word. Not "None", although it is shorter: a card can say `priority: none`, which is an off-scale value the menu offers like any other, and two rows reading "None" would be told apart by a checkmark alone, and by a screen reader not at all.

**What would change this:** a host pattern for a "no value" choice inside a row of values, which Obsidian does not have today: its own clear controls (the search and combobox ✕) empty a field rather than sit among choices.

## The card, todo and column menus are Obsidian's `Menu`

**Decided 2026-09-30 (#89). The three menus are built from `Menu` and `MenuItem` members that `obsidian.d.ts` documents, through `CardRepository.showMenu`, and whatever such a menu cannot hold left it.**

The board had its own menu: portalled, positioned and clamped by hand, closing on an outside pointer, with its own roving focus, focus return, dividers and labels. Each of those was a bug fixed once per component (#72, #73, #74), and both menus had outgrown their own height cap (#57). Obsidian's menu does all of it, and a theme styles it the way it styles every other menu in the app.

What left with it:

- **Priority and "Move to" are plain rows with a checkmark**, not pills in the priority's colour. A menu row has no colour of its own, and `MenuItem.setSubmenu` is not in the typings.
- **Column title, colour and WIP limit are edited in the Edit column dialog**, which already had all three. A menu row cannot hold a field, so the column menu keeps "Edit column…".
- **A middle click on "Open note" no longer opens a new tab from the menu.** A modifier click still does, and the card's own Open note button keeps the middle click.
- **The ⋯ button no longer stays lit while its menu is open.** The port says nothing about the menu closing to the caller, and the button carries no open state.

No row is given a section, and neither are the rows Folia adds to Obsidian's file, folder and editor menus, "Create Folia board here" and "Convert to Folia board" (#107). `MenuItem.setSection` is documented, but the only section ids its documentation points to are the ones Obsidian's own menus carry in the DOM, which it does not document. So the board's rows stay in the order the board adds them, split by separators, and the board-setup rows land in the unsectioned tail of Obsidian's menus.

A menu opened from the keyboard sits under the element it came from, and when it closes with focus on nothing, focus goes back to that element. The menu never takes focus: it reads its arrows, Enter and Escape off the window while focus stays on the card. Any other key still reaches the card, where Space would lift it under the open menu, and a Tab to another card followed by Enter would spend the Enter on the first card's highlighted row. So the menu closes on any key it does not take and when focus moves on to another element, and opening a menu closes the board's one still showing. On Windows the Menu key is followed by the platform's own contextmenu on keyup, at a point on the focused card; the card ignores that one, so the menu stays under the card. These rules live once, in the adapter (`src/obsidian/menu.ts`) and the card, rather than in each menu.

With Settings → Appearance → **Native menus** on, which is Obsidian's default on macOS, the same `Menu` is drawn by the operating system. It then has no icons and no red destructive row, "Priority" and "Move to" show as greyed-out rows, and the checkmarks are the system's. The OS menu holds the keyboard while it is open, so the stray-key rule never fires there, and it can take the window's focus, which is why only focus moving to another element, not focus leaving for nowhere, closes the menu. Checked on Linux 2026-09-30: the rows, the checkmarks, a pick, dismissing with focus returned under a keyboard anchor, and a modified Open note reaching the repository as a modified click.

**What would change this:** Obsidian documenting submenus or its menu section ids, or a menu that needs something a row cannot hold, which belongs in a dialog instead.

## A lane offers to add a card only where the card can be given what its rule asks for

**Decided 2026-09-27 (#41). Adding a card to a lane writes the plain values its rule names; a lane whose rule a new card could never meet shows the rule instead of an add button.**

Four shapes were built and compared live in both schemes: the button hidden on every lane, the button kept but disabled with the reason in a tooltip, the refusal toast reworded for the add case, and this one. Hiding it everywhere looked cleanest but took away a lane where adding plainly makes sense: someone adding to an `area:research` lane means a research card. A disabled button reads as broken chrome. The reworded toast still arrives after the title has been typed and throws the title away.

The fill covers the tokens whose value a note can simply hold: `area`, `priority` (in the board's own spelling), `tag`, `assignee` (`me` through **Your name**), a literal due date and `due:today`. It leaves alone the tokens that describe a state (`is:`, `unread:`, `due:soon` and `overdue`), a place (`status:` is the column the write already names; `context:` is the subfolder a card lives in, and a new card is written straight into the card folder, which has none), an absence (`none`), and free text, which only the title can match. It does not have to decide which rules succeed: the filled card is put to the rule, and the control shows only where it would be drawn. Two values one property cannot hold at once (`area:a area:b`) therefore hide the control without a special case. Free text is the exception, set aside when the control is decided because there is no title yet: a `roadmap` lane keeps its button, and a title missing the word is refused on submit with the typed title left in the box.

**What would change this:** a create form that can set any property before the note exists, which would let the add flow ask for what a state-reading rule needs rather than hide the control.

## A same-note heading link in the card detail panel does not move

**Decided 2026-09-30 (#82). A link in a card's description or comment opens its note like any other link in Obsidian, except a same-note `[[#Heading]]`, which does nothing.**

A click is followed only when the anchor's `href` attribute names a note. An `href` with a URL scheme is left to the app, and one starting with `#` is left alone: that is how a tag, a footnote and a same-note heading all render, and nothing documented tells them apart without reading Obsidian's class names. Following the heading would also open the card's own note in another tab, at a heading the panel is already showing. `[[Note#Heading]]` renders without the leading `#`, so it opens the note at the heading.

The `href` is passed on undecoded. Read live in Obsidian 1.12.7 and 1.13.7, it is the linktext exactly as the metadata cache records it (`A%20B`, `100% Done`), not a URL, and it equals `data-href`. A Markdown link arrives already decoded: `[x](A%20B.md)` renders as `A B.md`. Decoded, a link to a note named `A%20B` resolves to nothing, and a click would create a stray `A B`.

**What would change this:** a documented way to tell a heading link from a tag or a footnote, or a way to scroll the card note in the panel itself. If a later Obsidian starts percent-encoding the `href`, the decode has to come back.

## Suggestions are Obsidian's popup, even though screen readers cannot see it

**Decided 2026-09-30 (#93). Every suggesting input uses Obsidian's `AbstractInputSuggest` popup, which exposes no roles to assistive technology.**

The toolbar search used to be a hand-built combobox with `role="combobox"`, `aria-expanded` and `aria-activedescendant` over a labelled listbox, and the priority, assignee and relationship fields used `<datalist>`, which browsers expose natively. Obsidian's popup, as shipped in 1.13.7, sets no role and no `aria-*` on the input or its rows, so a screen-reader user typing in these fields is not told that suggestions exist or which one is selected. Adding the combobox attributes from the plugin was rejected: the rows and the selection belong to the popup, which offers no documented hook to give a row an id or to hear the selection move, so `aria-expanded` would announce a list that cannot be read. Enter keeps what was typed wherever the text is free (a plain search word, a priority, a name, a card link), so a user who cannot see the popup does not have a row chosen for them.

**What would change this:** Obsidian giving its suggestion popup accessible roles, or documenting a hook for row ids and selection changes that would let the plugin supply them.

## Tooltips are aria-labels, with no setTooltip port

**Decided 2026-09-30 (#105). Every tooltip on the board is Obsidian's, drawn from the element's `aria-label`; `src/ui` has no port to `setTooltip`.**

`setTooltip(el, text)` without options only sets `aria-label` (checked in the 1.11.4 and 1.13.7 bundles), and Obsidian's hover handler shows the nearest `aria-label` as the tooltip. So in this app the tooltip is the accessible name, and a port would add an adapter and a fake for an attribute React can set. The one thing `setTooltip` adds is redrawing a tooltip already open when its text changes; a label React changes under the pointer shows the old text until the pointer comes back, as a `title` did. Where an element is announced and shows text, its label starts with that text and then adds the hint, so the name still begins with what is on screen. The hinted labels in the detail panel (property keys, a link naming no card, a relation's "via" note) stay plain spans: axe lists an `aria-label` on a span as needing review rather than as a violation, and `role="img"` would have a screen reader call a word a graphic. Inside a card tile nothing is announced but the tile's own name, so the chips' labels there are tooltip only.

**What would change this:** Obsidian documenting a tooltip that is not the accessible name, or the board needing a `TooltipOptions` setting such as placement or delay. Either one calls for the port.

## The board's inline status lines stay its own

**Decided 2026-09-30 (#87). Every dialog, confirm and passing message is Obsidian's now; the lines that describe the board where it stands are not, because Obsidian has no component for them.**

The Edit column dialog became a `Modal` built from `Setting` rows, the toast became a `Notice`, deleting a card goes through `FileManager.promptForDeletion`, and "Remove todo", column delete, "Replace token" and a network bind address share one confirm `Modal`. Eight lines stay drawn by the board: the load error and the loading line, the empty-board text of a view with no board note, the card-folder notice bar, the description's "Not saved" and "changed in the note while you were editing" notes, the field hints in the detail panel, a lane's rule and a column's empty line, and the toolbar's match count. Each one says something about a place on screen for as long as it stays true. A `Notice` says something once, in the corner, and goes; a `Modal` stops the person until they answer. Neither fits a line that has to stay next to what it describes, and the API documents nothing that does.

A network bind address still typed in its field when the settings tab goes away is asked about all the same. Closing the Settings window blurs the field, so that dialog opens in whichever window is left; nothing reaches the network without a yes.

**What would change this:** Obsidian documenting an inline status or callout component a view can place inside itself, or a `Setting`-level message that covers more than an error.

## Rendered descriptions and comments are dressed from the reading-view variables

**Decided 2026-09-30 (#92). The description and comment containers do not wear `markdown-rendered`; `src/theme/detail-panel.css` draws their paragraphs, lists, quotes, code and tables from the variables Obsidian documents for them.**

Obsidian's reading view hangs its prose rules on `.markdown-rendered`, and the developer docs do not publish that class, so the containers stopped wearing it (see "Folia's components do not wear Obsidian's undocumented class names"). Without it, code lost its background, quotes their bar, tables their cells, and lists took the browser's indent. What the docs do publish is the reading view's variables (`--code-background`, `--blockquote-border-*`, `--table-*`, `--p-spacing`, `--list-indent`…), which is what a theme restyles, so the panel's own rules read those and the look comes back. It was compared live against the old one, element by element, for paragraphs, tight, loose, nested and task lists, quotes, callouts, highlights, inline and fenced code (also inside a list item), a heading inside a list item, a four-row table and an embed; an element not in that list may still differ. What `MarkdownRenderer` puts inside, such as callouts and embeds, still carries the host's own classes and styling.

What stays different, by choice or for want of a published value: tables keep the panel's text size rather than the reading view's larger one, as headings already do; a top-level list item is indented by `--list-indent` rather than the host's `3ch`; inline code padding is a size step rather than `0.15em 0.3em`. The code block's copy button is styled through its position (`pre > button`), because its class is not published either; `pnpm theme:check` allows a bare button only inside these two containers. Unlike the reading view's, it is faded rather than removed while the block is not hovered, so a keyboard can still reach it.

**What would change this:** Obsidian publishing `markdown-rendered`, or a class for rendered-Markdown containers, with a compatibility promise.

## The board keeps no clearance for the status bar

**Decided 2026-09-30 (#92). Nothing is reserved at the foot of a column for Obsidian's floating status bar.**

The board used to find the bar by its `.status-bar` class, measure it and pad the columns by its height. The class is not in the developer docs, and neither is anything that says how tall the bar is (`--status-bar-scroll-padding` resolves to nothing on 1.13.7), so the measurement went and nothing replaced it. It does not need replacing: every column ends in its add-card button or its rule line, and that footer plus the board's own padding sits between the last card and the window's edge. Measured live on 1.13.7 with the default theme, the last card of the tallest column ends 44px above the bar in the main area and in a bottom split, 44-56px above it in the right sidebar, and an open add-card composer, the one state with no footer, ends 6px above it. A pop-out window has no bar.

**What would change this:** a bar that reaches a card or the composer's buttons, because a theme or snippet makes it taller (it follows `--status-bar-font-size`, which a theme may raise) or a release moves it. The composer is the first to go, with 6px to spare. A documented variable for the bar's height would be the way back, not the class.

## Links in the detail panel show no page preview

**Decided 2026-09-30 (#101). Hovering a link in a card's description or comments shows no page preview, and Folia is not in Page preview's list of sources.**

The preview fired the workspace `hover-link` event for links it found by the undocumented `internal-link` class and their `data-href`. The developer docs do show a plugin view firing that event, in the sample code of the "Build a Bases view" guide, but `obsidian.d.ts` types neither the event nor its payload. Since #88 the panel is an Obsidian dialog: a page preview sits on `--layer-popover` (30), under the dialog's `--layer-modal` (50), and it was reported opening behind the dialog's backdrop (#101). Lifting it would mean styling the undocumented `.hover-popover`. A popped-out board never showed it either (#81).

**What would change this:** a documented way to open a page preview above a modal, together with a typed `hover-link` event or another documented way for a view to ask for a preview of a link it rendered.

## Card links use the vault's link path setting

**Decided 2026-09-30 (#106).** Folia writes wikilinks for card relationships and subtasks, using `MetadataCache.fileToLinktext` to choose the path inside the brackets. Shortest, relative and absolute paths omit `.md`. When Obsidian is configured to generate Markdown links, the old `generateMarkdownLink` plus bracket-stripping code discarded its Markdown-link result and fell back to the target's full vault path. The new call follows the vault's path setting in that case too. Folia still writes wikilinks because its card reader expects them; reading and writing Markdown links belongs to #40.

**What would change this:** #40 adding Markdown-link reading for card relationships and subtasks. Folia could then write Markdown links when the vault setting asks for them.

## Link text is split in the model

**Decided 2026-09-30 (#106). `linkpath` in `src/model/links.ts` splits a link's text; the model does not receive Obsidian's `parseLinktext`.**

Every reading of a `[[wikilink]]` in the model needs the note it names: the subcard line in the checklist, the fallback resolver in `buildBoard`, and the identity that folds `[[A]]`, `[[A|see this]]` and `[[A#Notes]]` into one relationship. `parseLinktext` answers only half of that. In Obsidian 1.13.7 it is `indexOf("#")` and nothing else: no `|` handling and no trimming, since Obsidian's own callers split the alias off first. So a port would carry a one-line split into the model, which would still have to split the alias and trim around it, and the checklist reading runs inside `vault.process` with no host at all (see "The model splits frontmatter itself"). `linkpath` does the same `#` split after dropping the alias, and all three readings now go through it instead of three hand-written splits that ran in different orders. A relationship value written without brackets (`blocks: Other card`) is still read as a target, as #27 decided.

**What would change this:** `parseLinktext` taking on the alias or trimming, or the model gaining a host-supplied parser for other reasons. Compare `linkpath`'s tests in `test/links.test.ts` with the `parseLinktext` in the installed Obsidian's `app.js`.

## A card's `area` counts as a tag

**Decided 2026-09-30 (#106). `area` is read as written; the frontmatter `tags` key is read the way Obsidian reads it.**

The board credits a card with its `area`, its frontmatter tags and its body tags, and the `tag:` filter, the chips and free-text search all read that one list (`src/model/tags.ts`). For `tags` the answer is Obsidian's: the adapter fills `Card.frontmatterTags` from `parseFrontMatterTags`, so a card shows exactly the frontmatter tags Obsidian's tag pane counts. That helper reads only a key matching `tags` (in any case), so `area` has no Obsidian reading to follow. It is Folia's own key, with a single string value. The `area:` filter reads it directly, but it stays in the tag list because a card has always shown its area as a chip and answered `tag:` and free-text search with it.

A card that never passes through the adapter, such as the prospective card a lane judges a new card by, has no `frontmatterTags` and reads `tags` as written; the values Folia writes there are plain names, so the two readings agree.

The tag pane also hides names that Obsidian's private tag-name check rejects, such as `a,b` or `123`, and nothing documented exposes that check. So a frontmatter value like `tags: [a,b]` still shows as a chip on the card while Obsidian does not list it as a tag.

**What would change this:** Obsidian documenting its tag-name check, or `area` taking list values.

## Dates are formatted and compared without Moment

**Decided 2026-09-30 (#106, answers #35). `dateOnly`, `stamp` and `dueInfo` in `src/model/dates.ts` keep their own arithmetic.**

Obsidian bundles Moment and hands it to plugins as `moment` (it is `window.moment`), and #35 waited for a reason to use it. #106, moving the plugin onto documented API, was that reason, and checking it against Obsidian 1.13.7 turned up two reasons not to:

- **Locale.** Obsidian sets Moment's global locale to the app's language. Under Arabic, Hindi or Persian, among others, `format("YYYY-MM-DD HH:mm")` writes native numerals (`٢٠٢٦-٠٩-٣٠ ٠٩:٠٥`). Those strings go into `due`, `created` and every comment and history line, where `TS_LINE_RE` in `src/model/card.ts` accepts only `[0-9: -]` and `sortKey` in `src/model/unread.ts` compares digits. Every call would have to pin `.locale("en")`, and one call that forgets corrupts the notes of exactly the people who never see it happen on an English setup.
- **Parsing.** `dueInfo` reads a due date with `Date.parse` at local midnight, which rolls an impossible day over (`2026-02-30` counts as 2 March), and shows anything that is not `YYYY-MM-DD` as written. Moment's strict parsing rejects the rollover and its loose parsing accepts forms the board never has. Neither is the reading that ships.

`src/model/` cannot import `obsidian` either, so using Moment would mean a formatter port threaded to `lanes.ts`, `board.ts`, the adapter, the plugin entry and `useToday.ts`, carrying four lines of padding and one subtraction. `test/dates.test.ts` pins the formats and the day boundaries, around midnight and across both daylight-saving changes.

**What would change this:** what #35 already names: due dates accepting another form, a configurable date format, or configurable calendar behaviour. Moment then earns its place, called with an explicit `en` locale and a strict format.

## A card folder that matches only by letter case is used when it is the only one

**Decided 2026-09-30 (#117). A `card-folder` with no exact match takes the one folder that matches it ignoring case, under that folder's real path, and says so; with two or more, the board picks none and refuses to add a card.**

A folder or file spelled exactly as written always wins, so Linux, where `Cards/` and `cards/` can coexist, keeps meaning what it says. Only the part the value itself wrote is compared ignoring case: the board note's own folder is a real path, so `./Cards` beside `basic/Board.md` never takes a `Basic/cards` next to it. Without an exact match the board used to load empty and then create the folder as written beside the real one, which hid the real cards with no message. Obsidian's own case-insensitive lookup, `getAbstractFileByPathInsensitive`, is not in `obsidian.d.ts` and returns the first hit, so it cannot tell one match from several; the matches are counted over `getAllLoadedFiles()` instead, the way `pathTaken` judges new names. Guessing between several spellings was left out: whichever one it picked, the cards in the others would vanish from the board as silently as before, and creating the folder as written would add one more spelling.

**What would change this:** Obsidian documenting a case-insensitive lookup that reports every match, which would replace the walk over every loaded file.
||||||| parent of 2da7f29 (docs: record which controls are Obsidian's and which stay the board's)

## A subtask's done tick stays a checkbox

**Decided 2026-09-30 (#103). The tick beside each subtask in the detail panel is a bare `<input type="checkbox">`, not a `ToggleComponent`.**

A subtask is a task line in the card's note, and Obsidian draws a task's tick as a checkbox, in the editor and in reading view. `ToggleComponent` is the settings switch, for turning an option on or off, so it would make the panel's list look unlike the note it edits. No component in the API draws a task tick. The bare checkbox takes its look from Obsidian's rule for every `input[type="checkbox"]`, which sizes, fills and ticks it from the `--checkbox-*` variables. That rule is observed in the app's stylesheet, not documented, and it is the only such dependency this panel keeps. The settings-shaped on/off field this decision once covered is now a toggle in the Edit column dialog, built from `Setting.addToggle` (#87).

**What would change this:** Obsidian documenting a task-checkbox component, or the panel rendering the subtasks through `MarkdownRenderer` as the note itself does.

## Icon-and-label controls stay hand-drawn

**Decided 2026-09-30 (#103). The add-column tile, a column's "Add a card" footer, the toolbar's filter chips and a card's subitems disclosure are `<button>`s the board draws.**

Each shows an icon and a label together. `ButtonComponent.setButtonText` replaces the button's children, and `setIcon` swaps its first child for the icon, so one component can hold one or the other, never both. `ExtraButtonComponent` holds an icon only. The filter chips are also toggles, with `aria-pressed` and a tinted on-state (see "What the board keeps painting itself"), and no component draws a pressed button. The subitems disclosure carries `aria-expanded`, a rotating chevron and a count. `scripts/theme-buttons.mjs` holds the list of classes these controls use and fails any other JSX `<button>`.

**What would change this:** a component that takes an icon and a label, or a pressed state, which would bring the matching group across.

## In-text links and disclosures stay hand-drawn

**Decided 2026-09-30 (#103). A card's "↳ parent" reference, the detail panel's title disclosure and "Why this title?", relation and subcard titles, and "Add a description…" are `<button>`s the board draws as text.**

They sit in running text and must wrap with it. A `ButtonComponent` is a box one input high, and an `ExtraButtonComponent` is an icon. So `.folia-link` in `base.css` still undoes the two rules Obsidian's stylesheet puts on every button: `white-space: nowrap` and `height: var(--input-height)`. It is one of two rules the board keeps against undocumented app CSS, and both reset the host's values rather than reading them. The other is in `host-controls.css`: it removes the grey ring Obsidian's stylesheet draws around a focused control, so the board's accent outline is the only one. `scripts/theme-buttons.mjs` lists these classes beside the icon-and-label ones.

**What would change this:** Obsidian documenting a link-styled button, or its stylesheet no longer shaping bare buttons, which would make the reset inert.

## The card progress bar is Obsidian's

**Decided 2026-09-30 (#103). A card's subtask bar is a `ProgressBarComponent`, and the board keeps only the count beside it.**

Three things went with the hand-drawn bar. It no longer turns green when every subtask is done: the count beside it still turns success-coloured and shows a tick, so the state keeps a cue that is not colour on a bar. It is no longer a pill: the host's bar is 8px high with a 4px corner, where the board's was 4px and fully rounded. And its fill no longer slides to the new width: the component sets the width directly. The component sets no role, and a role inside the card would not be announced anyway, since the card is itself a `role="button"`: the card's own accessible name says how many subtasks are done. In the light theme the empty track is faint on a white card, which is the host's choice of colour.

**What would change this:** the component gaining a state for a complete bar, or live evidence that the empty track cannot be seen in a supported theme.
