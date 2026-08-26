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

**What would change this:** a public API for creating a leaf (or hosting an editor) outside the workspace tree, or a supported editable Markdown embed. Re-check the two greps above against the installed types before spiking again. Note also the deferred-leaf behaviour recorded in `AGENTS.md` — Obsidian defers background leaves, so an off-screen board stays empty until focused — which applies to whatever would host the two panes.

Until then, the shipped answer is the swap: a board note opens as the board and the tab header button flips it to the Markdown editor and back, one tab either way (see the README, "The board and the Markdown editor are the same tab").

## Unread-comment ordering assumes one clock

**Decided 2026-08-26. Same-clock writers are the supported case.**

Comment timestamps are written by `stamp()` (`src/model/dates.ts`) in local time with no timezone, and read-state compares those minute strings as text (`src/model/unread.ts`). A writer on another clock — most realistically an agent or script on a UTC server writing straight into a note — produces stamps systematically offset from the reader's marker, so its comments can sort below the marker and never light the card up.

The line grammar is what makes carrying a timezone expensive rather than cheap. `TS_LINE_RE` in `src/model/card.ts` restricts the timestamp capture to `[0-9: -]`, so `Z` or `+02:00` does not parse at all (a `-05:00` suffix would parse by accident), and `sortKey` in `src/model/unread.ts` orders comments by zero-padding each run of digits and comparing text — it has no notion of an offset to normalize. Carrying a timezone therefore means changing the parse, the ordering and the write format together, and doing it in a way every note already written stays readable through. That is a feature with a design, not a cheap addition, and nobody has asked for it.

So the documented answer is the README caveat under "Unread comments": stamps are read as being on the reader's clock, and anything automated writing comments into a vault should stamp them in the reader's local time, exactly as the plugin does.

**What would change this:** a real report of comments written across timezones being missed. The design would then have to keep `- _YYYY-MM-DD HH:mm @name:_` readable for every existing note.
