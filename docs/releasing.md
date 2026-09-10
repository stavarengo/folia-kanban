# Releasing, and the community directory

Maintainer notes: how a release is cut, what checks it against the Obsidian community directory's scanner, and what to expect from the public portal afterwards.

## Cutting a release

Everything lives in one workflow, `.github/workflows/pipeline.yml`, and one run of it does the whole job. The jobs are chained with `needs`, so what gets published is what passed `pnpm verify` a few minutes earlier in the same run, plus release-it's version bump on top of it — no workflow triggers another, and no green tick from somewhere else is taken on trust.

1. **verify** and **scan** run in parallel on every push to `main`, every pull request, and a manual dispatch that is not a republish. `verify` is the full `pnpm verify` (it builds, and the build is kept as the run's `dist` artifact); `scan` is Obsidian's own action, described below.
2. **plan** runs on `main` only, after both. It decides whether the commits since the last tag contain anything worth releasing, and asks release-it for the version number. When there is nothing to release the run ends green with a line saying so, and nobody is asked to approve anything.
3. **approve** does nothing at all. It exists to sit behind the `release` GitHub Environment, which pauses the run until a required reviewer presses **Review deployments → Approve and deploy** in the Actions UI.
4. **release** runs release-it on the approved commit: bump `manifest.json`/`versions.json`/`package.json`, write the `CHANGELOG.md` section, commit, tag and push — with `GITHUB_TOKEN`, whose pushes deliberately start no new workflow run. It then rebuilds (the manifest's version changed), attests build provenance for `main.js`, `styles.css` and `manifest.json` (the digests are this build's; the source revision recorded beside them is the run's triggering commit, one parent below the release commit, because the attesting action reads it from the event and takes no override), creates the GitHub release with that changelog section as its notes, and uploads the three assets.
5. **announce** nudges the community portal and sends a Telegram message. Both steps are optional and skip themselves cleanly when their secret is missing; neither can fail the release.

Most of the time there is nothing to start. Pushing a releasable commit to `main` already ran the pipeline, and it is sitting at the approval gate waiting for you — approving that run *is* cutting the release. `pnpm dev:helpers:release` is for when no run is waiting: the push run was cancelled or failed for an unrelated reason, or you want a fresh run over commits that landed since. It dispatches the pipeline on `main` through the `gh` CLI and watches that run in your terminal, approval pause included, and it never bumps, tags or pushes anything locally. The same thing is two clicks away in the Actions UI: **Pipeline → Run workflow → main**.

Do not approve two runs of the same release. Only one run can be executing per branch, so a dispatched run queues behind the push run; if the first one releases, the second stops at its own guard, because `main` has moved on since the commit it was started for.

**What counts as releasable:** a `feat`, a `fix`, or any commit marked breaking with `!` or a `BREAKING CHANGE:` footer. Nothing else does — a batch of only `refactor`, `perf`, `docs`, `test`, `build`, `ci` or `style` commits gets you a green "nothing to release", which is the intended answer and not a bug. Those commits are not lost: the changelog preset renders most of them, and they appear in the section written by the next release that does happen. (release-it itself cannot answer this question — the conventional-commits preset recommends at least a patch for any commit at all — so the pipeline reads the commit subjects for it and only asks release-it for the number.)

**If `main` moved while the approval was waiting**, the release job stops before it touches anything and says so: it verified one commit and will not release a different one. It never rebases and never releases the new tip. Dispatch the pipeline again on the new `main` and approve that run.

**Republishing a tag** is the recovery path for a publish that died after the tag already existed. Run `pnpm dev:helpers:release --tag 1.2.3` (or fill the `tag` input in the Actions UI). That run skips `verify`, `scan`, `plan` and `approve` entirely — the tag was verified when it was cut, and a recovery must not be blocked by an unrelated failure on today's `main` — checks out the tag, rebuilds, attests, reuses the GitHub release if it exists, and re-uploads the assets with `--clobber`. An existing release goes back to draft while its three files are swapped and is published again afterwards, so nobody can read it with one new file beside two old ones; that does not disturb which release GitHub calls the latest, because that is decided by the date of the commit behind the tag, not by when the release was published. The one thing not to do is dispatch a republish of a version at the moment that version is being cut — those two runs are the only pair the pipeline does not hold apart from each other.

The increment comes from the commits, so a commit that breaks compatibility must carry the `!` in its header, whatever its type (`feat(mcp)!: require the subtask text`); a `BREAKING CHANGE:` footer is optional, for when the subject alone does not say what a user has to change. `.release-it.json` keeps `preMajor: true` until someone decides on `1.0.0`, which holds breaking changes to a minor bump; the pipeline has no way to force a version by hand, so `1.0.0` is reached by dropping that flag in a commit of its own and letting the next breaking change produce it.

Never rewrite older `versions.json` rows: Obsidian reads that file to send a user on an old app to the last plugin version that ran there, and every release up to `0.0.20` genuinely ran on `1.7.2`. The bump script adds the row for the current `minAppVersion` on every release.

### Two settings that live in GitHub, not in this repository

The pipeline leans on both and can create neither. A fresh fork or a restored repository has to have them set again by hand.

**1. A required reviewer on the `release` environment.** Do this one first, before the pipeline can ever reach a releasable commit: the environment appears on its own the first time a run reaches the `approve` job, and an environment with no protection rule gates nothing, so that first run would release straight through with nobody asked. Creating it by hand ahead of time is the safe order — the name is all that has to match. Add the rule at **Settings → Environments → `release` → Deployment protection rules → Required reviewers**, add `stavarengo`, then **Save protection rules**. Leave **Prevent self-review** off: with it on, the person who started the run cannot approve it, and on a one-maintainer repository that means no release can ever be approved.

The same thing over the API, if the UI is not to hand:

```bash
gh api --method PUT repos/stavarengo/folia-kanban/environments/release --input - <<JSON
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{ "type": "User", "id": $(gh api users/stavarengo --jq .id) }],
  "deployment_branch_policy": null
}
JSON
```

**2. A tag ruleset, so only the pipeline can create a version tag.** The pipeline is the only thing that should ever create a `*.*.*` tag; a ruleset is what turns that from a convention into a rule. Go to **Settings → Rules → Rulesets → New ruleset → New tag ruleset**, name it (`Release tags`), set **Enforcement status** to **Active**, under **Target tags** add a target with **Include by pattern** `*.*.*`, and tick all three of **Restrict creations**, **Restrict updates** and **Restrict deletions**. All three matter, not just the first: the republish path trusts an existing tag instead of re-approving it, and a tag that can be moved is not a version — moved onto a later commit that still carries the same number in its manifest, it would pass every check the republish path makes and overwrite a published release's assets with different code.

One catch that has to be handled in the same sitting: rulesets apply to the `GITHUB_TOKEN` too, so without a bypass this rule blocks the pipeline's own tag push along with everyone else's. Add **GitHub Actions** to the ruleset's **Bypass list**. If the app is not offered in that picker — it is not consistently listed for user-owned repositories — add it through the API instead, where it is the `Integration` actor with GitHub Actions' app id:

```bash
gh api --method POST repos/stavarengo/folia-kanban/rulesets --input - <<'JSON'
{
  "name": "Release tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [{ "actor_type": "Integration", "actor_id": 15368, "bypass_mode": "always" }],
  "conditions": { "ref_name": { "include": ["refs/tags/*.*.*"], "exclude": [] } },
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }]
}
JSON
```

Then prove it before trusting it: the next release run has to get its tag pushed. If the `release` job fails on `git push` with a message about a ref protected by rules, the bypass did not take — widen or drop the ruleset. Nothing in this repository needs to change either way. The same warning applies to any rule added later on the `main` branch: the release job pushes the `chore(release)` commit straight to `main`, so a branch ruleset that restricts updates or demands a pull request has to carry the same bypass or it stops releases outright.

Read the bypass for what it is, too: it authorises the GitHub Actions identity, not this one workflow. It stops a person creating a version tag by hand, which is the point; it cannot stop some future workflow in this repository from doing it.

**And one thing to check:** any required status check on `main` or on pull requests. The workflow's name changed from `CI` to `Pipeline`, its file from `ci.yml` to `pipeline.yml`, and the scan job's id from `obsidian-scan` to `scan`, so a rule written against the old identity may now be waiting for a check nothing reports. Both job display names are deliberately unchanged (`Verify`, `Obsidian community scan`), and so is the `verify` job's id, which should be enough for a rule keyed on those — but open the branch rule or ruleset and confirm the checks it lists are still being reported, rather than assuming it.

**And one thing to delete:** the `FOLIA_KANBAN_RELEASE_IT_GITHUB_TOKEN` repository secret. The pipeline pushes with `GITHUB_TOKEN`, so that personal access token is no longer read by anything and should be removed from the repository's secrets and revoked in the account's developer settings.

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
