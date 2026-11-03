import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { resolveNpxInvocation } from "../tools/resolve-tool-entry.mjs";

const ROOT = process.cwd();
const REQUEST_PATH = resolve(ROOT, "local", ".test-request.json");
const PID_REGISTRY_PATH = resolve(ROOT, "test", ".last-test-pids.json");
const IS_WINDOWS = process.platform === "win32";

/**
 * A request file belongs to ONE spawned child, and the only honest way to know
 * a file is ours is that the wrapper that wrote it handed us its token:
 * tools/run-test.mjs writes local/.test-request.json BEFORE spawning the entry
 * and passes the same token through HEROES_TEST_REQUEST_TOKEN, so a file that
 * does not carry this process's token was written for somebody else and is
 * ignored -- no matter how fresh it is. The old rule was mtime alone
 * (a 30-second window), which is exactly what made a DIRECT-run suite
 * (`npm run test:cityview`, test:settlements, test:resourcePickup) inherit a
 * DEAD wrapper run's ports: measured 2026-11-03, a wrapper entry that exited
 * after 15s left its file behind, a direct run started 13.7s later reported
 * `loadRequest -> HONOURED` and resolved api=57305/client=57306 while the
 * environment said 56776/56777, and `npm run test:settlements` then brought its
 * API up on 65020 while vite proxied .env's 56776 -- every page fetch died with
 * ECONNREFUSED and the suite read red for an environmental reason.
 *
 * A wrapper-driven entry ALWAYS has the token (it is set on the child's own
 * env), so nothing legitimate is lost. The mtime window stays as a backstop
 * against clock skew and slow startup, and must exceed tools/run-test.mjs's own
 * pre-spawn wait (waitForPortsReleased, up to 20s) so a wrapper-driven entry
 * never mistakes its own fresh request for an orphan.
 */
const REQUEST_MAX_AGE_MS = 30_000;

/** Set by tools/run-test.mjs on the child it wrote the request file for. */
export const REQUEST_TOKEN_ENV = "HEROES_TEST_REQUEST_TOKEN";

export interface TestRequest {
  runId: string;
  entry: "smoke" | "multiplayer" | "cityview" | "cityGridTurnover" | "newGameForm" | "settlements" | "districts" | "aiDefender" | "aiCharter" | "logisticsCaravan" | "uncharted" | "heroVariants" | "heroTrade" | "settlers" | "visual" | "logpanel";
  apiPort: number;
  clientPort: number;
  autoClose: boolean;
  shutdownAfterMs: number | null;
  extra?: Record<string, unknown>;
  /** The writing wrapper's token; see loadRequest's own note. */
  token?: string;
}

/** True only when `req` is the request THIS process was written for. */
export function requestIsOurs(req: TestRequest | null, env: Record<string, string | undefined> = process.env): boolean {
  const mine = env[REQUEST_TOKEN_ENV];
  return typeof mine === "string" && mine.length > 0 && req?.token === mine;
}

export function loadRequest(): TestRequest | null {
  if (!existsSync(REQUEST_PATH)) return null;
  try {
    const req = JSON.parse(readFileSync(REQUEST_PATH, "utf8")) as TestRequest;
    if (!requestIsOurs(req)) return null;
    if (Date.now() - statSync(REQUEST_PATH).mtimeMs > REQUEST_MAX_AGE_MS) return null;
    return req;
  } catch {
    return null;
  }
}

/**
 * The ports this box's DEPLOYED Docker stack answers on (`game_api` publishes
 * 3001, `game_web` publishes 5173). A suite that falls back to one of these is
 * not "reaching the dev server" -- it is driving a built image from some
 * earlier deploy, and for the web that means measuring an OLDER BUNDLE:
 * `game_web` answers /src/*.ts with text/html (the SPA fallback), so a browser
 * suite whose `vite --strictPort` lost the bind race silently asserts against
 * whatever the deployed app does (playthrough finding 22; the same class of
 * silent wrong-target run test/_envGuard.ts refuses for the by-hand entries).
 */
export const DEPLOYED_TEST_PORTS: Record<"API_PORT" | "CLIENT_PORT", number> = {
  API_PORT: 3001,
  CLIENT_PORT: 5173,
};

export interface PortSources {
  /** The wrapper's fresh `local/.test-request.json`, when there is one. */
  request: { apiPort: number; clientPort: number } | null;
  env: Record<string, string | undefined>;
}

export interface PortResolution {
  port: number;
  source: "request" | "env" | "fallback";
}

/**
 * Resolves ONE port, or refuses rather than guessing a shared target. Ports
 * may come from the wrapper's request file (for the run it is about to spawn --
 * the same precedence as before) or from the environment; the DEFAULT is
 * honoured only when it is not this box's deployed stack. Explicitly asking for
 * a deployed port (API_PORT=3001, CLIENT_PORT=5173) stays allowed: the problem
 * is the guess, not the target.
 */
export function resolveTestPort(
  variable: "API_PORT" | "CLIENT_PORT",
  fallback: number,
  sources: PortSources,
): PortResolution {
  if (sources.request) {
    return {
      port: variable === "API_PORT" ? sources.request.apiPort : sources.request.clientPort,
      source: "request",
    };
  }
  const raw = sources.env[variable];
  if (raw != null && raw.trim() !== "") {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(
        `${variable}="${raw}" is not a TCP port (1-65535). Refusing to run: a malformed port has no safe fallback.`,
      );
    }
    return { port: value, source: "env" };
  }
  if (fallback === DEPLOYED_TEST_PORTS[variable]) {
    throw new Error(
      [
        `${variable} is unset and this run would fall back to ${fallback} -- this box's DEPLOYED Docker stack.`,
        "Refusing: the run would drive a built image (the deployed web serves /src/*.ts as text/html, so a",
        "browser suite would measure an OLDER BUNDLE) instead of this worktree.",
        "",
        `Pass ${variable} explicitly (a free port; scripts/allocate-ports.ts writes .env for the npm scripts),`,
        `or ask for the deployed stack out loud with ${variable}=${fallback}.`,
      ].join("\n"),
    );
  }
  return { port: fallback, source: "fallback" };
}

export function getApiPort(fallback = 4000): number {
  return resolveTestPort("API_PORT", fallback, { request: loadRequest(), env: process.env }).port;
}

export function getClientPort(fallback = 5173): number {
  return resolveTestPort("CLIENT_PORT", fallback, { request: loadRequest(), env: process.env }).port;
}

export function shouldAutoClose(): boolean {
  const req = loadRequest();
  if (req) return req.autoClose;
  return process.argv.includes("--auto-close");
}

export function getShutdownAfterMs(): number | null {
  return loadRequest()?.shutdownAfterMs ?? null;
}

export function shouldUpdateBaselines(): boolean {
  const req = loadRequest();
  if (req) return req.extra?.updateBaselines === true;
  return process.argv.includes("--update-baselines");
}

interface PidEntry { role: string; pid: number; spawnedAt: string; runId?: string; }
interface PidRegistry { runId: string; startedAt: string; pids: PidEntry[]; }

function readRegistry(): PidRegistry {
  if (!existsSync(PID_REGISTRY_PATH)) {
    return { runId: "?", startedAt: new Date().toISOString(), pids: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(PID_REGISTRY_PATH, "utf8")) as PidRegistry;
    if (!parsed || !Array.isArray(parsed.pids)) {
      return { runId: "?", startedAt: new Date().toISOString(), pids: [] };
    }
    return parsed;
  } catch {
    return { runId: "?", startedAt: new Date().toISOString(), pids: [] };
  }
}

function writeRegistry(reg: PidRegistry): void {
  try { writeFileSync(PID_REGISTRY_PATH, JSON.stringify(reg, null, 2)); } catch {}
}

function treeKill(pid: number): void {
  if (IS_WINDOWS) {
    // execFileSync, not execSync: `exec` runs the command through cmd.exe,
    // and a cmd.exe that does not inherit a console allocates one (a visible
    // window). taskkill takes its arguments directly, so no shell is needed.
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
      return;
    } catch {}
  }
  try { process.kill(pid, "SIGKILL"); } catch {}
}

export { treeKill };

export function registerPid(role: string, pid: number): void {
  const reg = readRegistry();
  reg.pids = reg.pids.filter((p) => p.pid !== pid);
  reg.pids.push({ role, pid, spawnedAt: new Date().toISOString(), runId: loadRequest()?.runId });
  writeRegistry(reg);
}

export function clearRegisteredPids(): void {
  try {
    if (existsSync(PID_REGISTRY_PATH)) writeFileSync(PID_REGISTRY_PATH, JSON.stringify({ runId: "?", startedAt: new Date().toISOString(), pids: [] }, null, 2));
  } catch {}
}

/**
 * Kills pids registered by THIS wrapper run only (same boot-contract runId).
 * The registry file is shared across sessions on this worktree: reaping
 * every entry used to let a concurrently starting suite (or gate run)
 * taskkill another live suite's api/web servers mid-run -- observed as both
 * servers dying simultaneously ~9s after spawn with no in-process cause.
 * Entries from other runs are left alone; with per-entry ephemeral ports
 * (tools/run-test.mjs) their orphans hold a port nobody will reuse.
 */
export function reapPreviousRunPids(): void {
  const currentRunId = loadRequest()?.runId;
  const prev = readRegistry();
  let reaped = 0;
  for (const e of prev.pids) {
    if (currentRunId && e.runId !== currentRunId) continue;
    try { process.kill(e.pid, 0); treeKill(e.pid); reaped++; } catch {}
  }
  if (reaped > 0) console.log(`>> reaped ${reaped} leftover pid(s)`);
}

export function spawnLogged(
  label: string,
  cmd: string,
  args: string[],
  extraEnv: Record<string, string> = {}
) {
  // Three rules, all about Windows console windows:
  //
  // 1. No shell. A `shell: true` child is run by cmd.exe, and a cmd.exe
  //    started detached ALLOCATES a console of its own -- a visible window
  //    that also takes the foreground. `npx tsx ...` / `npx vite ...` are
  //    rewritten to `node <tool entry> ...` (tools/resolve-tool-entry.mjs) so
  //    no shell and no `npx.cmd` shim is involved at all. The shell path is
  //    kept only as a fallback for a command this helper cannot resolve.
  // 2. No `detached`. This is the option that was opening the windows:
  //    `detached` maps to DETACHED_PROCESS, which leaves the child with NO
  //    console, and Windows then ignores `windowsHide` (CREATE_NO_WINDOW is
  //    documented as ignored together with DETACHED_PROCESS). Measured on
  //    Windows 11 + node 24: `detached: true, windowsHide: true` still opened
  //    one console window per server, because the servers' own children (tsx's
  //    node child, esbuild's service process) were spawned with default
  //    options by a console-less parent and so each got a brand new console.
  //    Without `detached` the whole tree inherits the console the run started
  //    from (or gets none, when the run itself has none) and nothing appears.
  // 3. `windowsHide: true` everywhere anyway, for the shell fallback above.
  //
  // Clean shutdown does not need `detached`: teardown is by pid tree, not by
  // process group. Every pid is recorded with registerPid() and killed with
  // `taskkill /F /T /PID <pid>` (treeKill), which walks the parent/child chain
  // Windows recorded at creation and therefore reaches the grandchildren (tsx,
  // esbuild, vite) regardless of the process group they were started in.
  // Suites keep their own `finally` cleanup, so api and web still stop and
  // release their ports when a run finishes or fails.
  const shellFree = resolveNpxInvocation(cmd, args);
  const resolved = IS_WINDOWS && cmd === "npx" ? "npx.cmd" : cmd;
  const child = spawn(shellFree ? shellFree.cmd : resolved, shellFree ? shellFree.args : args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: !shellFree && (cmd === "npx" || cmd === "npx.cmd"),
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[${label}] ${d.toString()}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${label}-err] ${d.toString()}`));
  child.unref();
  if (child.pid != null) registerPid(label, child.pid);
  return child;
}

export async function waitForUrl(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
      lastErr = `${url} -> ${res.status}`;
    } catch (e) { lastErr = e; }
    await wait(300);
  }
  throw new Error(`server at ${url} did not respond within ${timeoutMs}ms (${String(lastErr)})`);
}

/**
 * Polls /api/health until it answers HTTP 200 on `requiredConsecutive`
 * probes spaced intervalMs apart -- stricter than waitForUrl, which accepts
 * any status < 500, and stricter than a single probe, which a force-killed
 * predecessor server can still satisfy during a chained run's port handoff.
 * Call before a browser suite's first page.goto: the page's own /api fetches
 * used to race the last moments of api/web boot and surface as benign
 * "Failed to fetch" console warnings.
 */
export async function waitForApiHealth(
  apiUrl: string,
  timeoutMs = 30_000,
  intervalMs = 200,
  requiredConsecutive = 2
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "never reached";
  let streak = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiUrl}/api/health`);
      if (res.status === 200) {
        streak += 1;
        if (streak >= requiredConsecutive) return;
        last = `200 (streak ${streak}/${requiredConsecutive})`;
        await wait(intervalMs);
        continue;
      }
      streak = 0;
      last = `status ${res.status}`;
    } catch (e) {
      streak = 0;
      last = String(e);
    }
    await wait(intervalMs);
  }
  throw new Error(
    `api health at ${apiUrl}/api/health never returned ${requiredConsecutive} consecutive 200s within ${timeoutMs}ms (${last})`
  );
}

/**
 * Resolves once a TCP connect to 127.0.0.1:port is REFUSED -- i.e. nothing
 * is listening. Browser suites run after the previous suite force-killed its
 * api/web on the SAME ports (allocate-ports preserves .env values), and a
 * still-dying predecessor can satisfy boot probes before its sockets are
 * released. Suite entries call this before spawning their own servers so a
 * probe can only ever be answered by the new process.
 */
export async function waitForPortReleased(port: number, timeoutMs = 20_000, intervalMs = 150): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "listening";
  while (Date.now() < deadline) {
    const refused = await new Promise<boolean>((resolveProbe) => {
      const sock = connect({ port, host: "127.0.0.1" });
      const done = (free: boolean) => {
        sock.destroy();
        resolveProbe(free);
      };
      sock.setTimeout(500);
      sock.once("connect", () => done(false));
      sock.once("timeout", () => done(false));
      sock.once("error", () => done(true));
    });
    if (refused) return;
    last = "listening";
    await wait(intervalMs);
  }
  throw new Error(
    `port ${port} still in use after ${timeoutMs}ms (${last}) -- a previous run's process may be orphaned; run \`npm run cleanup\` and retry`
  );
}

export const constants = { ROOT, REQUEST_PATH, PID_REGISTRY_PATH };
