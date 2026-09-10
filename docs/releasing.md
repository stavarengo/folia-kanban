# Releasing, and the community directory

Maintainer notes: how a release is cut, what checks it against the Obsidian community directory's scanner, and what to expect from the public portal afterwards.

## Cutting a release

1. Run the **Create Release** workflow (`workflow_dispatch`, `main` only). It runs `pnpm ci:release` — release-it reads the Conventional Commits since the last tag to decide the increment, bumps `manifest.json`/`versions.json`/`package.json`, writes the `CHANGELOG.md` section from those commits, commits, and pushes the tag.
2. The tag push triggers **Release**, which refuses anything that is not plain semver or not reachable from `origin/main`, then tests, builds, attests build provenance, creates the GitHub release with that changelog section as its notes, and uploads `main.js`, `manifest.json` and `styles.css`.

Both steps are ours end to end: nothing is drafted for a human to publish by hand.

The increment comes from the commits, so a commit that breaks compatibility must carry the `!` in its header, whatever its type (`feat(mcp)!: require the subtask text`); a `BREAKING CHANGE:` footer is optional, for when the subject alone does not say what a user has to change. `.release-it.json` keeps `preMajor: true` until someone decides on `1.0.0`; that release is dispatched with an explicit version and drops the flag in the same change.

Never rewrite older `versions.json` rows: Obsidian reads that file to send a user on an old app to the last plugin version that ran there, and every release up to `0.0.20` genuinely ran on `1.7.2`. The bump script adds the row for the current `minAppVersion` on every release.

## The two scanner checks

The community directory reviews every release with a scanner: Stylelint with its own ruleset, plus ESLint with `eslint-plugin-obsidianmd`. The official tooling exists only as a GitHub Action, so this repo checks itself twice.

`pnpm obsidian-scan:check` (`scripts/obsidian-scan.mjs`, part of `pnpm verify`) reproduces both passes locally and is the gate: it fails on any finding, warning or error, and it is the only signal available before pushing.

The `Obsidian community scan` job in `ci.yml` runs the real action, floating on `v1`. It never fails on lint findings and cannot be configured to; it records every finding as a warning and only errors on a broken manifest, a missing README or licence, or a failed tool install. Its value is drift detection: the directory pins its own tool versions, the local script cannot match them, so a finding in that job's log that `obsidian-scan:check` did not produce means `scripts/obsidian-scan.mjs` needs updating.

## The public portal

The listing is at [community.obsidian.md/plugins/folia-kanban](https://community.obsidian.md/plugins/folia-kanban), no login needed. It shows a review rating and an issue count for the latest release; the itemised findings are only on the maintainer's own account page.

Some findings are permanent and informational, not things to fix: the AGPL-3.0 copyleft notice, "vault enumeration" (inherent to a plugin that reads every card), and "malware/obfuscation scan not available".

When the portal lags behind GitHub there is nothing to trigger: no endpoint, button, action or webhook exists (researched in August 2026 across the docs, blog, the `obsidianmd` org and the forum). Obsidian's only commitment is that a passing release appears within about a day. Wait that day, then ask staff on the forum or the plugin-review channels; do not debug the release pipeline over a stale version number. Precedent: [one stuck listing](https://forum.obsidian.md/t/plugin-submission-portal-stuck-on-no-release-matches-your-manifest-version-despite-correct-releases/114686) was cleared by staff by hand, [another](https://forum.obsidian.md/t/no-release-matches-your-manifest-version/116025) resolved itself after a day.
