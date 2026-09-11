#!/usr/bin/env node
// Starts a release from a developer machine without being able to cut one:
// it dispatches .github/workflows/pipeline.yml on main and then watches that
// run. Nothing is bumped, tagged or pushed locally — the runner does all of it,
// on a commit it has verified in the same run. Run via `pnpm dev:helpers:release`.
//
// Usage:
//   pnpm dev:helpers:release              release from the tip of main
//   pnpm dev:helpers:release --approve    same, and approve the release gate as the gh user
//   pnpm dev:helpers:release --tag 1.2.3  republish an existing tag
//
// --approve answers the `release` environment's required-reviewer prompt from
// here, through the same API the Actions UI button calls, so the run needs no
// click. It only works when the gh user is one of the environment's reviewers;
// otherwise GitHub refuses and the run keeps waiting in the UI.

import { spawnSync } from "node:child_process";

const WORKFLOW = "pipeline.yml";
const GH_MISSING =
  "gh is not on PATH. Install it from https://cli.github.com, then run: gh auth login";
const GH_UNAUTHENTICATED = "gh is not authenticated for github.com. Run: gh auth login";

const die = (message) => {
  console.error(message);
  process.exit(1);
};

const gh = (args, { inherit = false, input } = {}) => {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: inherit ? "inherit" : [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error?.code === "ENOENT") die(GH_MISSING);
  if (result.error) die(`gh ${args[0]} failed: ${result.error.message}`);
  return result;
};

const USAGE = "Usage: pnpm dev:helpers:release [--approve | --tag <existing tag to republish>]";

const parseArgs = (argv) => {
  const options = { tag: undefined, approve: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--approve") {
      options.approve = true;
    } else if (arg.startsWith("--tag=")) {
      options.tag = arg.slice("--tag=".length);
    } else if (arg === "--tag" && i + 1 < argv.length) {
      i += 1;
      options.tag = argv[i];
    } else {
      die(USAGE);
    }
  }
  // A republish is never gated, so there is nothing for --approve to answer.
  if (options.approve && options.tag !== undefined) die(USAGE);
  return options;
};

// The same grammar the workflow enforces (and scripts/bump-plugin-version.mjs
// writes), so a typo is refused here rather than three minutes into a run.
const IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const TAG = new RegExp(
  String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-${IDENTIFIER}(?:\.${IDENTIFIER})*)?$`,
);

const { tag, approve } = parseArgs(process.argv.slice(2));
if (tag !== undefined && !TAG.test(tag)) {
  die(`"${tag}" is not a plain semver tag (e.g. 1.2.3). The pipeline would refuse it.`);
}

gh(["--version"]);
if (gh(["auth", "status", "--hostname", "github.com"]).status !== 0) die(GH_UNAUTHENTICATED);

const me = gh(["api", "user", "--jq", ".login"]);
if (me.status !== 0) die(GH_UNAUTHENTICATED);
const login = me.stdout.trim();

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
    "databaseId,url",
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

// The gate is a pending deployment on the run. It appears once the plan job has
// found something to release, and never appears when there is nothing, so the
// wait ends either way: on the prompt, or on the run finishing without one.
const approveGate = async (runId) => {
  const runsApi = `repos/{owner}/{repo}/actions/runs/${runId}`;
  for (;;) {
    const pending = gh(["api", `${runsApi}/pending_deployments`]);
    const gates = pending.status === 0 ? JSON.parse(pending.stdout) : [];
    const gate = gates.find((item) => item.environment?.name === "release");
    if (gate) {
      const posted = gh(
        ["api", "--method", "POST", `${runsApi}/pending_deployments`, "--input", "-"],
        {
          input: JSON.stringify({
            environment_ids: [gate.environment.id],
            state: "approved",
            comment: `Approved by ${login} through pnpm dev:helpers:release --approve`,
          }),
        },
      );
      if (posted.status !== 0) {
        die(
          `GitHub refused the approval as ${login}. The run keeps waiting in the Actions UI.\n${posted.stderr.trim()}`,
        );
      }
      console.log(`Approved the release gate as ${login}.`);
      return;
    }
    const view = gh(["run", "view", String(runId), "--json", "status"]);
    if (view.status === 0 && JSON.parse(view.stdout).status === "completed") return;
    await sleep(5000);
  }
};

if (approve) {
  console.log("Waiting for the release gate, to approve it from here.");
  await approveGate(dispatched.databaseId);
} else {
  console.log(
    tag === undefined
      ? "Watching. The run pauses for your approval in the Actions UI before it releases."
      : "Watching. A republish is not approved again; it runs straight through.",
  );
}

const watched = gh(["run", "watch", String(dispatched.databaseId), "--exit-status"], {
  inherit: true,
});
process.exit(watched.status ?? 1);
