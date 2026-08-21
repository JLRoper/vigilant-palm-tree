import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const ROOT = process.cwd();
const REQUEST_PATH = resolve(ROOT, "local", ".test-request.json");
const PID_REGISTRY_PATH = resolve(ROOT, "test", ".last-test-pids.json");
const IS_WINDOWS = process.platform === "win32";

export interface TestRequest {
  runId: string;
  entry: "smoke" | "multiplayer" | "cityview" | "visual";
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

interface PidEntry { role: string; pid: number; spawnedAt: string; }
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
  reg.pids.push({ role, pid, spawnedAt: new Date().toISOString() });
  writeRegistry(reg);
}

export function clearRegisteredPids(): void {
  try {
    if (existsSync(PID_REGISTRY_PATH)) writeFileSync(PID_REGISTRY_PATH, JSON.stringify({ runId: "?", startedAt: new Date().toISOString(), pids: [] }, null, 2));
  } catch {}
}

export function reapPreviousRunPids(): void {
  const prev = readRegistry();
  let reaped = 0;
  for (const e of prev.pids) {
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

export const constants = { ROOT, REQUEST_PATH, PID_REGISTRY_PATH };
