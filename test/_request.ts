import { spawn, execSync } from "node:child_process";
import { connect } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const ROOT = process.cwd();
const REQUEST_PATH = resolve(ROOT, "local", ".test-request.json");
const PID_REGISTRY_PATH = resolve(ROOT, "test", ".last-test-pids.json");
const IS_WINDOWS = process.platform === "win32";

export interface TestRequest {
  runId: string;
  entry: "smoke" | "multiplayer" | "cityview" | "settlements" | "aiDefender" | "visual" | "logpanel";
  apiPort: number;
  clientPort: number;
  autoClose: boolean;
  shutdownAfterMs: number | null;
  extra?: Record<string, unknown>;
}

export function loadRequest(): TestRequest | null {
  if (!existsSync(REQUEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REQUEST_PATH, "utf8")) as TestRequest;
  } catch {
    return null;
  }
}

export function getApiPort(fallback = 4000): number {
  return loadRequest()?.apiPort ?? Number(process.env.API_PORT ?? fallback);
}

export function getClientPort(fallback = 5173): number {
  return loadRequest()?.clientPort ?? Number(process.env.CLIENT_PORT ?? fallback);
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
    try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); return; } catch {}
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
  const resolved = IS_WINDOWS && cmd === "npx" ? "npx.cmd" : cmd;
  const child = spawn(resolved, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    shell: true,
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
