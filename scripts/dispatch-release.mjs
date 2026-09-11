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
// anything otherwise. What is approved here is then handed to the run as
// `expected_sha` and `expected_version`, and the run refuses to release
// anything else: a dispatch names a branch rather than a commit, so GitHub
// resolves main when it creates the run, and the run reads the tags when it
// gets there. Only the run can compare what it is about to release with what
// somebody read, which is why the enforcement lives there and not here.

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
// or fix, any type marked breaking with `!`, or a BREAKING CHANGE footer. The
// type grammar and the space after the colon are the changelog preset's, so
// this and release-it read the same subjects the same way.
const RELEASABLE_SUBJECT = /^(?:feat|fix)(?:\([^)]*\))?!?: /m;
const BREAKING_SUBJECT = /^\w*(?:\([^)]*\))?!: /m;
// The footer grammar is the parser's own: case-insensitive, and an optional
// `* ` bullet in front, which is how a breaking note written as a bullet point
// still counts as one.
const BREAKING_BODY = /^(?:\*\s+)?BREAKING[ -]CHANGE:/im;

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

// Text safe to print: every C0 control character and DEL replaced, tabs and
// newlines kept. Used on anything a commit author wrote, since an escape
// sequence in a commit subject can repaint the screen it is printed on.
const printable = (text) => text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "?");

// "host/owner/repo" for a remote, whatever spelling it arrives in: an https
// URL, an scp-style `git@host:owner/repo`, or an ssh:// one. The host is half
// of the answer — a mirror or another forge can carry the same owner/repo and
// is not the repository gh would dispatch — and anything userinfo carries is
// dropped, so a URL with a token in it cannot end up in an error message.
// undefined for anything that is not a two-segment repository path.
const remoteIdentity = (url) => {
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(url);
  const { host, path } = scp
    ? { host: scp[1], path: scp[2] }
    : (() => {
        try {
          const parsed = new URL(url);
          // hostname, not host: an explicit port (`ssh://git@github.com:22/…`)
          // is a way of reaching the same repository, and gh never spells one.
          return { host: parsed.hostname, path: parsed.pathname };
        } catch {
          return { host: undefined, path: "" };
        }
      })();
  if (host === undefined) return undefined;
  const segments = path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter((segment) => segment !== "");
  if (segments.length !== 2) return undefined;
  return `${host}/${segments.join("/")}`.toLowerCase();
};

// Which repository everything below acts on, taken from `origin` and then
// spelled out on every gh call. gh resolves a repository per command — GH_REPO
// and `gh repo set-default` retarget some and not others, which is how a plan
// read from one repository can be dispatched into another that shares its
// history. Saying it every time removes the question.
const ORIGIN = remoteIdentity(git(["remote", "get-url", "origin"]));
if (ORIGIN === undefined) {
  die("Cannot read `origin` as a GitHub repository, so there is nothing safe to dispatch against.");
}
const [originHost, ...originPath] = ORIGIN.split("/");
if (originHost !== "github.com") {
  die(
    `origin is on ${originHost}, and gh is authenticated for github.com, so a dispatch from here would go to a different repository than the one this reads. Nothing to do but point origin at GitHub.`,
  );
}
const REPO = originPath.join("/");
const REPO_URL = `https://github.com/${REPO}`;

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
  // The runner clones the whole history. A shallow clone here would cut the
  // commit range short at its boundary, and `git describe` would answer "no
  // previous release" from a history that simply stops — a plan for a different
  // repository state, printed with the same confidence.
  if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
    die(
      "This is a shallow clone, so the commit range and the version below would be worked out from a history that stops early. Run: git fetch --unshallow, then re-run.",
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
      ? `${REPO_URL}/commits/${head}`
      : `${REPO_URL}/compare/${previous}...${head}`;

  console.log(`Commits since ${since}:`);
  // Commit subjects are written by whoever wrote the commit, and this is a
  // screen someone is about to approve from. Escape sequences in a subject can
  // repaint the lines above the prompt, so nothing below C0 reaches the
  // terminal.
  console.log(commits === "" ? "  (none)" : printable(commits).replace(/^/gm, "  "));
  console.log(`\n${link}\n`);

  if (!releasable) {
    console.log(
      `Nothing to release: no feat, fix or breaking-change commit since ${since}. The pipeline would say the same and release nothing, so this is not dispatching a run.`,
    );
    process.exit(0);
  }

  // release-it's own answer, not a guess at it: preMajor and the changelog
  // preset stay in one place, and this is the number the run will be told to
  // cut. It comes from the release-it installed here, so a node_modules older
  // than the lockfile can answer differently from the runner's fresh install —
  // run `pnpm install` if this machine has been away for a while.
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

  // release-it fetches before it answers, so its idea of the last release can
  // be newer than the one the commit list above was measured from. One screen
  // built from two different tag sets is the one thing worse than a stale one.
  if (
    git(["describe", "--tags", "--abbrev=0", "--match", "*.*.*", "--exclude", "*-*"], {
      allowFailure: true,
    }) !== previous
  ) {
    die(
      `A tag landed while this was working the version out, so the commits above and the version below no longer describe the same release. Nothing has been dispatched; re-run to see the new plan.`,
    );
  }

  console.log(`Next version: ${version}${previous === undefined ? "" : ` (was ${previous})`}`);

  return {
    head,
    version,
    confirmed: await confirm(`Release ${version} from ${head.slice(0, 7)}?`),
  };
};

// What was approved, handed to the run as `expected_sha` and `expected_version`
// so the runner can refuse anything else. It is the runner that has to enforce
// this, not this script: a dispatch names a branch, so GitHub resolves `main`
// when it creates the run, and the run works the version out from the tags it
// finds then. Both can differ from what was printed here, and the run is the
// only side that knows what it is actually about to release.
let reviewed;
if (tag === undefined) {
  const outcome = await review();
  if (!outcome.confirmed) {
    console.log("Nothing dispatched.");
    process.exit(0);
  }
  reviewed = { head: outcome.head, version: outcome.version };
}

// Which ref the run is dispatched against. A republish runs against the tag
// itself: the run's own commit is what the provenance attestation records as
// the source, and a republish dispatched against main would sign today's tip
// as the source of a build from a months-old tag. Everything the run does with
// main it does by fetching origin/main explicitly, so this changes nothing
// else — except that GitHub also reads the workflow file from that ref, so the
// tag has to carry one. Tags cut before this pipeline existed do not, and are
// asked about here rather than guessed at from whatever the dispatch API says
// when it refuses.
let dispatchRef = "main";
if (tag !== undefined) {
  git(["fetch", "--tags", "origin"]);
  const onTag = git(["cat-file", "-e", `refs/tags/${tag}:.github/workflows/${WORKFLOW}`], {
    allowFailure: true,
  });
  if (onTag === undefined) {
    console.log(
      `The ${tag} tag carries no .github/workflows/${WORKFLOW} — it predates this pipeline — so the republish is dispatched against main. Its build provenance records the tip of main as the source commit rather than the tag's own.`,
    );
  } else {
    dispatchRef = `refs/tags/${tag}`;
  }
}

// GitHub files a run under the short name of the ref it was dispatched against.
const runBranch = dispatchRef === "main" ? "main" : tag;

const listRuns = () => {
  const listed = gh([
    "run",
    "list",
    "--repo",
    REPO,
    "--workflow",
    WORKFLOW,
    "--branch",
    runBranch,
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
// Only a fallback for the run URL below, which needs none of that.
const before = listRuns();
if (before === undefined) die(`Could not list runs of ${WORKFLOW} in ${REPO}.`);
const highestBefore = before.reduce((highest, item) => Math.max(highest, item.databaseId), 0);

const dispatchArgs = ["workflow", "run", WORKFLOW, "--repo", REPO, "--ref", dispatchRef];
if (tag !== undefined) dispatchArgs.push("--field", `tag=${tag}`);
if (reviewed !== undefined) {
  dispatchArgs.push(
    "--field",
    `expected_sha=${reviewed.head}`,
    "--field",
    `expected_version=${reviewed.version}`,
  );
}

const dispatch = gh(dispatchArgs);
if (dispatch.status !== 0) {
  die(`Could not dispatch ${WORKFLOW} on ${dispatchRef}:\n${dispatch.stderr.trim()}`);
}
console.log(
  tag === undefined ? "Dispatched a release from main." : `Dispatched a republish of ${tag}.`,
);

// gh prints the created run's URL when GitHub gives it one, which identifies
// the run exactly — no guessing from the listing, and no chance of watching
// somebody else's dispatch. It is documented as "if available", so the listing
// stays as the fallback: the run is queued asynchronously, so it is not
// listable the instant the dispatch returns, and "newer than the snapshot, same
// actor" is as close as correlation gets without an id. Two dispatches in
// flight at once can make that pick the wrong one, which costs the wrong run
// being watched; what was approved is enforced by the run itself, through the
// expected_sha and expected_version it was dispatched with, so nothing
// safety-related rests on this identification either way.
const announced = /https:\/\/\S*\/actions\/runs\/(\d+)\b/.exec(dispatch.stdout + dispatch.stderr);

const findRuns = () => {
  const listed = listRuns();
  if (listed === undefined) return [];
  return listed.filter((candidate) => candidate.databaseId > highestBefore);
};

let dispatched;
if (announced) {
  dispatched = { databaseId: Number(announced[1]), url: announced[0] };
} else {
  let fresh = [];
  for (let attempt = 0; attempt < 20 && fresh.length === 0; attempt += 1) {
    await sleep(2000);
    fresh = findRuns();
  }

  if (fresh.length !== 1) {
    const found =
      fresh.length === 0
        ? "it did not appear within 40s"
        : `${fresh.length} new runs appeared and it cannot tell which one is this dispatch:\n${fresh
            .map((candidate) => `  ${candidate.url}`)
            .join("\n")}`;
    die(
      `Dispatched, but not watching: ${found}.\nThe run is not lost — find it with: gh run list --repo ${REPO} --workflow ${WORKFLOW}${
        reviewed === undefined
          ? ""
          : `\nIt releases ${reviewed.version} from ${reviewed.head.slice(0, 7)} or nothing: it was dispatched with what you approved, and its own guard stops it if main or the tags moved since.`
      }`,
    );
  }

  dispatched = fresh[0];
}

console.log(dispatched.url);
console.log(
  tag === undefined
    ? `Watching. It verifies and scans main again, then releases ${reviewed.version} — or stops, if what it finds is no longer what you approved.`
    : "Watching. A republish goes straight to the release job.",
);

const watched = gh(
  ["run", "watch", String(dispatched.databaseId), "--repo", REPO, "--exit-status"],
  { inherit: true },
);
process.exit(watched.status ?? 1);
