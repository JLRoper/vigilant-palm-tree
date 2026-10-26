import { writeSync } from "node:fs";
import { constants, loadRequest, type TestRequest } from "./_request";

/**
 * Fail-closed environment guard for the three by-hand entries that drive a
 * LIVE stack: test/probeCombatAdjudicate.ts, test/probeCombatPhantom.ts and
 * test/playthroughMovementCombat.e2e.ts.
 *
 * Why it exists: all three used to resolve their target with a fallback --
 * `Number(process.env.API_PORT) || getApiPort(3001)` and
 * `process.env.PGDATABASE ?? "game_play_bf69b3"`. On this box 3001/5173 are
 * the DEPLOYED Docker api and web, so running one of them without the
 * variables drove the deployed api and POSTed games into a live database
 * (observed: a probe created its game in game_poc). A fallback is only safe
 * when the fallback IS the intended target, which it never is here: these
 * entries always run against a per-worktree dev stack on per-worktree ports
 * and a per-worktree database.
 *
 * The rule: nothing is guessed. The ports may come from a fresh
 * local/.test-request.json (written by tools/run-test.mjs for the run it is
 * about to spawn -- the same precedence as getApiPort/getClientPort) or from
 * API_PORT/CLIENT_PORT in the environment; the database must come from
 * PGDATABASE. Anything missing refuses the run with a non-zero exit BEFORE
 * the first side effect -- no HTTP request, no Postgres connection, no dev
 * server spawned, no report written.
 */

/** The old fallbacks, named here so the refusal can quote exactly what it refuses to guess. */
export const REFUSED_DEFAULTS = {
  apiPort: "3001 (this box's Docker api -- the DEPLOYED stack)",
  clientPort: "5173 (this box's Docker web -- the DEPLOYED stack)",
  database: "game_play_bf69b3 (another worktree's playthrough database)",
} as const;

/** Explicitly asking for a deployed/shared target is allowed, but it is said out loud. */
const DEPLOYED_PORT_WARNINGS: Record<number, string> = {
  3001: "API_PORT=3001 is this box's Docker api (the DEPLOYED stack): the run will write into the deployed stack, not this worktree's dev stack.",
  5173: "CLIENT_PORT=5173 is this box's Docker web (the DEPLOYED stack): the run will drive the deployed client, not this worktree's dev client.",
};
const SHARED_DATABASE_WARNING =
  "PGDATABASE=game_poc is the SHARED dev database -- `npm test`/test/smoke.ts delete every game in it except their own fixtures.";

/** A malformed port has no fallback to refuse; say what shape is required instead. */
const MALFORMED_PORT_REFUSAL = "no default -- a TCP port (1-65535), an integer, is required";

/** Exit code for a refusal: 2, so it is never confused with a suite's own failure (1) or a skip (0). */
export const GUARD_EXIT_CODE = 2;

export interface RunTargets {
  apiPort: number;
  clientPort: number;
  database: string;
  portsFrom: "request" | "env";
}

export interface Refusal {
  variable: string;
  problem: string;
  refusedValue: string;
}

export interface TargetInspection {
  ok: boolean;
  targets: RunTargets | null;
  refusals: Refusal[];
  warnings: string[];
  requestPath: string;
  requestPresent: boolean;
}

export interface TargetInput {
  env: Record<string, string | undefined>;
  request: TestRequest | null;
}

function readPort(env: Record<string, string | undefined>, name: string): { value: number | null; problem: string | null } {
  const raw = env[name];
  if (raw == null || raw.trim() === "") return { value: null, problem: "unset (or empty)" };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return { value: null, problem: `"${raw}" is not a TCP port (1-65535)` };
  }
  return { value, problem: null };
}

function readDatabase(env: Record<string, string | undefined>): { value: string | null; problem: string | null } {
  const raw = env.PGDATABASE;
  if (raw == null || raw.trim() === "") return { value: null, problem: "unset (or empty)" };
  return { value: raw.trim(), problem: null };
}

/** Pure: reads the given env and request file only, touches nothing else. */
export function inspectRunTargets(input: TargetInput): TargetInspection {
  const refusals: Refusal[] = [];
  const warnings: string[] = [];

  const apiEnv = readPort(input.env, "API_PORT");
  const clientEnv = readPort(input.env, "CLIENT_PORT");
  let apiPort: number | null = null;
  let clientPort: number | null = null;
  let portsFrom: "request" | "env" = "env";

  if (input.request && Number.isInteger(input.request.apiPort) && Number.isInteger(input.request.clientPort)) {
    apiPort = input.request.apiPort;
    clientPort = input.request.clientPort;
    portsFrom = "request";
  } else {
    if (apiEnv.value == null) {
      refusals.push({
        variable: "API_PORT",
        problem: apiEnv.problem ?? "unset",
        refusedValue: apiEnv.problem?.includes("is not a TCP port") ? MALFORMED_PORT_REFUSAL : REFUSED_DEFAULTS.apiPort,
      });
    } else {
      apiPort = apiEnv.value;
      if (DEPLOYED_PORT_WARNINGS[apiEnv.value]) warnings.push(DEPLOYED_PORT_WARNINGS[apiEnv.value]);
    }
    if (clientEnv.value == null) {
      refusals.push({
        variable: "CLIENT_PORT",
        problem: clientEnv.problem ?? "unset",
        refusedValue: clientEnv.problem?.includes("is not a TCP port") ? MALFORMED_PORT_REFUSAL : REFUSED_DEFAULTS.clientPort,
      });
    } else {
      clientPort = clientEnv.value;
      if (DEPLOYED_PORT_WARNINGS[clientEnv.value]) warnings.push(DEPLOYED_PORT_WARNINGS[clientEnv.value]);
    }
  }

  const database = readDatabase(input.env);
  if (database.value == null) {
    refusals.push({ variable: "PGDATABASE", problem: database.problem ?? "unset", refusedValue: REFUSED_DEFAULTS.database });
  } else if (database.value === "game_poc") {
    warnings.push(SHARED_DATABASE_WARNING);
  }

  const requestPresent = input.request != null;
  if (refusals.length > 0 || apiPort == null || clientPort == null || database.value == null) {
    return { ok: false, targets: null, refusals, warnings, requestPath: constants.REQUEST_PATH, requestPresent };
  }
  return {
    ok: true,
    targets: { apiPort, clientPort, database: database.value, portsFrom },
    refusals,
    warnings,
    requestPath: constants.REQUEST_PATH,
    requestPresent,
  };
}

/** The refusal text, kept pure so a test can pin what a human reads. */
export function formatRefusal(entry: string, report: TargetInspection): string {
  const lines: string[] = [];
  lines.push(`${entry}: REFUSING TO RUN -- the environment is not explicit.`);
  lines.push("");
  lines.push("Not set, and NOT guessed (each of these old fallbacks targets something shared):");
  for (const r of report.refusals) lines.push(`  ${r.variable.padEnd(12)} ${r.problem} -- would have used ${r.refusedValue}`);
  lines.push("");
  if (!report.requestPresent) {
    lines.push(`No fresh request file at ${report.requestPath} either, so the ports cannot come from one.`);
    lines.push("");
  }
  lines.push("Pass them explicitly, e.g.");
  lines.push("  PLAYTHROUGH=1 API_PORT=<free port> CLIENT_PORT=<another free port> \\");
  lines.push("    PGDATABASE=game_poc_<branch-slug> npx tsx <this file>");
  lines.push("");
  lines.push("NOTHING HAS BEEN WRITTEN ANYWHERE: no HTTP request, no Postgres connection, no dev server, no report file.");
  lines.push("(This refusal is printed before the run's first side effect.)");
  return lines.join("\n");
}

/**
 * Resolves this run's targets or refuses to run. On refusal the message is
 * written synchronously (a piped stdout is not flushed by process.exit on
 * Windows) and the process exits 2.
 */
export function requireRunTargets(entry: string): RunTargets {
  const inspection = inspectRunTargets({ env: process.env, request: loadRequest() });
  if (!inspection.ok || inspection.targets == null) {
    writeSync(1, `${formatRefusal(entry, inspection)}\n`);
    process.exit(GUARD_EXIT_CODE);
  }
  for (const warning of inspection.warnings) console.log(`${entry}: WARNING -- ${warning}`);
  return inspection.targets;
}
