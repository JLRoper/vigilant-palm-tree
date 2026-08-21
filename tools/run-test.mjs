import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const LOCAL_DIR = resolve(ROOT, "local");
const REQUEST_PATH = resolve(LOCAL_DIR, ".test-request.json");
const ENV_PATH = resolve(ROOT, ".env");
const IS_WINDOWS = process.platform === "win32";
const NPX = IS_WINDOWS ? "npx.cmd" : "npx";

const ENTRIES = {
  smoke: "test/smoke.ts",
  multiplayer: "test/multiplayer.smoke.ts",
  cityview: "test/cityView.test.ts",
  visual: "test/visualRegression.test.ts",
};

// "visual" runs last -- it's the slowest suite (several game setups, each
// spinning up its own scene) and gains nothing from running earlier.
const ALL_ORDER = ["smoke", "multiplayer", "cityview", "visual"];

function readEnvPort(name, fallback) {
  try {
    const env = readFileSync(ENV_PATH, "utf8");
    const m = env.match(new RegExp(`^${name}=(.+)`, "m"));
    if (m) return Number(m[1]);
  } catch {}
  return Number(process.env[name] ?? fallback);
}

function allocatePorts() {
  return {
    apiPort: readEnvPort("API_PORT", 4000),
    clientPort: readEnvPort("CLIENT_PORT", 5173),
  };
}

function writeRequest(entry, ports, opts) {
  mkdirSync(LOCAL_DIR, { recursive: true });
  const payload = {
    runId: new Date().toISOString(),
    entry,
    apiPort: ports.apiPort,
    clientPort: ports.clientPort,
    autoClose: !!opts.autoClose,
    shutdownAfterMs: opts.shutdownAfterMs ?? null,
    extra: opts.extra ?? {},
  };
  writeFileSync(REQUEST_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function readRequest() {
  if (!existsSync(REQUEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REQUEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

function clearRequest() {
  try { if (existsSync(REQUEST_PATH)) unlinkSync(REQUEST_PATH); } catch {}
}

function runOne(entry, opts) {
  return new Promise((resolveRun, rejectRun) => {
    const tsFile = ENTRIES[entry];
    if (!tsFile) return rejectRun(new Error(`unknown entry: ${entry}`));

    const ports = allocatePorts();
    const req = writeRequest(entry, ports, opts);
    console.log(`>> [${entry}] request @ ${REQUEST_PATH}`);
    console.log(`>> [${entry}] api=${req.apiPort} client=${req.clientPort} autoClose=${req.autoClose}`);

    const child = spawn(NPX, ["tsx", tsFile], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...req, NODE_NO_WARNINGS: "1" },
      shell: true,
    });

    const killTimer = req.shutdownAfterMs
      ? setTimeout(() => {
          console.error(`>> [${entry}] shutdown ceiling reached`);
          try { child.kill("SIGKILL"); } catch {}
        }, req.shutdownAfterMs).unref()
      : null;

    child.on("exit", (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (code === 0) resolveRun();
      else rejectRun(new Error(`[${entry}] exited code=${code} signal=${signal}`));
    });
    child.on("error", (e) => rejectRun(e));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node tools/run-test.mjs <smoke|multiplayer|cityview|visual|all> [--auto-close] [--shutdown-after-ms=N] [--update-baselines]");
    process.exit(2);
  }

  const cmd = args[0];
  const opts = {
    autoClose: args.includes("--auto-close"),
    shutdownAfterMs: (() => {
      const a = args.find((x) => x.startsWith("--shutdown-after-ms="));
      return a ? Number(a.split("=")[1]) || null : null;
    })(),
    extra: {
      updateBaselines: args.includes("--update-baselines"),
    },
  };

  // Best-effort: allocate ports via the existing script so .env is fresh.
  try {
    spawn.sync(NPX, ["tsx", "scripts/allocate-ports.ts"], { cwd: ROOT, stdio: "inherit", shell: true });
  } catch {}

  try {
    if (cmd === "all") {
      for (const e of ALL_ORDER) {
        console.log(`\n===== ${e} =====`);
        await runOne(e, opts);
      }
    } else {
      await runOne(cmd, opts);
    }
    console.log(">> run-test OK");
    process.exit(0);
  } catch (e) {
    console.error(">> run-test FAILED:", e?.message ?? e);
    process.exit(1);
  } finally {
    clearRequest();
  }
}

main();
