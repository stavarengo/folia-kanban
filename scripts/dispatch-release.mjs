#!/usr/bin/env node
// The console for reviewing and starting a release, without being able to cut
// one: it shows what the pipeline would release, asks, and then dispatches
// .github/workflows/pipeline.yml on main and watches that run. Nothing is
// bumped, tagged or pushed locally — the runner does all of it, on a commit it
// has verified in the same run. Run via `pnpm dev:helpers:release`.
//
// Usage:
//   pnpm dev:helpers:release               review the plan, confirm, release from main
//   pnpm dev:helpers:release --yes         the same without the question, for agents
//   pnpm dev:helpers:release --tag 1.2.3   republish an existing tag
//
// The dispatch is the approval — the run it starts has no gate and waits for
// nobody — so the review has to happen before it. What is printed is computed
// here from `origin/main` after a fetch, the same way the pipeline's plan job
// computes it on the runner: the last release tag, the commits since it, and
// the version release-it would choose. That only holds while this checkout is
// main and level with `origin/main`, which is why the script refuses to show
// anything otherwise — and a dispatch names a branch rather than a commit, so
// the run it started is checked against the reviewed commit afterwards and
// cancelled if main moved in between.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const WORKFLOW = "pipeline.yml";
const GH_MISSING =
  "gh is not on PATH. Install it from https://cli.github.com, then run: gh auth login";
const GH_UNAUTHENTICATED = "gh is not authenticated for github.com. Run: gh auth login";

const die = (message) => {
  console.error(message);
  process.exit(1);
};

const gh = (args, { inherit = false } = {}) => {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error?.code === "ENOENT") die(GH_MISSING);
  if (result.error) die(`gh ${args[0]} failed: ${result.error.message}`);
  return result;
};

const git = (args, { allowFailure = false } = {}) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) die(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowFailure) return undefined;
    die(`git ${args.join(" ")} failed:\n${result.stderr.trim()}`);
  }
  return result.stdout.trim();
};

const USAGE = "Usage: pnpm dev:helpers:release [--yes] [--tag <existing tag to republish>]";

const parseArgs = (argv) => {
  const options = { tag: undefined, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg.startsWith("--tag=")) {
      options.tag = arg.slice("--tag=".length);
    } else if (arg === "--tag" && i + 1 < argv.length) {
      i += 1;
      options.tag = argv[i];
    } else {
      die(USAGE);
    }
  }
  return options;
};

// The same grammar the workflow enforces (and scripts/bump-plugin-version.mjs
// writes), so a typo is refused here rather than three minutes into a run.
const IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const TAG = new RegExp(
  String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-${IDENTIFIER}(?:\.${IDENTIFIER})*)?$`,
);

// What the plan job counts as worth releasing, in the same three tests: a feat
// or fix, any type marked breaking with `!`, or a BREAKING CHANGE footer.
const RELEASABLE_SUBJECT = /^(?:feat|fix)(?:\([^)]*\))?!?:/m;
const BREAKING_SUBJECT = /^[a-zA-Z]+(?:\([^)]*\))?!:/m;
const BREAKING_BODY = /^BREAKING[ -]CHANGE:/m;

const { tag, yes } = parseArgs(process.argv.slice(2));
if (tag !== undefined && !TAG.test(tag)) {
  die(`"${tag}" is not a plain semver tag (e.g. 1.2.3). The pipeline would refuse it.`);
}

gh(["--version"]);
if (gh(["auth", "status", "--hostname", "github.com"]).status !== 0) die(GH_UNAUTHENTICATED);

const me = gh(["api", "user", "--jq", ".login"]);
if (me.status !== 0) die(GH_UNAUTHENTICATED);
const login = me.stdout.trim();

const confirm = async (question) => {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    die(`${question}\nThere is no terminal to ask on. Re-run with --yes to dispatch unattended.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
};

// Everything the plan job would work out, worked out here first. Skipped for a
// republish: that path publishes a tag that already exists, so there is no
// version to choose and no commit range to read.
const review = async () => {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    die(
      `This checkout is on ${branch}, not main, so what it can show is not what the runner would release. Switch to main and re-run.`,
    );
  }
  if (git(["status", "--porcelain"]) !== "") {
    die(
      "The working tree is not clean. release-it refuses to answer with uncommitted changes around, and the runner would release the commit, not the tree. Commit or clean up, then re-run.",
    );
  }

  // gh does not have to agree with the git remote — GH_REPO and
  // `gh repo set-default` both retarget it — and everything below reads git
  // while the dispatch goes through gh. Two repositories would mean a plan
  // printed from one and a release cut in the other.
  const named = gh(["repo", "view", "--json", "nameWithOwner,url"]);
  if (named.status !== 0)
    die("Could not read the repository gh is pointing at. Check: gh repo view");
  const { nameWithOwner, url: repoUrl } = JSON.parse(named.stdout);
  const originUrl = git(["remote", "get-url", "origin"]);
  const originPath = originUrl.replace(/\.git$/, "").replace(/^.*[/:]([^/:]+\/[^/]+)$/, "$1");
  if (originPath.toLowerCase() !== nameWithOwner.toLowerCase()) {
    die(
      `gh is pointing at ${nameWithOwner} while origin is ${originPath}, so the plan below would describe one repository and the dispatch would start a release in the other. Unset GH_REPO, or run: gh repo set-default ${originPath}`,
    );
  }

  // --tags as well as the branch: `git describe` below reads local tags, and
  // without this a release tag cut since the last fetch would be missing.
  git(["fetch", "--tags", "origin", "main"]);

  const head = git(["rev-parse", "HEAD"]);
  const remote = git(["rev-parse", "FETCH_HEAD"]);
  if (head !== remote) {
    die(
      `main here (${head.slice(0, 7)}) is not origin/main (${remote.slice(0, 7)}), so what it can show is not what the runner would release. Pull or push first, then re-run.`,
    );
  }

  // Matches .release-it.json's tagExclude, so this and release-it agree on
  // where the last release was.
  const previous = git(
    ["describe", "--tags", "--abbrev=0", "--match", "*.*.*", "--exclude", "*-*"],
    {
      allowFailure: true,
    },
  );
  if (previous !== undefined && !TAG.test(previous)) {
    die(
      `The nearest tag, "${previous}", is not a plain semver release tag, so where the last release ended cannot be established.`,
    );
  }

  // Fetching tags adds, it never removes: a tag that only exists here — a
  // local experiment, or one deleted from the remote — would still be picked as
  // the last release, and then everything below describes a range the runner
  // will not see. So the tag this hangs on has to be on origin, and be the same
  // object there.
  if (previous !== undefined) {
    const listed = git(["ls-remote", "--tags", "origin", `refs/tags/${previous}`]);
    const remoteTag = listed.split("\n")[0]?.split("\t")[0] ?? "";
    const localTag = git(["rev-parse", `refs/tags/${previous}`]);
    if (remoteTag === "") {
      die(
        `The tag "${previous}" exists here but not on origin, so this checkout's idea of the last release is not the runner's. Delete it locally (git tag -d ${previous}) or push it, then re-run.`,
      );
    }
    if (
      remoteTag !== localTag &&
      remoteTag !== git(["rev-parse", `refs/tags/${previous}^{commit}`])
    ) {
      die(
        `The tag "${previous}" points at a different object here than on origin, so this checkout's idea of the last release is not the runner's. Re-fetch it (git fetch --force origin tag ${previous}), then re-run.`,
      );
    }
  }

  const range = previous === undefined ? head : `${previous}..${head}`;
  const since = previous ?? "the first commit";
  const commits = git(["log", "--format=%h %s", range]);
  const subjects = git(["log", "--format=%s", range]);
  const bodies = git(["log", "--format=%B", range]);
  const releasable =
    RELEASABLE_SUBJECT.test(subjects) ||
    BREAKING_SUBJECT.test(subjects) ||
    BREAKING_BODY.test(bodies);

  const link =
    previous === undefined
      ? `${repoUrl}/commits/${head}`
      : `${repoUrl}/compare/${previous}...${head}`;

  console.log(`Commits since ${since}:`);
  console.log(commits === "" ? "  (none)" : commits.replace(/^/gm, "  "));
  console.log(`\n${link}\n`);

  if (!releasable) {
    console.log(
      `Nothing to release: no feat, fix or breaking-change commit since ${since}. The pipeline would say the same and release nothing, so this is not dispatching a run.`,
    );
    process.exit(0);
  }

  // release-it's own answer, not a guess at it: preMajor and the changelog
  // preset stay in one place, and this is the number the run will be told to
  // cut.
  const printed = spawnSync("pnpm", ["exec", "release-it", "--release-version", "--ci"], {
    encoding: "utf8",
  });
  if (printed.status !== 0) {
    die(`release-it could not work out the next version:\n${printed.stderr.trim()}`);
  }
  const version = printed.stdout.trim().split("\n").at(-1)?.trim() ?? "";
  if (!TAG.test(version)) {
    die(`release-it answered "${version}", which is not a plain semver version.`);
  }

  console.log(`Next version: ${version}${previous === undefined ? "" : ` (was ${previous})`}`);

  return { head, confirmed: await confirm(`Release ${version} from ${head.slice(0, 7)}?`) };
};

// The commit the plan was printed for, kept so the run that starts can be held
// to it. A dispatch names a branch, never a commit, so GitHub resolves `main`
// at the moment it creates the run — which is not the moment this printed it.
let reviewed;
if (tag === undefined) {
  const outcome = await review();
  if (!outcome.confirmed) {
    console.log("Nothing dispatched.");
    process.exit(0);
  }
  reviewed = outcome.head;
}

const listRuns = () => {
  const listed = gh([
    "run",
    "list",
    "--workflow",
    WORKFLOW,
    "--branch",
    "main",
    "--event",
    "workflow_dispatch",
    "--user",
    login,
    "--limit",
    "10",
    "--json",
    "databaseId,url,headSha",
  ]);
  return listed.status === 0 ? JSON.parse(listed.stdout) : undefined;
};

// Run ids only ever grow, so "newer than everything that existed a moment ago"
// identifies our own run without comparing this machine's clock to GitHub's.
const before = listRuns();
if (before === undefined) die(`Could not list runs of ${WORKFLOW}. Check: gh repo view`);
const highestBefore = before.reduce((highest, item) => Math.max(highest, item.databaseId), 0);

const run = ["workflow", "run", WORKFLOW, "--ref", "main"];
if (tag !== undefined) run.push("--field", `tag=${tag}`);

const dispatch = gh(run);
if (dispatch.status !== 0) {
  die(`Could not dispatch ${WORKFLOW} on main:\n${dispatch.stderr.trim()}`);
}
console.log(
  tag === undefined ? "Dispatched a release from main." : `Dispatched a republish of ${tag}.`,
);

// The run is queued asynchronously, so it is not listable the instant the
// dispatch returns.
const findRun = () => {
  // GitHub's dispatch API answers with nothing to correlate on, so "newer than
  // the snapshot, same actor" is as close as this gets. If that matches more
  // than one run, say so rather than watch a coin toss.
  const fresh = listRuns()?.filter((candidate) => candidate.databaseId > highestBefore) ?? [];
  if (fresh.length > 1) {
    die(
      `More than one new run of ${WORKFLOW} appeared, so this cannot tell which one it started:\n${fresh
        .map((candidate) => `  ${candidate.url}`)
        .join("\n")}`,
    );
  }
  return fresh[0];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let dispatched;
for (let attempt = 0; attempt < 20 && dispatched === undefined; attempt += 1) {
  await sleep(2000);
  dispatched = findRun();
}

if (dispatched === undefined) {
  die(
    `The run did not appear within 40s. It may still start — watch it with: gh run list --workflow ${WORKFLOW}`,
  );
}

console.log(dispatched.url);

// The run is only the release that was reviewed if it started on the reviewed
// commit. A push landing between the plan above and GitHub creating the run
// would give the run a newer tip, which the runner's own "main moved" guard
// cannot catch — that commit is its GITHUB_SHA. Cancelling costs a minute of
// runner time and nothing else: nothing is pushed until long after this point,
// and the release job refuses to run in a cancelled run.
if (reviewed !== undefined && dispatched.headSha !== reviewed) {
  const cancelled = gh(["run", "cancel", String(dispatched.databaseId)]);
  die(
    `main moved between the plan above and the dispatch: you approved ${reviewed.slice(0, 7)}, the run started on ${dispatched.headSha.slice(0, 7)}. ${
      cancelled.status === 0
        ? "That run has been cancelled and nothing was released."
        : `That run could NOT be cancelled (${cancelled.stderr.trim()}) — cancel it by hand: ${dispatched.url}`
    }\nRe-run to review the new tip.`,
  );
}

console.log(
  tag === undefined
    ? "Watching. It verifies and scans the tip of main again, then releases; it waits for nobody."
    : "Watching. A republish goes straight to the release job.",
);

const watched = gh(["run", "watch", String(dispatched.databaseId), "--exit-status"], {
  inherit: true,
});
process.exit(watched.status ?? 1);
