#!/usr/bin/env node
// Starts a release from a developer machine without being able to cut one:
// it dispatches .github/workflows/pipeline.yml on main and then watches that
// run. Nothing is bumped, tagged or pushed locally — the runner does all of it,
// on a commit it has verified in the same run. Run via `pnpm dev:helpers:release`.
//
// Usage:
//   pnpm dev:helpers:release              release from the tip of main
//   pnpm dev:helpers:release --tag 1.2.3  republish an existing tag

import { spawnSync } from "node:child_process";

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

const parseTag = (argv) => {
  if (argv.length === 0) return undefined;
  const [first, second] = argv;
  if (first.startsWith("--tag=")) {
    if (argv.length === 1) return first.slice("--tag=".length);
  } else if (first === "--tag" && argv.length === 2) {
    return second;
  }
  die("Usage: pnpm dev:helpers:release [--tag <existing tag to republish>]");
};

const tag = parseTag(process.argv.slice(2));
if (tag !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
  die(`"${tag}" is not a plain semver tag (e.g. 1.2.3). The pipeline would refuse it.`);
}

gh(["--version"]);
if (gh(["auth", "status", "--hostname", "github.com"]).status !== 0) die(GH_UNAUTHENTICATED);

// Runs dispatched before this moment belong to someone else.
const dispatchedAt = Date.now();

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
  const listed = gh([
    "run",
    "list",
    "--workflow",
    WORKFLOW,
    "--branch",
    "main",
    "--event",
    "workflow_dispatch",
    "--limit",
    "10",
    "--json",
    "databaseId,createdAt,url",
  ]);
  if (listed.status !== 0) return undefined;
  const runs = JSON.parse(listed.stdout);
  // A second of slack: the runner's clock is not this machine's.
  return runs.find((candidate) => Date.parse(candidate.createdAt) >= dispatchedAt - 1000);
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
console.log("Watching. The run pauses for your approval in the Actions UI before it releases.");

const watched = gh(["run", "watch", String(dispatched.databaseId), "--exit-status"], {
  inherit: true,
});
process.exit(watched.status ?? 1);
