// scripts/allocate-ports.ts
//
// OS-assigned port allocator. Cross-platform (Windows / Linux / macOS).
// Picks free TCP ports via net.Server({ port: 0 }) and writes them to .env
// in the current working directory. Idempotent and cheap; safe to run
// multiple times. Replaces scripts/ports.ps1 with no PowerShell dependency.
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

import { createServer, type Server } from "node:net";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ENV_FILE = join(process.cwd(), ".env");

const KEYS = ["API_PORT", "CLIENT_PORT", "WS_PORT"] as const;

function pickPort(): Promise<number> {
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
    const port = await pickPort();
    merged[key] = String(port);
    allocated[key] = port;
  }

  writeFileSync(
    ENV_FILE,
    Object.entries(merged)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    "utf8"
  );

  const branch = (() => {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    } catch {
      return "(detached)";
    }
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

main().catch((err) => {
  console.error("allocate-ports failed:", err);
  process.exit(1);
});
