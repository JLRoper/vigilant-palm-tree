import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRefusal, inspectRunTargets, REFUSED_DEFAULTS, type TargetInput } from "../_envGuard";
import type { TestRequest } from "../_request";

// Pins for the fail-closed environment guard (test/_envGuard.ts).
//
// The guard is the acceptance criterion for the probe/driver safety brief: the
// three by-hand entries must refuse to run -- non-zero, before any side effect
// -- when API_PORT / CLIENT_PORT / PGDATABASE are unset, instead of falling
// back to 3001/5173 (this box's DEPLOYED Docker stack) and game_play_bf69b3
// (another worktree's database). The runs that prove the refusal end to end
// are recorded in the PR; these pins cover the resolution rules cheaply, with
// no process, no file and no network.

const request = (apiPort: number, clientPort: number): TestRequest => ({
  runId: "test-run",
  // The probes are by-hand entries, so they are not in TestRequest["entry"]'s
  // union of wrapper-spawnable suites -- this fixture only exercises the ports.
  entry: "probeCombatAdjudicate" as TestRequest["entry"],
  apiPort,
  clientPort,
  autoClose: true,
  shutdownAfterMs: null,
});

const input = (env: Record<string, string | undefined>, req: TestRequest | null = null): TargetInput => ({ env, request: req });

test("unset ports and database: refuses, naming every variable and the fallback it refused", () => {
  const report = inspectRunTargets(input({}));
  assert.equal(report.ok, false);
  assert.equal(report.targets, null);
  assert.deepEqual(
    report.refusals.map((r) => r.variable),
    ["API_PORT", "CLIENT_PORT", "PGDATABASE"],
  );
  assert.deepEqual(
    report.refusals.map((r) => r.refusedValue),
    [REFUSED_DEFAULTS.apiPort, REFUSED_DEFAULTS.clientPort, REFUSED_DEFAULTS.database],
  );
  assert.match(REFUSED_DEFAULTS.apiPort, /^3001 /);
  assert.match(REFUSED_DEFAULTS.clientPort, /^5173 /);
  assert.match(REFUSED_DEFAULTS.database, /^game_play_bf69b3 /);
});

test("explicit ports do not excuse a missing PGDATABASE", () => {
  const report = inspectRunTargets(input({ API_PORT: "57601", CLIENT_PORT: "57602" }));
  assert.equal(report.ok, false);
  assert.deepEqual(report.refusals.map((r) => r.variable), ["PGDATABASE"]);
});

test("explicit ports and database resolve verbatim, from the environment", () => {
  const report = inspectRunTargets(input({ API_PORT: "57601", CLIENT_PORT: "57602", PGDATABASE: "game_poc_wtgui_probe_and_driver_safety_bcc7e0" }));
  assert.equal(report.ok, true);
  assert.deepEqual(report.targets, {
    apiPort: 57601,
    clientPort: 57602,
    database: "game_poc_wtgui_probe_and_driver_safety_bcc7e0",
    portsFrom: "env",
  });
  assert.deepEqual(report.refusals, []);
  assert.deepEqual(report.warnings, []);
});

test("empty strings count as unset, not as a value", () => {
  const report = inspectRunTargets(input({ API_PORT: "  ", CLIENT_PORT: "", PGDATABASE: "game_poc_x" }));
  assert.equal(report.ok, false);
  assert.deepEqual(report.refusals.map((r) => r.variable), ["API_PORT", "CLIENT_PORT"]);
});

test("a non-port value is refused as such rather than passed to fetch/pg", () => {
  const report = inspectRunTargets(input({ API_PORT: "5760a", CLIENT_PORT: "70000", PGDATABASE: "game_poc_x" }));
  assert.equal(report.ok, false);
  assert.deepEqual(report.refusals.map((r) => r.variable), ["API_PORT", "CLIENT_PORT"]);
  assert.match(report.refusals[0].problem, /is not a TCP port/);
  assert.match(report.refusals[0].refusedValue, /^no default/);
});

test("a fresh request file supplies the ports (run-test wrapper) and still needs PGDATABASE", () => {
  const withoutDb = inspectRunTargets(input({}, request(57611, 57612)));
  assert.equal(withoutDb.ok, false);
  assert.equal(withoutDb.requestPresent, true);
  assert.deepEqual(withoutDb.refusals.map((r) => r.variable), ["PGDATABASE"]);

  const withDb = inspectRunTargets(input({ PGDATABASE: "game_poc_x" }, request(57611, 57612)));
  assert.equal(withDb.ok, true);
  assert.deepEqual(withDb.targets, { apiPort: 57611, clientPort: 57612, database: "game_poc_x", portsFrom: "request" });
});

test("the request file keeps winning over the environment, as getApiPort/getClientPort do today", () => {
  const report = inspectRunTargets(input({ API_PORT: "57601", CLIENT_PORT: "57602", PGDATABASE: "game_poc_x" }, request(57611, 57612)));
  assert.equal(report.ok, true);
  assert.equal(report.targets?.apiPort, 57611);
  assert.equal(report.targets?.clientPort, 57612);
  assert.equal(report.targets?.portsFrom, "request");
});

test("explicitly asking for the deployed ports, or the shared database, is allowed but said out loud", () => {
  const report = inspectRunTargets(input({ API_PORT: "3001", CLIENT_PORT: "5173", PGDATABASE: "game_poc" }));
  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 3);
  assert.match(report.warnings[0], /DEPLOYED stack/);
  assert.match(report.warnings[2], /SHARED dev database/);
});

test("the refusal text names the variables, the refused values and that nothing was written", () => {
  const report = inspectRunTargets(input({}));
  const text = formatRefusal("probeCombatAdjudicate", report);
  assert.match(text, /probeCombatAdjudicate: REFUSING TO RUN/);
  for (const name of ["API_PORT", "CLIENT_PORT", "PGDATABASE"]) assert.match(text, new RegExp(name));
  assert.match(text, /3001 /);
  assert.match(text, /5173 /);
  assert.match(text, /game_play_bf69b3 /);
  assert.match(text, /No fresh request file at .*\.test-request\.json either/);
  assert.match(text, /NOTHING HAS BEEN WRITTEN ANYWHERE/);
});
