// scripts/allocate-ports.ts
//
// OS-assigned port allocator. Cross-platform (Windows / Linux / macOS).
// Picks free TCP ports via net.Server({ port: 0 }) and writes them to .env
// in the current working directory. Idempotent: re-running preserves
// existing .env values unless process.env overrides are set, or the existing
// value is one the OS REFUSES to bind (an excluded port range -- see
// probePort/classifyBindError below). Replaces
// scripts/ports.ps1 with no PowerShell dependency.
//
// Keys written:
//   API_PORT     - Express API (server/index.ts)
//   CLIENT_PORT  - Vite (dev + preview)
//   WS_PORT      - reserved for a future realtime layer
//
// Keys preserved from existing .env (e.g. LAN_HOST, PG* vars).
// Honors process-env overrides: if the port is already set in process.env,
// that value wins and no allocation happens for that key.
//
// Usage:
//   tsx scripts/allocate-ports.ts
//
// `pickPort`/`pickFreePorts` are exported for callers that need free ports
// WITHOUT a worktree .env: scripts/pods.ts asks for a pod's db/api/web host
// ports here rather than keeping a second allocator. Importing this module
// does NOT write any .env -- the writer only runs when this file is the
// entry point (see the guard at the bottom).

import { createServer, type Server } from "node:net";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { invokedDirectly } from "./lib/entry";

const ENV_FILE = join(process.cwd(), ".env");

const KEYS = ["API_PORT", "CLIENT_PORT", "WS_PORT"] as const;

// Asks the kernel for a free port on the loopback interface. Anything already
// bound -- including the shared stack's published 5432/3001/5173 -- is
// therefore never handed back, which is what keeps a pod off the shared
// stack's ports.
export function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        server.close();
        reject(new Error("could not read allocated port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

export async function pickFreePorts(count: number): Promise<number[]> {
  const picked = new Set<number>();
  let attempts = 0;
  while (picked.size < count) {
    if (attempts++ > count * 20) {
      throw new Error(`could not find ${count} distinct free TCP ports`);
    }
    picked.add(await pickPort());
  }
  return [...picked];
}

/**
 * Why a port could not be bound, as far as the allocator cares:
 *
 *   free     -- the bind succeeded, so the port is usable right now.
 *   in-use   -- EADDRINUSE: something is listening. That is usually THIS
 *               checkout's own dev server or a live suite, so the value is
 *               preserved: re-allocating would rotate the port out from under
 *               a running process and strand it (the exact failure the
 *               idempotency rule in main() exists to prevent).
 *   excluded -- EACCES/EPERM: the OS refused the bind outright. On Windows a
 *               port inside an excluded range answers exactly this
 *               (`netsh int ipv4 show excludedportrange protocol=tcp`; measured
 *               52000 -> `listen EACCES: permission denied 0.0.0.0:52000`).
 *               Nothing can ever bind it, and NOTHING ELSE WILL FREE IT, so a
 *               preserved value here is a permanent failure.
 *   unknown  -- any other error. Preserved, like in-use: not our call to make.
 */
export type PortProbe = "free" | "in-use" | "excluded" | "unknown";

/** Pure, so the classification can be pinned without an OS that excludes ports. */
export function classifyBindError(err: unknown): PortProbe {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM") return "excluded";
  if (code === "EADDRINUSE") return "in-use";
  return "unknown";
}

/**
 * Tries to actually bind `port` on the given host. A value the kernel hands out
 * is by construction bindable (Windows never allocates a port from an excluded
 * range), which is what makes a KERNEL-ASSIGNED port safe to keep and a
 * hand-pinned one not: the exclusion ranges are re-drawn at boot, so a value
 * that bound yesterday can be EACCES today (measured on this box: .env held
 * 54232/54233/54234 inside the then-current range 54144-54243, and the same
 * keys bound fine once re-allocated to 54711/54714/54715).
 */
export function probePort(port: number, host = "0.0.0.0"): Promise<PortProbe> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err) => resolve(classifyBindError(err)));
    server.listen(port, host, () => server.close(() => resolve("free")));
  });
}

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main(): Promise<void> {
  const existing = readEnvFile();
  const merged: Record<string, string> = { ...existing };
  const allocated: Record<string, number> = {};
  const reclaimed: Record<string, string> = {};

  for (const key of KEYS) {
    const override = process.env[key];
    if (override) {
      merged[key] = override;
      continue;
    }
    if (existing[key]) {
      // Preserve existing .env value. predev/pretest invoke this on every
      // run; re-allocating would silently rotate ports and strand orphan
      // processes on the previous values. Run `npm run cleanup` to free
      // stale ports before requesting a fresh allocation.
      //
      // One exception: a port the OS REFUSES to bind is not "in use", it is
      // unusable -- nothing can take it and nothing will free it, so keeping
      // it means every dev run and every suite dies on it. Measured on this
      // box, the primary checkout's .env held 54232/54233/54234 inside
      // Windows' then-current excluded range 54144-54243 and vite answered
      // `listen EACCES: permission denied 0.0.0.0:54233`. EADDRINUSE is left
      // alone: that is a live holder, usually this checkout's own dev server.
      const kept = Number(existing[key]);
      if (Number.isInteger(kept) && kept > 0 && kept <= 65535) {
        const probe = await probePort(kept);
        if (probe === "excluded") {
          const fresh = await pickPort();
          merged[key] = String(fresh);
          allocated[key] = fresh;
          reclaimed[key] = `${kept} (OS refused the bind: excluded port range) -> ${fresh}`;
          continue;
        }
      }
      continue;
    }
    const port = await pickPort();
    merged[key] = String(port);
    allocated[key] = port;
  }

  const content =
    Object.entries(merged)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";

  // Only touch the file when the values actually changed. Vite watches .env
  // and restarts the dev server on every write; a test suite's pre-step used
  // to rewrite identical ports and bounce a live dev server each time.
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : null;
  if (current !== content) {
    writeFileSync(ENV_FILE, content, "utf8");
  }

  const branch = (() => {
    const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return r.status === 0 && r.stdout ? r.stdout.trim() : "(detached)";
  })();
  console.log(`Worktree: ${branch}  (${process.cwd()})`);
  for (const key of KEYS) {
    console.log(`  ${key}=${merged[key]}${reclaimed[key] ? `  (re-allocated: ${reclaimed[key]})` : ""}`);
  }
  if (Object.keys(allocated).length > 0) {
    const pairs = Object.entries(allocated).map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`  (allocated: ${pairs})`);
  }
}

if (invokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error("allocate-ports failed:", err);
    process.exit(1);
  });
}
