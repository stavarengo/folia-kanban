# Releasing, and the community directory

Maintainer notes: how a release is cut, what checks it against the Obsidian community directory's scanner, and what to expect from the public portal afterwards.

## Cutting a release

1. Run the **Create Release** workflow (`workflow_dispatch`, `main` only). It runs `pnpm ci:release` — release-it bumps `manifest.json`/`versions.json`/`package.json`, writes the `CHANGELOG.md` section from the Conventional Commits since the last tag, commits, and pushes the tag.
2. The tag push triggers **Release**, which refuses anything that is not plain semver or not reachable from `origin/main`, then tests, builds, attests build provenance, creates the GitHub release with that changelog section as its notes, and uploads `main.js`, `manifest.json` and `styles.css`.

Both steps are ours end to end: nothing is drafted for a human to publish by hand.

## The two scanner checks

The community directory reviews every release with a scanner: Stylelint with its own ruleset, plus ESLint with `eslint-plugin-obsidianmd`. This repo checks itself against that scanner twice, on purpose.

- **`pnpm obsidian-scan:check`** (`scripts/obsidian-scan.mjs`, part of `pnpm verify`) reproduces both passes locally, copied from the action's `src/lint.ts`. It is **the gate**: it fails the build on any finding, warning or error, and it is the only signal available before pushing — the official tooling exists solely as a GitHub Action, with no CLI or npm form.
- **The `Obsidian community scan` job** in `ci.yml` runs Obsidian's own [`obsidianmd/obsidian-workflows`](https://github.com/obsidianmd/obsidian-workflows) action in PR mode with `scanner-lint: true`, deliberately floating on the `v1` tag.

Be precise about what that second one is, because it is easy to over-read: **it does not fail on lint findings, and cannot be configured to.** The action records every scanner finding as a `warning` and only fails the job on `error` severity — which here means a broken `manifest.json`/`versions.json`, a missing README or licence, or a failed install of the tools it fetches for itself — and stylelint exits 0 on its own warnings, so those land in the job log without even an annotation. There is no strictness input to turn on.

What it is for, then: the directory pins its own tool versions (stylelint 17.6.0, ESLint 9.37.0, `eslint-plugin-obsidianmd` 0.4.1, fresh browser-feature data), and the local reproduction cannot match them — it runs on this repo's ESLint major and its own pinned `caniuse-lite`. This job runs the real ones. So when you want to know whether the scanner has moved, read its log: a finding there that `obsidian-scan:check` did not produce means `scripts/obsidian-scan.mjs` has drifted and needs updating.

The action is npm-only (`npm ci` / `npm install` / `npm run <script>`) and this repo has no `package-lock.json`, so the job installs with pnpm first; the action skips its own install when `node_modules` already exists, which is what the type-aware ESLint pass needs. Its lint passes install their own pinned tool versions in a temp directory regardless. Its build step is switched off, since the verify job already builds and a `dist/styles.css` would only get linted a second time.

The action's release mode, and its reusable `release.yml`, were considered and **not** adopted (decided 2026-08-26): it creates a *draft* release and knows nothing about this repo's tag-reachability gate, semver-only tag rule, or changelog-derived notes. Adopting it would trade real control for a duplicate of checks CI already runs on the same commit.

## The public portal

The listing lives at [community.obsidian.md/plugins/folia-kanban](https://community.obsidian.md/plugins/folia-kanban) and needs no login. It carries a **Review** rating and an issue count for the latest release; the itemised findings behind that rating are only visible on the maintainer's own account page on the portal.

Some entries are informational and permanent rather than things to fix — the AGPL-3.0 copyleft notice, "vault enumeration" (inherent to a plugin that reads every card), and "malware/obfuscation scan not available". A rating short of perfect is not automatically a defect.

**When the portal lags behind GitHub, there is nothing to trigger.** No API endpoint, no dashboard button, no action, no webhook — this was researched across the Obsidian docs, blog, the whole `obsidianmd` GitHub org and the forum in August 2026, and none exists. The blog's only commitment is that a passing release appears "within 24 hours". So: wait roughly a day, and if it is still stale after that, ask Obsidian staff directly (forum or the plugin-review channels) to clear it. Do not go debugging the release pipeline over a stale version number, and do not re-research the question.

The forum precedent, for whoever needs to cite it: [Plugin submission portal stuck on "No release matches your manifest version"](https://forum.obsidian.md/t/plugin-submission-portal-stuck-on-no-release-matches-your-manifest-version-despite-correct-releases/114686) was cleared by a staff member by hand, with no cause given, and [No release matches your manifest version](https://forum.obsidian.md/t/no-release-matches-your-manifest-version/116025) got no reply at all and resolved itself after about a day.
