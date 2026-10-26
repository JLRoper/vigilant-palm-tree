// scripts/allocate-ports.ts
//
// OS-assigned port allocator. Cross-platform (Windows / Linux / macOS).
// Picks free TCP ports via net.Server({ port: 0 }) and writes them to .env
// in the current working directory. Idempotent: re-running preserves
// existing .env values unless process.env overrides are set. Replaces
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
    console.log(`  ${key}=${merged[key]}`);
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
