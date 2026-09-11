# Releasing, and the community directory

Maintainer notes: how a release is cut, what checks it against the Obsidian community directory's scanner, and what to expect from the public portal afterwards.

## Cutting a release

Everything lives in one workflow, `.github/workflows/pipeline.yml`. A push run tells you what a release would be; a manual dispatch is the release. The jobs are chained with `needs`, so what gets published is what passed `pnpm verify` a few minutes earlier in the same run, plus release-it's version bump on top of it — no workflow triggers another, and no green tick from somewhere else is taken on trust.

1. **verify** and **scan** run in parallel on every push to `main`, every pull request, and a manual dispatch that is not a republish. `verify` is the full `pnpm verify` (it builds, and the build is kept as the run's `dist` artifact); `scan` is Obsidian's own action, described below.
2. **plan** runs on `main` only, after both. It decides whether the commits since the last tag contain anything worth releasing, asks release-it for the version number, and writes the review surface into the run summary: the version (or "nothing to release"), the commits since the last tag, and a compare link. On a push run that is where the run ends, green either way.
3. **release** only ever runs on a dispatch — that is the whole approval, and nothing pauses. It runs release-it on the planned version: bump `manifest.json`/`versions.json`/`package.json`, write the `CHANGELOG.md` section, commit, tag and push — with `GITHUB_TOKEN`, whose pushes deliberately start no new workflow run, or with the release App's token if one is configured (see the ruleset section, and expect the extra push run it causes). It then rebuilds (the manifest's version changed), attests build provenance for `main.js`, `styles.css` and `manifest.json` (the digests are this build's; the source revision recorded beside them is the run's triggering commit, one parent below the release commit, because the attesting action reads it from the event and takes no override), creates the GitHub release with that changelog section as its notes, and uploads the three assets.
4. **announce** nudges the community portal and sends a Telegram message. Both steps are optional and skip themselves cleanly when their secret is missing; neither can fail the release.

So a push never releases and never leaves a run waiting for anybody: it ends completed, with the plan in its summary. Cutting the release is a deliberate second act, `pnpm dev:helpers:release`, which works the same plan out locally from `origin/main` — last tag, commits since it, compare link, and the version release-it would choose — prints it, asks, and dispatches only on `y`. It never bumps, tags or pushes anything locally; it then watches the run it started. `--yes` skips the question, which is how an agent asked to "cut a release" at the end of a coding cycle does it unattended. The script refuses to show anything unless this checkout is `main`, level with `origin/main` and clean, and unless `gh` is pointing at the same repository as `origin` — otherwise what it prints is not what the runner would release. A dispatch names a branch, not a commit, so it also checks the run it started against the commit you approved and cancels that run if `main` moved in between.

Who may release is now bounded by who may dispatch this workflow: anyone with write access to the repository, and any app installation or fine-grained token granted `Actions: write` on it. On a one-maintainer repository that is the maintainer and whatever tokens they have issued. The reviewer rule that used to bound it is gone along with the pause it caused.

The same dispatch is two clicks away in the Actions UI (**Pipeline → Run workflow → main**, leaving `tag` empty), with the previous push run's summary as the thing to read first — but the UI dispatch is the weaker path, and deliberately so: a dispatch names a branch, GitHub resolves it to a commit when it creates the run, and only the script notices when that is not the commit you read about. In the UI, a push landing between reading the summary and pressing the button is released unreviewed, and the run's own plan summary is the only place it shows. Either way the dispatched run plans the tip of `main` itself; it never inherits the push run's numbers.

**What counts as releasable:** a `feat`, a `fix`, or any commit marked breaking with `!` or a `BREAKING CHANGE:` footer. Nothing else does — a batch of only `refactor`, `perf`, `docs`, `test`, `build`, `ci` or `style` commits gets you a green "nothing to release", which is the intended answer and not a bug. Those commits are not lost: the changelog preset renders most of them, and they appear in the section written by the next release that does happen. (release-it itself cannot answer this question — the conventional-commits preset recommends at least a patch for any commit at all — so the pipeline reads the commit subjects for it and only asks release-it for the number.)

**If `main` moved while the run was working**, the release job stops before it touches anything and says so: it verified one commit and will not release a different one. A dispatch still takes minutes to reach that job, which is long enough for someone to push. It never rebases and never releases the new tip — dispatch again on the new `main`. The same guard is what makes a double dispatch harmless: two runs verify in parallel, but only one `release` job executes at a time, and once the first has pushed its bump the second stops here rather than releasing the same commits twice.

**Republishing a tag** is the recovery path for a publish that died after the tag already existed. Run `pnpm dev:helpers:release --tag 1.2.3` (or fill the `tag` input in the Actions UI). That run skips `verify`, `scan` and `plan` entirely — the tag was verified when it was cut, and a recovery must not be blocked by an unrelated failure on today's `main` — checks out the tag, rebuilds, attests, reuses the GitHub release if it exists, and re-uploads the assets with `--clobber`. An existing release goes back to draft while its three files are swapped and is published again afterwards, so nobody can read it with one new file beside two old ones; that does not disturb which release GitHub calls the latest, because that is decided by the date of the commit behind the tag, not by when the release was published. The one thing not to do is dispatch a republish of a version at the moment that version is being cut — that is the only way two runs can end up working on the same release at once.

The increment comes from the commits, so a commit that breaks compatibility must carry the `!` in its header, whatever its type (`feat(mcp)!: require the subtask text`); a `BREAKING CHANGE:` footer is optional, for when the subject alone does not say what a user has to change. `.release-it.json` keeps `preMajor: true` until someone decides on `1.0.0`, which holds breaking changes to a minor bump; the pipeline has no way to force a version by hand, so `1.0.0` is reached by dropping that flag in a commit of its own and letting the next breaking change produce it.

Never rewrite older `versions.json` rows: Obsidian reads that file to send a user on an old app to the last plugin version that ran there, and every release up to `0.0.20` genuinely ran on `1.7.2`. The bump script adds the row for the current `minAppVersion` on every release.

### The one setting that lives in GitHub, not in this repository

The pipeline leans on it and cannot create it. A fresh fork or a restored repository has to have it set again by hand. (Nothing here uses a GitHub Environment any more. The workflow no longer names one, so a `release` environment left over from the approval gate this pipeline used to have is inert — no job is bound to it and no protection rule on it can stop or delay anything.)

**A tag ruleset, so only the pipeline can create a version tag.** The pipeline is the only thing that should ever create a `*.*.*` tag; a ruleset is what turns that from a convention into a rule. Go to **Settings → Rules → Rulesets → New ruleset → New tag ruleset**, name it (`Release tags`), set **Enforcement status** to **Active**, under **Target tags** add a target with **Include by pattern** `*.*.*`, and tick all three of **Restrict creations**, **Restrict updates** and **Restrict deletions**. All three matter, not just the first: the republish path trusts an existing tag instead of re-verifying it, and a tag that can be moved is not a version — moved onto a later commit that still carries the same number in its manifest, it would pass every check the republish path makes and overwrite a published release's assets with different code.

**Do not create that ruleset until the release App below exists.** Rulesets apply to `GITHUB_TOKEN` too, and the pipeline pushes its tag with `GITHUB_TOKEN` by default, so **Restrict creations** would block every release. The obvious escape does not work: the built-in `github-actions[bot]` identity is not offered as a bypass actor in the ruleset UI and cannot be relied on through the API either. What can be bypassed is a GitHub App you own — which is why the release job can push as one.

**The release App, the thing that makes the ruleset survivable.** Create a GitHub App on the `stavarengo` account (**Settings → Developer settings → GitHub Apps → New GitHub App**), give it the repository permission **Contents: read and write** and nothing else, install it on this repository alone, and generate a private key. Then store its two halves as repository secrets: `RELEASE_APP_CLIENT_ID` (the **Client ID**, the `Iv23…` string on the App's settings page — not the numeric App ID beside it, which the token action now treats as deprecated) and `RELEASE_APP_PRIVATE_KEY` (the whole `.pem` file, `BEGIN`/`END` lines included). Keep the numeric App ID to hand anyway: that is the one the ruleset bypass wants below.

```bash
gh secret set RELEASE_APP_CLIENT_ID --repo stavarengo/folia-kanban --body '<Client ID>'
gh secret set RELEASE_APP_PRIVATE_KEY --repo stavarengo/folia-kanban < release-app.private-key.pem
```

The release job reads nothing but the presence of those two: with both set it mints an installation token with `actions/create-github-app-token` and release-it pushes the bump, the changelog commit and the tag as the App; with either missing it pushes with `GITHUB_TOKEN` exactly as before. Nothing else in the job sees the private key.

One consequence to expect, because it looks like a bug the first time: `GITHUB_TOKEN` pushes deliberately start no workflow run, an App's pushes do. So with the App configured, every release is followed by one extra push run of the pipeline over the `chore(release)` commit, which verifies, scans, plans and ends at "nothing to release" — `chore` is not releasable. The tag push starts nothing in either case; this workflow has no tag trigger.

With the App installed and the secrets set, create the ruleset with that App on its bypass list. In the UI it is offered by name under **Bypass list → Add bypass**. Over the API it is the `Integration` actor with the App's own numeric id (`gh api /repos/stavarengo/folia-kanban/installation --jq '{slug: .app_slug, id: .app_id}'` prints the App installed on this repository and the id to use, which replaces the `000000` below):

```bash
gh api --method POST repos/stavarengo/folia-kanban/rulesets --input - <<'JSON'
{
  "name": "Release tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [{ "actor_type": "Integration", "actor_id": 000000, "bypass_mode": "always" }],
  "conditions": { "ref_name": { "include": ["refs/tags/*.*.*"], "exclude": [] } },
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }]
}
JSON
```

Then prove it before trusting it: the next release run has to get its tag pushed. If the `release` job fails on `git push` with a message about a ref protected by rules, the bypass did not take — widen or drop the ruleset. Nothing in this repository needs to change either way. The same warning applies to any rule added later on the `main` branch: the release job pushes the `chore(release)` commit straight to `main`, so a branch ruleset that restricts updates or demands a pull request has to carry the same bypass or it stops releases outright.

Read the bypass for what it is, too: it authorises the App, not this one workflow. It stops a person creating a version tag by hand, which is the point; it cannot stop some future workflow in this repository from minting the same token and doing it.

**And one thing to check:** any required status check on `main` or on pull requests. The workflow's name changed from `CI` to `Pipeline`, its file from `ci.yml` to `pipeline.yml`, and the scan job's id from `obsidian-scan` to `scan`, so a rule written against the old identity may now be waiting for a check nothing reports. Both job display names are deliberately unchanged (`Verify`, `Obsidian community scan`), and so is the `verify` job's id, which should be enough for a rule keyed on those — but open the branch rule or ruleset and confirm the checks it lists are still being reported, rather than assuming it.

**And one thing to delete:** the `FOLIA_KANBAN_RELEASE_IT_GITHUB_TOKEN` repository secret. The pipeline pushes with `GITHUB_TOKEN`, or with the release App's token, so that personal access token is no longer read by anything and should be removed from the repository's secrets and revoked in the account's developer settings.

### Forks and pull requests

**A pull request from a fork** runs `verify` and `scan` and nothing else. `plan` is `main`-only and `release` only ever runs on a dispatch, so a pull request cannot reach either. Those two jobs get the workflow's top-level `contents: read` token, scoped to this repository and read-only, and no secrets: GitHub does not hand repository secrets to a workflow run triggered by a pull request from a fork, and the workflow never uses `pull_request_target`, the trigger that would run fork code with this repository's secrets and write token. A first-time contributor's run also waits for a maintainer to press **Approve and run** before it starts, which is where the code gets read before it executes.

So the worst a hostile pull request can do is make our own runners execute its code with a read-only token and no credentials. It cannot tag, release, push, read a secret, or reach the release App: none of that is present in the jobs it can start.

**Someone forking the repository** takes the workflow with them. It runs in their fork, on their Actions quota, with their token, and it is their repository it can release to: a dispatch in a fork cuts a tag and a GitHub release in that fork. The announce steps skip themselves there, because `OBSIDIAN_PORTAL_COOKIE`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` do not exist in a fork, and the release App is not installed on it either, so its release pushes with the fork's own `GITHUB_TOKEN`. Nothing a fork does reaches this repository — its tokens are scoped to itself — and nothing it publishes reaches the Obsidian directory, which follows this repository's releases by name.

### Threat model

The pipeline runs other people's code on machines holding this repository's release credentials, which is the `tj-actions/changed-files` shape of problem: a third-party action is compromised upstream, everyone floating on its tag picks the new code up silently, and it reads whatever the job it runs in can reach.

What each job could lose:

- **verify** and **scan**: the repository's own source, a read-only token, no secrets. The scan job is also where the one deliberately unpinned action runs (`obsidianmd/obsidian-workflows@v1`, floating so it tracks the directory's real scanner), so its blast radius is stated rather than eliminated: a read-only token, no secrets, and no output that anything downstream consumes — the release job rebuilds from the tag and never reads this job's artifacts.
- **plan**: the same read-only token, plus the ability to influence which version the release job is told to cut, since it hands that number on.
- **release**: `contents: write`, the attestation identity, and — if it is configured — the release App's installation token while the push step runs. This is the job worth protecting.
- **announce**: a read-only token, plus the portal cookie and the Telegram bot's credentials.

The mitigation is that every third-party action in the release path is pinned to a full commit SHA (`uses: actions/checkout@3d3c42e5… # v7.0.1`), which a tag being moved cannot change, and `.github/dependabot.yml` opens a pull request when a pinned action has a newer release, so the pins keep moving. Dependency install scripts are a second route in, and pnpm closes it: `pnpm-workspace.yaml` allow-lists build scripts per package (`esbuild` yes, `lefthook` no), so a newly compromised dependency's `postinstall` does not run on the runner. This repository's own `prepare` script does run — it is our code.

**Two settings only you can change**, both at **Settings → Actions → General**:

1. **Fork pull request workflows from outside collaborators** → **Require approval for all external contributors** (or the strictest option offered). It puts every fork pull request behind your approval before any runner executes it, rather than only the first one from a given account.
2. **Actions permissions** → **Allow _stavarengo_, and select non-_stavarengo_, actions and reusable workflows**, with **Allow actions created by GitHub** and **Allow actions by Marketplace verified creators** ticked, and this list in the box: `actions/*`, `pnpm/action-setup@*`, `obsidianmd/obsidian-workflows@*`. That is everything this workflow uses, and it means a pull request cannot introduce a step that runs some other action.

### Optional secrets the announce step looks for

Neither is required; the step that needs a missing one says so in its log and moves on. `OBSIDIAN_PORTAL_COOKIE` is the maintainer's `community.obsidian.md` session cookie, used for the manual re-check described at the end of this document — it expires, and a run that reports the login page is telling you to refresh it. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are a bot's credentials for the "released" message, which carries the version, the release URL and whatever the portal answered.

## The two scanner checks

The community directory reviews every release with a scanner: Stylelint with its own ruleset, plus ESLint with `eslint-plugin-obsidianmd`. The official tooling exists only as a GitHub Action, so this repo checks itself twice.

`pnpm obsidian-scan:check` (`scripts/obsidian-scan.mjs`, part of `pnpm verify`) reproduces both passes locally and is the gate: it fails on any finding, warning or error, and it is the only signal available before pushing.

The `scan` job in `pipeline.yml` runs the real action, floating on `v1`. It never fails on lint findings and cannot be configured to; it records every finding as a warning and only errors on a broken manifest, a missing README or licence, or a failed tool install. Its value is drift detection: the directory pins its own tool versions, the local script cannot match them, so a finding in that job's log that `obsidian-scan:check` did not produce means `scripts/obsidian-scan.mjs` needs updating.

## The public portal

The listing is at [community.obsidian.md/plugins/folia-kanban](https://community.obsidian.md/plugins/folia-kanban), no login needed. It shows a review rating and an issue count for the latest release; the itemised findings are only on the maintainer's own account page.

Some findings are permanent and informational, not things to fix: the AGPL-3.0 copyleft notice, "vault enumeration" (inherent to a plugin that reads every card), and "malware/obfuscation scan not available".

When the portal lags behind GitHub, the maintainer's account page has a manual trigger: `GET https://community.obsidian.md/account/plugins/folia-kanban/check-release`, sent with the browser's logged-in session (open the plugin's page under Account → Plugins and use its check-for-releases action, or replay that request with the session cookie). It answers "This entry was refreshed in the last few minutes. Please wait before trying again." when called inside its cooldown, so one call per few minutes is the most it accepts. Nothing public or unauthenticated exists (researched in August 2026 across the docs, blog, the `obsidianmd` org and the forum), and Obsidian's own commitment is only that a passing release appears within about a day. If the trigger does not pick it up, wait that day, then ask staff on the forum or the plugin-review channels; do not debug the release pipeline over a stale version number. Precedent: [one stuck listing](https://forum.obsidian.md/t/plugin-submission-portal-stuck-on-no-release-matches-your-manifest-version-despite-correct-releases/114686) was cleared by staff by hand, [another](https://forum.obsidian.md/t/no-release-matches-your-manifest-version/116025) resolved itself after a day.
