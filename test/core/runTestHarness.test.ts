import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Pins for the test RUNNER's own contract (2026-11-03), the two halves of
// tools/run-test.mjs that made a partial run read as a full one:
//
// 1. The request file it writes for an entry must not outlive the run. The
//    runner used to `process.exit()` INSIDE the try block that owns the
//    `finally { clearRequest() }`, which skips the finally entirely -- the file
//    stayed behind with the dead run's ports on it, and a direct-run suite
//    started within the reader's 30s window inherited them (see
//    test/core/requestOwnership.test.ts for the reader half and the measured
//    ECONNREFUSED that produced).
// 2. `all` must say which suites it did not run. A red entry ended the chain
//    with nothing but that entry's own output: measured 2026-11-03 on main, a
//    red `settlers` stopped test:all and towncenter, visual and `npm run
//    test:unit` silently never ran, so the missing work was invisible.
//
// The runner is exercised through its real entry point rather than by reading
// its source: `--dry-run` walks every line of the write/clear/report path with
// no suite and no server, and `--fail-at=<entry>` (dry-run only) is the
// harness self-test that makes the not-run reporting reachable in a unit test
// instead of after a 20-minute chain.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REQUEST_PATH = join(ROOT, "local", ".test-request.json");

// The runner is spawned for real (its exit path and its report are what these
// pins are about), but the same invocation is not worth paying for twice: each
// spawn re-allocates the worktree's ports through scripts/allocate-ports.ts.
const runs = new Map<string, { status: number | null; output: string }>();

function runRunner(args: string[]): { status: number | null; output: string } {
  const key = args.join(" ");
  const cached = runs.get(key);
  if (cached) return cached;
  const r = spawnSync(process.execPath, ["--no-deprecation", "tools/run-test.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  const result = { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  runs.set(key, result);
  return result;
}

/** The entries the runner planned, in its own order, read off its own plan lines. */
function plannedEntries(output: string): string[] {
  return [...output.matchAll(/>> \[dry-run\] (\S+) ->/g)].map((m) => m[1]);
}

function removeRequestFile(): void {
  if (existsSync(REQUEST_PATH)) unlinkSync(REQUEST_PATH);
}

test("a run leaves no request file behind for the next one to inherit", () => {
  removeRequestFile();
  const all = runRunner(["all", "--dry-run"]);
  assert.equal(all.status, 0, `dry run of 'all' should exit 0, output:\n${all.output}`);
  assert.equal(existsSync(REQUEST_PATH), false, "`all` left local/.test-request.json behind with its dead ports on it");

  const single = runRunner(["cityview", "--dry-run"]);
  assert.equal(single.status, 0, `dry run of one entry should exit 0, output:\n${single.output}`);
  assert.equal(existsSync(REQUEST_PATH), false, "a single-entry run left local/.test-request.json behind");
});

test("a run that goes red does not leave its request file behind either", () => {
  removeRequestFile();
  const failed = runRunner(["all", "--dry-run", "--stop-on-fail", "--fail-at=cityview"]);
  assert.equal(failed.status, 1, `the simulated failure must exit non-zero, output:\n${failed.output}`);
  assert.equal(existsSync(REQUEST_PATH), false, "the failing exit path left local/.test-request.json behind");
});

test("a full run names every suite and reports nothing as not run", () => {
  const all = runRunner(["all", "--dry-run"]);
  const planned = plannedEntries(all.output);
  assert.ok(planned.length >= 17, `expected the whole chain in the plan, got ${planned.join(", ")}`);
  for (const entry of planned) {
    assert.match(all.output, new RegExp(`>> \\[all\\] verdict: ${entry} PASS`), `${entry} has no verdict line`);
  }
  assert.match(all.output, />> \[all\] \d+ passed, 0 failed, 0 did not run/);
  assert.match(all.output, />> \[all\] DID NOT RUN: \(none\)/);
});

test("when a suite fails, the run SAYS which suites did not run", () => {
  // The order comes from the runner's own plan of a FULL dry run, so this pin
  // cannot drift from ALL_ORDER by keeping a second copy of it here.
  const planned = plannedEntries(runRunner(["all", "--dry-run"]).output);
  const all = runRunner(["all", "--dry-run", "--stop-on-fail", "--fail-at=cityview"]);
  const failedAt = planned.indexOf("cityview");
  assert.notEqual(failedAt, -1, `cityview is not in the plan: ${planned.join(", ")}`);
  const expectedNotRun = planned.slice(failedAt + 1);
  assert.ok(expectedNotRun.length > 0, "this pin needs entries after cityview");

  assert.match(all.output, />> \[all\] verdict: cityview FAIL \(/);
  const notRunLine = all.output.match(/>> \[all\] DID NOT RUN: (.+)/);
  assert.ok(notRunLine, `no DID NOT RUN line in:\n${all.output}`);
  assert.equal(
    notRunLine[1].trim(),
    expectedNotRun.join(", "),
    "the not-run line must name exactly the suites the failure skipped, in chain order",
  );
  for (const entry of expectedNotRun) {
    assert.match(all.output, new RegExp(`>> \\[all\\] verdict: ${entry} DID NOT RUN`), `${entry} is not marked DID NOT RUN`);
  }
  assert.match(all.output, /do not read this run as a full pass/);
  assert.match(all.output, /test:unit did NOT run/);
});
