# Releasing, and the community directory

Maintainer notes: how a release is cut, what checks it against the Obsidian community directory's scanner, and what to expect from the public portal afterwards.

## Cutting a release

1. Run the **Create Release** workflow (`workflow_dispatch`, `main` only). It runs `pnpm ci:release` — release-it bumps `manifest.json`/`versions.json`/`package.json`, writes the `CHANGELOG.md` section from the Conventional Commits since the last tag, commits, and pushes the tag.
2. The tag push triggers **Release**, which refuses anything that is not plain semver or not reachable from `origin/main`, then tests, builds, attests build provenance, creates the GitHub release with that changelog section as its notes, and uploads `main.js`, `manifest.json` and `styles.css`.

Both steps are ours end to end: nothing is drafted for a human to publish by hand.

## The two scanner checks

The community directory reviews every release with a scanner: Stylelint with its own ruleset, plus ESLint with `eslint-plugin-obsidianmd`. This repo checks itself against that scanner twice, on purpose.

- **`pnpm obsidian-scan:check`** (`scripts/obsidian-scan.mjs`, part of `pnpm verify`) reproduces both passes locally, copied from the action's `src/lint.ts`. It is the only signal available before pushing — the official tooling exists solely as a GitHub Action, with no CLI or npm form.
- **The `Obsidian community scan` job** in `ci.yml` runs Obsidian's own [`obsidianmd/obsidian-workflows`](https://github.com/obsidianmd/obsidian-workflows) action in PR mode with `scanner-lint: true`, deliberately floating on the `v1` tag.

Keeping both is the point: the local copy gives pre-push feedback, the action tracks whatever the scanner does next. **When the two disagree, the scanner moved and `scripts/obsidian-scan.mjs` needs updating** — that divergence is the job's real value, not the duplicated pass.

The action is npm-only (`npm ci` / `npm install` / `npm run <script>`) and this repo has no `package-lock.json`, so the job installs with pnpm first; the action skips its own install when `node_modules` already exists. Its lint passes install their own pinned tool versions in a temp directory regardless.

The action's release mode, and its reusable `release.yml`, were considered and **not** adopted (decided 2026-08-26): it creates a *draft* release and knows nothing about this repo's tag-reachability gate, semver-only tag rule, or changelog-derived notes. Adopting it would trade real control for a duplicate of checks CI already runs on the same commit.

## The public portal

The listing lives at [community.obsidian.md/plugins/folia-kanban](https://community.obsidian.md/plugins/folia-kanban) and needs no login. It carries a **Review** rating and an issue count for the latest release; the itemised findings behind that rating are only visible on the maintainer's own account page on the portal.

Some entries are informational and permanent rather than things to fix — the AGPL-3.0 copyleft notice, "vault enumeration" (inherent to a plugin that reads every card), and "malware/obfuscation scan not available". A rating short of perfect is not automatically a defect.

**When the portal lags behind GitHub, there is nothing to trigger.** No API endpoint, no dashboard button, no action, no webhook — this was researched across the Obsidian docs, blog, the whole `obsidianmd` GitHub org and the forum in August 2026, and none exists. The blog's only commitment is that a passing release appears "within 24 hours". So: wait roughly a day, and if it is still stale after that, ask Obsidian staff directly (forum or the plugin-review channels) to clear it. Do not go debugging the release pipeline over a stale version number, and do not re-research the question — the forum precedent is that staff fix it manually and no self-serve path is documented.
