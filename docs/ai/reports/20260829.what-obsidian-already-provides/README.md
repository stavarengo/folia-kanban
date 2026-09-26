# What Obsidian already provides

Each section's **Verified live** block describes Obsidian 1.13.7 as it was observed on 2026-08-29 against Folia at commit `6817565`, and none of it was re-verified when the report was brought back in line with the repository on 2026-09-20; the Folia `file:line` pointers inside those blocks are therefore as of `6817565` rather than of today's `main`.

## What this is

Backlog entry `20260829.07` asked one question (the entry is closed and deleted now that this report exists and its findings are triaged below): where does Folia do something its own way that Obsidian already offers plugin developers? This report is the answer, in 117 findings across seven sections. Folia at commit `6817565` was read against Obsidian as it stands today — the installed `obsidian@1.13.1` typings, the API changelog, the official developer docs, the ESLint rules and the release action the community-directory bot runs, the official sample plugin, the Obsidian user help, and a running Obsidian 1.13.7 with the repository's `examples` vault open — rather than against the 1.7.2 the manifest promised then. The findings are as they were read; what was brought in line with `main` on 2026-09-20 is everything around them — the `file:line` pointers outside the **Verified live** blocks, the statuses, and a dated note inside each affected finding recording what has since been fixed, moved or superseded, and what the fix settled. All 117 findings are still here, notes and all.

Nothing here changes code and nothing here decides anything. Each finding names the Folia location, the Obsidian facility, what the in-house version does differently, and one researcher's honest read, so that each can later be judged on its own without redoing the work.

## The seven sections

| Section | Covers |
| --- | --- |
| [01. UI components and primitives](./01.ui-components-and-primitives.md) | Menus, modals, suggesters, setting rows, notices, buttons, icons, tooltips, progress bars |
| [02. Styling, theme and design language](./02.styling-theme-and-design-language.md) | The `--folia-*` token layer, `src/styles.css`, inline styles, the column palette, the raw-value guards |
| [03. Editor, rendering, search and dates](./03.editor-rendering-search-and-dates.md) | Rendered Markdown, the filter grammar, fuzzy matching, date arithmetic, the unread clock |
| [04. Vault, files and metadata](./04.vault-files-and-metadata.md) | `Vault`, `FileManager`, `MetadataCache`, YAML, frontmatter, paths, links, the file-event stream |
| [05. Workspace, views, commands and settings](./05.workspace-views-commands-and-settings.md) | The view class, leaf targeting, commands, the ribbon, the settings tab, `data.json` |
| [06. Interaction and input](./06.interaction-and-input.md) | Keymap scope, owner documents, drag and drop, view resize, listener lifecycle |
| [07. Guidelines, the MCP host, the build, and the rest](./07.guidelines-mcp-build-and-the-rest.md) | Community-directory conventions, `src/mcp`, the build and release path, the documentation's claims |

## How to read a finding

Every finding is one `###` heading with the id `<section>-<NN>`, for example `04-12`. Findings are numbered contiguously within a section and ordered by **how much the gap costs today** — maintenance, theming, mobile, accessibility, review risk, correctness — not by how easy the fix looks. Sections with more than about ten findings group them under `##` subheadings and keep the cost ordering inside each group.

Each finding carries four fields:

- **Folia** — the file, line and symbol, and what the in-house version does.
- **Obsidian** — the API member, CSS variable, class or convention that covers it, cited to a source that was actually read (`obsidian.d.ts:<line>`, a developer-docs path, a changelog version, an ESLint rule, or a live observation in the running app). A version is named whenever the facility appeared after the `minAppVersion` in force while the report was written, 1.7.2. Read those version notes against today's floor of 1.11.4: a facility named as 1.8.7, 1.9.x, 1.10.x or 1.11.x is plainly available now and needs no gate, and only a 1.13.0 one still does.
- **Differs** — what the in-house version does differently, including whatever it does that the Obsidian route would not. That last part is usually why it exists.
- **Read** — one of **clear win**, **trade-off**, **not worth it** or **decided**, with the reasoning. A trade-off names both sides. A "not worth it" says what would change the answer. A "decided" cites the heading in `docs/decisions.md` where the divergence was already argued and written down; those are listed here rather than filtered out, so the report is complete.

Some findings split the verdict on purpose ("clear win for the chrome, trade-off for the width"). The totals below count the first verdict stated, and the finding itself carries the full reading.

Two fields are optional: **Guard** names the script or waiver that already knows about the gap, and **Backlog** links an existing entry so the triage does not open a duplicate.

Sixteen headings are not findings but cross-references. Where two sections found the same gap, the section that owns the facility keeps the finding and the other keeps its id, says `— covered by <id>` in its heading, and holds a one-line pointer plus whatever it established that the primary lacked. Nothing was deleted: every such fact was moved into the primary first.

Three more headings took that same shape later, on 2026-09-20, when the five findings about links were folded into 04-01: 04-02, 04-11 and 04-19 keep their ids and now cross-reference it, as 03-04 already did, so an issue body citing any of the five still resolves. They are not part of the sixteen — those are the cross-section pairs found on 2026-08-29 — and "Totals" still counts them as findings, in a "Cross-refs" column defined for headings pointing at *another section*, which these do not: the row is left as it was read rather than re-decided here. Each still carries its own verdict word, and everything the folded bodies established was moved into 04-01 first.

### Where the evidence comes from, and how much each kind is worth

Nothing here is written from memory. Every Obsidian claim points at something that was actually opened: the installed `obsidian.d.ts`, the API changelog, a path in the official developer docs, an ESLint rule and its doc, the sample plugin, the Obsidian user help — or the running application itself.

That last one is the strongest and the newest. After the seven sections were written and reviewed, a live pass drove Obsidian 1.13.7 through a Chrome DevTools bridge with the repository's `examples` vault open, reading the app's own `app.css` and `app.js` from its `app://obsidian.md/` origin and exercising API calls in the real runtime. It settled 24 of the 33 questions the documentary sources could not, and it changed several verdicts. Where a live observation and a document disagree, the observation wins, and each section's **Verified live** block says exactly what was seen so the claim can be re-checked.

The order of authority throughout is: live observation, then the typings, then the developer docs and the codified lint rules, then inference. Findings say which they rest on. A live observation still describes one build on one desktop platform — it settles what Obsidian does, not what Obsidian promises — so where a behaviour matters but is undocumented, the finding says so rather than treating it as contract. That distinction is doing real work in several places: `Menu` and `Modal` behave like a menu and a modal in the running app, but the typings promise neither a focus trap, nor roving focus, nor dismissal, which is why the findings that touch them are trade-offs asking for a test rather than clear wins.

Each section closes with **Checked and found aligned** (things in that area that already go the Obsidian way, one line each — 112 of them altogether), **Unverified** (claims the sources could not settle), and **Verified live** (what the running 1.13.7 build showed).

## Two constraints that shape most verdicts

These apply everywhere and are stated once here so the findings do not repeat them.

**`src/model/**`, `src/ui/**` and `src/mcp/**` may not import `obsidian`.** `no-restricted-imports` in `eslint.config.mjs` enforces it for all three folders, and dependency-cruiser separately fences `src/model/`, `src/ui/` and `src/mcp/` off `src/obsidian/`, the adapter, which is a different edge from importing the `obsidian` package (`.dependency-cruiser.cjs` says in its own header that the package rule belongs to ESLint). Until [#56](https://github.com/stavarengo/folia-kanban/issues/56) the ESLint glob left out `src/mcp/**`, and the block sat before the `obsidianmd` preset spread, which turns `no-restricted-imports` off for `src`, so the fence was not enforcing anything for any folder. It now sits after the spread. The rule is what lets the tests render the real `<App/>` under jsdom against a fake repository. So "use the native API" almost never means "call it where the code is". It means moving the work into the adapter (`src/obsidian/`) and passing the result in, which in practice is a new method on the `CardRepository` port plus a no-op in the fake. `src/obsidian/propertySuggest.ts` is the working precedent. Findings in `src/main.ts` and `src/view.tsx` carry none of this cost, because those files already import from `obsidian`.

**Anything newer than the floor is a lint error unless it is gated, and the floor has since risen.** `eslint.config.mjs` enables `obsidianmd/no-unsupported-api`, which reads `minAppVersion` straight out of `manifest.json`. That value was 1.7.2 while the report was written, which is why the findings below caveat everything they mark `since 1.8.7` or later and read several obvious-looking fixes as trade-offs rather than clear wins. It has been 1.11.4 since 2026-09-10 (`8e093a5`), so most of those caveats have simply expired: `App.secretStorage`, `saveLocalStorage`/`loadLocalStorage`, `displayTooltip` and `Notice.containerEl`/`messageEl` are all at or below the floor and can be called outright — `App.secretStorage` already is. What still needs the pattern `src/main.ts:1054` uses, `requireApiVersion("1.13.0")` with a fallback, is only the 1.13.0 members: `ConfirmationModal`, `Setting.setErrorMessage`, `ButtonComponent.setDestructive` and the declarative settings definitions. Where the old floor was the reason a verdict came out as a trade-off, that finding's own dated note says so; the verdicts themselves are left as they were read.

## The shape of it

Folia did not skip having a design system. It built a second, complete one alongside the one Obsidian ships: `--folia-*` tokens with a JSON source of truth under `tokens/`, generation and drift scripts, a raw-value audit with an allowlist, a button-specificity checker, a portal-scope checker. Section 02's 44 findings are that single decision counted out one declaration at a time — a radius ladder no theme can reach, a nine-rung font-size scale beside Obsidian's four, thirteen line-height literals, a z-index ladder sitting in the same numeric space as Obsidian's with five exact collisions.

The same pattern holds one layer up, though less completely. Section 01 finds a second component vocabulary — a hand-built context menu, two dialog shells, thirteen button classes, twenty-three hand-drawn Lucide icons, five suggesting inputs answering the keyboard four different ways — and section 04 finds a second parsing layer over files Obsidian has already parsed: a bundled YAML library, a regex frontmatter splitter, a hand-written wikilink resolver, a CommonMark fence scanner, checklist and heading parsers beside a metadata cache that indexes both.

The honest other half is that the report's "Checked and found aligned" lists run to 112 entries. `src/main.ts` drives `Setting`, `Notice`, `Menu`, `FuzzySuggestModal`, `addRibbonIcon` and `Platform.isDesktop` correctly throughout; the settings tab is expressed as data and rendered through Obsidian 1.13's declarative definitions; Markdown goes through `MarkdownRenderer.render` with a managed `Component` lifecycle; the community-directory scanner is reproduced locally in `scripts/obsidian-scan.mjs` and exits clean; everything registered in `onload` is unregistered. Where the plugin touches Obsidian at its own boundary it mostly does the right thing. The divergence sits inside the React tree and the stylesheet, which is exactly where the architecture rule makes the native route most expensive.

One absence is worth naming on its own: `src/styles.css` has no mobile, tablet or touch variant at all, which contradicted a `manifest.json` declaring `isDesktopOnly: false` when the report was written. The contradiction was settled on 2026-09-10 from the manifest's side rather than the stylesheet's — the manifest now says `isDesktopOnly: true` and mobile is decided as unsupported — so what is left is an absence that matches what the plugin promises. Obsidian's own stylesheet carries 253 rules keyed on `.is-phone`, 156 on `.is-mobile` and 15 on `.is-tablet` (02-42, 07-01).

## Totals

Counted from the files. "Cross-refs" are headings that point at another section's finding rather than carrying one.

| Section | Clear win | Trade-off | Not worth it | Decided | Findings | Cross-refs | Aligned |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01. UI components and primitives | 2 | 9 | 3 | 0 | 14 | 0 | 15 |
| 02. Styling, theme and design language | 20 | 19 | 5 | 0 | 44 | 0 | 13 |
| 03. Editor, rendering, search and dates | 0 | 2 | 2 | 1 | 5 | 4 | 4 |
| 04. Vault, files and metadata | 8 | 9 | 2 | 0 | 19 | 0 | 17 |
| 05. Workspace, views, commands and settings | 4 | 8 | 0 | 1 | 13 | 0 | 32 |
| 06. Interaction and input | 3 | 1 | 2 | 0 | 6 | 9 | 7 |
| 07. Guidelines, MCP, build and the rest | 6 | 6 | 4 | 0 | 16 | 3 | 24 |
| **Total** | **43** | **54** | **18** | **2** | **117** | **16** | **112** |

## Top findings across the whole report

Ordered by what the gap costs today. Items marked **bug** are wrong behaviour a user can hit now, not maintenance debt.

1. **05-01** (trade-off) — `WorkspaceLeaf.prototype.setViewState` is replaced for the whole app for the plugin's lifetime, and no lint rule, guard or written Obsidian guideline covers it.
2. **05-10** (clear win) — **bug.** `Plugin.onExternalSettingsChange` is not implemented, so a `data.json` changed by Sync or by hand is silently overwritten with what this instance had in memory. *Fixed on 2026-09-10; the audit's own reading, above, is left as it stood.*
3. **04-12** (clear win) — **bug.** Subtask and comment edits apply a line index taken from an earlier read, with no recheck inside `vault.process`; the MCP `set_subtask_done` tool is the riskiest caller. *Fixed across 2026-09-10 to 2026-09-19, and what occurrence counting still cannot see was decided on 2026-09-19; the audit's own reading, above, is left as it stood.*
4. **04-02** (clear win) — **bug.** Subcard links are written as a bare `[[basename]]`, so Folia can write a link Folia itself cannot resolve as soon as two notes share a name. *Fixed on 2026-09-10; covered by 04-01 since the two were folded into one finding on 2026-09-20, where the audit's own reading of both is left as it stood.*
5. **02-01** (withdrawn 2026-09-10) — **not a bug.** The audit read the unused `--text-on-accent-inverted` as white text on a near-white button under a pale accent. It isn't: Obsidian makes that choice at runtime, rewriting `--text-on-accent` in the inline style of `<body>`, and Folia's tokens inherit it, so the two paint the same colour. What survives is a fragility, not a defect — see the correction on 02-01 and `docs/decisions.md`. The section's own reading is left as it stood.
6. **06-04** (clear win) — **bug.** Menus, the modal and the panel's listeners use `activeDocument`, which follows the focused window rather than the board that owns them. Confirmed live: with the Settings window focused, the column popover rendered into that window. *Fixed on 2026-09-10; the audit's own reading, above, is left as it stood.*
7. **07-01** (trade-off) — `manifest.json` sets `isDesktopOnly: false` while the plugin dynamically imports the Node `http` builtin. The gating is correct and the submission requirement still says "must"; the reasoning exists only as a code comment. *Fixed on 2026-09-10, both halves: the manifest now declares `isDesktopOnly: true`, and the reasoning the finding asked for is written down as `docs/decisions.md#Mobile is not supported, and the manifest now says so`. The audit's own reading, above, is left as it stood.*
8. **07-02** (trade-off) — the MCP bearer token is stored in `data.json` in the clear, so a credential for a server bound to one machine travels with the vault. `App.secretStorage` (1.11.4) is the written answer. *Fixed on 2026-09-10; the audit's own reading, above, is left as it stood.*
9. **05-02** (clear win) — **bug.** Every "Open note" affordance ignores modifier keys, so Ctrl/Cmd-click cannot open a card in a new tab, split or window the way it does everywhere else in Obsidian. *Fixed on 2026-09-10; the audit's own reading, above, is left as it stood.*
10. **04-01** (trade-off) — **bug.** The wikilink resolver is hand-written, has no `sourcePath`, never consults `aliases`, and silently drops a relationship when two cards share a basename. *Fixed on 2026-09-10; the audit's own reading, above, is left as it stood. On 2026-09-20 this finding absorbed the rest of the link cluster (04-02, 04-11, 04-19 and 03-04) and now carries the one residual still open, [#40](https://github.com/stavarengo/folia-kanban/issues/40): the bracket style, on both the write and the read side.*
11. **04-06** (trade-off) — **bug.** Card tags are read only from the `tags` frontmatter key, so a card tagged in its body is invisible to the board's own tag filter with nothing telling the user why. *Fixed on 2026-09-10; the audit's own reading, above, is left as it stood.*
12. **02-25** (trade-off) — **bug.** Folia's z-index ladder shares the numeric space with Obsidian's `--layer-*` scale, with five exact collisions. Confirmed live: Obsidian's tooltip (layer 70) paints over an open Folia menu (60). *Fixed on 2026-09-10 for the body-portalled surfaces, which now read the `--layer-*` scale; the in-board rungs are still Folia's own. The audit's own reading, above, is left as it stood.*
13. **04-15** (trade-off) — **bug.** The checklist parser accepts only `[ ]`, `[x]` and `[X]`, so a card using any other checkbox character loses its subtask state. *Fixed on 2026-09-09; the audit's own reading, above, is left as it stood.*
14. **02-10** (trade-off) — the raw-value audit's pixel detector is `\d{2,}px`, so every single-digit px value passes unseen, and the waiver retired on "nothing remains to migrate" was signed off against that overstated coverage.
15. **05-03** (clear win) — **bug.** The detail panel's rendered links have no hover preview, because the view is never registered as a hover-link source. *Fixed on 2026-09-10; the audit's own reading, above, is left as it stood.*

## Governance findings

Things about the guards, the waivers, the release path and the documentation rather than the code.

- **02-10** — the raw-value audit does not detect most of what it is documented to police, and `tracking/waivers/0001-raw-value-debt.md` was retired on that basis. The waiver also cites a stale line.
- **05-01** and **07-06** — the prototype patch is the most review-visible thing in the codebase, no guard or rule sees it, and its justification lives only in a code comment. It is the clearest missing entry in `docs/decisions.md`.
- **04-13** — keeping `processFrontMatter` despite its whole-block reflow is the right call, and it is written down nowhere but a code comment. Decided in practice, not in writing.
- **07-04** — neither the local scanner reproduction nor the CI job actually runs `validate-manifest` or `validate-license`.
- **07-12** — nothing checked that the git tag of a release matches `manifest.json`'s version. *Fixed on 2026-09-11: the pipeline's `Resolve the released version` step compares the two and exits 1 on a mismatch.*
- **07-13** — the build script skips the type check the sample plugin's build performs, so a type error can reach a published artefact. *Half fixed on 2026-09-11: the release job now needs the `verify` job, which runs `pnpm typecheck`, so the ordinary path is covered; `package.json`'s `build` still runs no `tsc`, and the republish path skips `verify` by design.*
- **07-15** — `versions.json` gains a row on every release, where the documentation asks for one only when `minAppVersion` changes.
- **07-18** — `README.md` says the plugin "makes no network requests at all" under a privacy heading, while the MCP server listens on a local port.
- **07-19** — three bundled dependencies ship no licence notice and nothing in the repository supplies one.
- **05-13** — the settings tab is maintained twice, and the imperative half, which Obsidian 1.13 never draws, has no test coverage.

## Decided items

Divergences that were argued and written down rather than left open. They are findings, not omissions. `docs/decisions.md` held two of these when the report was written and holds seven now; below is the whole file in its own order, with what each one settles here.

Argued before the report:

- **The board and a Markdown editor side by side, in one tab** (decided 2026-08-26) — settles **05-05**: the board and a Markdown editor cannot be shown side by side in one tab.
- **Unread-comment ordering assumes one clock** (decided 2026-08-26) — settles **03-09**: unread-comment ordering uses local, timezone-free timestamps.
- **The community-directory action's release mode** (decided 2026-08-26) — settles none of the report's findings. It is the third decision section 07 found recorded outside `docs/decisions.md`, in `docs/releasing.md`, and it has since been written into the file proper. 07-04 and 07-13 are about the local scan's skipped checks and the build's skipped type check, neither of which this decision touches.

Written after the report, in answer to it or to the work it triggered:

- **Two guided board setups racing for the same card folder** (decided 2026-09-09) — settles none of the report's findings; no finding covers the `makeBoard` race.
- **Mobile is not supported, and the manifest now says so** (decided 2026-09-10) — settles **07-01** and **02-42**. 07-01 asked for exactly this entry, and got it along with the manifest change.
- **Folia does not decide for itself what colour goes on a pale accent** (decided 2026-09-10) — settles **02-01**, and is where its withdrawal is argued in full.
- **Identical checklist lines are told apart by count, not by identity** (decided 2026-09-19) — settles what the **04-12** fixes deliberately left open: an edit that slides an identical line into the meant line's place moves the position and the occurrence count together, so the write still lands on the twin.

One ask for an entry is still open: **07-06** wants the `WorkspaceLeaf.prototype.setViewState` prototype patch argued in `docs/decisions.md`, and the file still has nothing on it.

## What could not be verified

The live pass against Obsidian 1.13.7 settled 24 of the 33 items the source pass could not. Code landed since has overtaken one of them entirely and half of two more, and those parts are gone from the list below: the device question behind 01-05 and 02-42, since mobile is now decided as unsupported and the manifest says so; the old-floor half of 07-14's build question, since `minAppVersion` is 1.11.4 now and maps to the same Electron 39 the live pass observed, which leaves only what the target costs in bytes; and the `aliases` half of 04-01 and 04-02, since link resolution now goes through `getFirstLinkpathDest` itself. The rest remain open, with what would settle each.

- Whether Obsidian actually refuses the filename characters `sanitizeFilename` assumes (04 Unverified). Needs a write to a vault; this pass was read-only.
- What the `yaml` package actually costs in the shipped bundle (04-04). Needs a `pnpm build` with and without the dependency.
- What `target: "es2018"` costs in downlevelled syntax and bundle bytes, against the `es2021` the sample plugin uses (07-14). Needs a `pnpm build` at both targets.
- Whether a community-directory reviewer treats an em dash in a manifest description as a special character in practice (07-03). A human process question; the automated half is settled, since neither the local scan nor Obsidian's own action inspects the characters inside a description.
- How many Folia users run an Obsidian below 1.13 (05-13). The directory's download statistics do not break down by app version.
- Whether Obsidian's own drag machinery would behave acceptably for sortable columns and cards (06 aligned list). `app.dragManager` exists at runtime but is absent from the typings and shaped for dragging files between panes; testing it means building against an internal API.
- Whether `obsidianmd/no-unsupported-api` reads the six `@ince` typos in the installed typings as unversioned members (01 Unverified). Nothing in this report depends on it.

## Method

Seven researchers each took one section under a shared brief that fixed the finding template, the writing rules and the list of sources they were allowed to cite. Each section then went through three rounds of independent review — a fresh reviewer each round, told only the file path and the sources, and told to assume every finding was wrong until proven right — followed by one live-verification pass against a running Obsidian 1.13.7 through a Chrome DevTools bridge, which is where each section's "Verified live" block comes from and where several verdicts changed. This index, the cross-section consistency pass that produced the cross-references above, and one final independent whole-report review came last.

## Triage

Done on 2026-08-29, the day the report was written, under the backlog's own rules: one entry per theme rather than per finding, no entry duplicating one that already exists, and no entry proposing its own solution. Thirty-one new entries absorb 109 of the sections' headings (96 findings and 13 cross-references); nine more headings (6 findings and 3 cross-references) are folded into four entries that already existed; thirteen findings are dismissed on the strength of their own read; two were already decided in `docs/decisions.md`. That reconciles to the report's 117 findings and 133 headings. Two further entries, #40 and #55, were split off those thirty-one later and are listed below in their own rows, marked as such; they add no heading the original thirty-one did not already absorb.

Every one of the 133 `###` headings in the seven sections appears below, in the row of the entry that absorbed it on 2026-08-29. Sixteen of those headings are cross-references rather than findings, and each is listed in the same row as the finding it points at. Three findings — 04-02, 04-03 and 05-06 — appear twice, once in that original row and once in the later split that now carries them.

### Became backlog entries

| Entry | Theme | Findings |
| --- | --- | --- |
| [#17](https://github.com/stavarengo/folia-kanban/issues/17) | The card menu and the column popover are a second menu implementation | 01-01, 01-02, 01-14, 06-01, 06-13 |
| [#18](https://github.com/stavarengo/folia-kanban/issues/18) | Dialog shells, field rows and destructive confirmations, all hand-built | 01-03, 01-04, 01-13, 06-02, 06-03, 06-08 |
| [#19](https://github.com/stavarengo/folia-kanban/issues/19) | Thirty-six tooltips drawn by the browser rather than the app | 01-05, 06-15 |
| [#20](https://github.com/stavarengo/folia-kanban/issues/20) | The board's own toast beside the app's notice | 01-07, 06-09 |
| [#21](https://github.com/stavarengo/folia-kanban/issues/21) | Every button drawn from scratch, and the specificity fight after it | 01-08, 02-30 |
| [#22](https://github.com/stavarengo/folia-kanban/issues/22) | Icon size decided at 34 call sites instead of by a scale | 01-10, 02-14 |
| 20260829.14 (withdrawn / not a bug) | Obsidian rewrites `--text-on-accent` on `<body>` for a light accent and Folia's tokens inherit it, so the board's buttons already turn dark with the app's own | 02-01 |
| [#23](https://github.com/stavarengo/folia-kanban/issues/23) | Theme colour read through Folia's own fallbacks and mixes | 02-02, 02-03, 02-04, 02-05, 02-06, 02-07, 02-08, 02-20, 02-24, 02-31 |
| [#24](https://github.com/stavarengo/folia-kanban/issues/24) | The `--folia-*` layer as a second design system | 02-11, 02-12, 02-13, 02-15, 02-21, 02-22, 02-23, 02-26, 02-27, 02-28, 02-44 |
| 20260829.17 (fixed, entry closed) | Bug: two z-index ladders in one numeric space — the body-portalled surfaces now read Obsidian's `--layer-*` scale, so a tooltip still covers a Folia menu, exactly as it covers the app's own | 02-25 |
| [#25](https://github.com/stavarengo/folia-kanban/issues/25) | Twelve controls drawn beside the variables published for them | 02-17, 02-18, 02-19, 02-29, 02-32, 02-33, 02-34, 02-35, 02-37, 02-39, 02-40, 02-41 |
| [#26](https://github.com/stavarengo/folia-kanban/issues/26) | The raw-value audit's coverage, and the waiver retired against it | 02-10 |
| 20260829.20 (fixed, entry closed) | The mobile claim in the manifest, and the gated Node import under it | 02-42, 07-01 |
| 20260829.21 (fixed, entry closed) | Link resolution and link text by Folia's own rules — the residual it stopped short of is tracked in #40 below | 03-04, 04-01, 04-02, 04-03 |
| [#40](https://github.com/stavarengo/folia-kanban/issues/40) (split out of 20260829.21 later) | A vault set to Markdown links still gets wikilinks from Folia, and reads nothing else | 04-02, 04-03 |
| [#27](https://github.com/stavarengo/folia-kanban/issues/27) | A second parsing layer over files the app already parsed | 04-04, 04-05, 04-16, 04-17, 04-19, 07-16 |
| 20260829.23 (fixed, entry closed) | Bug: any checkbox character but `x` loses a card's subtask state | 04-15 |
| 20260829.24 (fixed, entry closed) | Bug: a card tagged in its body never matches the tag filter | 04-06 |
| 20260829.25 (fixed, entry closed) | Bug: a stale line index applied inside `vault.process` — the five closed issues #36, #37, #50, #51 and #53 are the rest of that checklist-line family, opened later and citing no finding id | 04-12 |
| [#28](https://github.com/stavarengo/folia-kanban/issues/28) | Any vault change anywhere reloads the whole board | 04-09 |
| [#29](https://github.com/stavarengo/folia-kanban/issues/29) | Eight one-line detours around the vault and view API | 04-07, 04-08, 04-10, 04-11, 04-18, 05-07, 07-07, 07-09 |
| [#30](https://github.com/stavarengo/folia-kanban/issues/30) | The prototype patch and the undeclared `popstate` field, unwritten | 05-01, 05-04, 07-06 |
| [#31](https://github.com/stavarengo/folia-kanban/issues/31) | Four `src/main.ts` conventions diverged from at a cost to converge | 05-06, 05-08, 05-09, 05-12, 07-08 |
| [#55](https://github.com/stavarengo/folia-kanban/issues/55) (split out of #31 later) | The tab-header button sync rescans the workspace instead of reading its event payload | 05-06 |
| 20260829.30 (fixed, entry closed) | Bug: opening a card ignores modifiers, and its links have no preview | 03-02, 03-03, 05-02, 05-03 |
| 20260829.31 (fixed, entry closed) | Bug: an externally changed `data.json` is silently overwritten | 05-10 |
| 20260829.32 (fixed, entry closed) | The MCP bearer token travelling with the vault | 07-02 |
| [#32](https://github.com/stavarengo/folia-kanban/issues/32) | What the release path and the directory guards never check | 07-03, 07-04, 07-12, 07-13, 07-14, 07-15, 07-17 |
| [#33](https://github.com/stavarengo/folia-kanban/issues/33) | The README's privacy claim, and the missing licence notices | 07-18, 07-19 |
| [#34](https://github.com/stavarengo/folia-kanban/issues/34) | `src/main.ts` at 1172 lines (1020 when the report was written), under a waiver that expires | 07-05 |
| 20260829.36 (fixed, entry closed) | Bug: board chrome answered for the whole window rather than its own leaf | 06-05, 06-06, 06-11 |
| 20260829.37 (fixed, entry closed) | Bug: surfaces open in the focused window, not the board's own | 06-04 |
| [#35](https://github.com/stavarengo/folia-kanban/issues/35) | Hand-written date arithmetic and formatting, recorded for its trigger | 03-07, 03-08 |

### Already tracked

Four entries already existed for these, and each was extended with what the report adds rather than duplicated.

| Findings | Entry | What was added |
| --- | --- | --- |
| 01-06, 01-12, 03-01, 03-05, 06-07, 06-10 | [#16](https://github.com/stavarengo/folia-kanban/issues/16) | The fifth suggesting input the entry never counted — the toolbar's ~80-line hand-built combobox, read as a clear win — plus the search chrome and the substring matching that ride on the same decision |
| 04-13 | [#15](https://github.com/stavarengo/folia-kanban/issues/15) | The fact the entry asked to verify, now established: `processFrontMatter` re-serialises the whole block by design, so only the unwritten decision remains open |
| 05-11 | [#12](https://github.com/stavarengo/folia-kanban/issues/12) | Nothing: that entry is a hard stop whose deliverable is a conversation, and the finding is one more instance of what it already describes. Linked, not resolved |
| 05-13 | [#14](https://github.com/stavarengo/folia-kanban/issues/14) | The size of the second acceptable outcome (about 110 lines removable at `minAppVersion` 1.13.0) and the input nobody has: the users below 1.13 |

### Dismissed

Each on the strength of its own **Read**, which in every case also says what would change the answer.

| Finding | Why |
| --- | --- |
| 01-09 | Not worth it: 23 small hand-drawn icon paths are cheap to keep and the visual snapshots depend on them; its sizing half is entry 20260829.13 |
| 01-11 | Not worth it: the card tile's own layout already decides the progress bar's geometry |
| 02-09 | Not worth it: 39 of the 54 `color-mix` values are identical in either mixing space, and the rest differ below the tuned contrast threshold |
| 02-16 | Not worth it: the scrollbar difference is small and shows on two platforms only |
| 02-36 | Not worth it on the CSS route: restyling a native range input is long and fragile, and it returns for free if the control becomes a host slider (20260829.09) |
| 02-38 | Not worth it: a kanban drag ghost genuinely wants to be the card |
| 02-43 | Not worth it: the reduced-motion media query is the right mechanism and, as of 1.13.7, the only one |
| 03-06 | Not worth it: the board's query grammar is domain-specific and should stay its own matcher |
| 04-14 | Not worth it: no Obsidian API replaces the recent-writes window; revisit only after 20260829.26 scopes the reload |
| 06-12 | Not worth it: the inline add-column editor preserves context a dialog would lose |
| 06-14 | Not worth it: the React effect cleanups already cover the lifecycle correctly |
| 07-10 | Not worth it, and effectively decided by the tooling: the lint rule accepts only `Platform.isDesktop`, which is what the code spells |
| 07-11 | Not worth it: each `Promise` constructor is a case async/await cannot express, which the checklist's own wording allows |

### Decided

Two findings were argued and written down before this report, and are listed here to close the accounting. `docs/decisions.md` has since grown to seven entries; the ones written after the report settle findings the triage above had sent to entries rather than here, so the accounting is unchanged. "Decided items" earlier in this file lists all seven and what each settles.

| Finding | Decision |
| --- | --- |
| 03-09 | `docs/decisions.md#Unread-comment ordering assumes one clock` |
| 05-05 | `docs/decisions.md#The board and a Markdown editor side by side, in one tab` |

### The commissioning entry

Backlog entry `20260829.07`, which asked for this report, is done and has been deleted, per the skill's rule that the backlog holds only open topics. Entry [#16](https://github.com/stavarengo/folia-kanban/issues/16) pointed at it; that link now points at this report rather than at one of the new entries, because 20260829.06 is itself the entry that absorbs the suggesting-inputs theme, and what it needed from 20260829.07 was the evidence, which lives here.
