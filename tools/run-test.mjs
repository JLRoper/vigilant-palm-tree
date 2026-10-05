import { spawn, spawnSync } from "node:child_process";
import { connect, createServer } from "node:net";
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const LOCAL_DIR = resolve(ROOT, "local");
const REQUEST_PATH = resolve(LOCAL_DIR, ".test-request.json");
const IS_WINDOWS = process.platform === "win32";
const NPX = IS_WINDOWS ? "npx.cmd" : "npx";

const ENTRIES = {
  smoke: "test/smoke.ts",
  multiplayer: "test/multiplayer.smoke.ts",
  cityview: "test/cityView.test.ts",
  settlements: "test/settlements.e2e.ts",
  aiDefender: "test/aiDefender.e2e.ts",
  logpanel: "test/logPanel.browser.test.ts",
  visual: "test/visualRegression.test.ts",
};

// "visual" runs last -- it's the slowest suite (several game setups, each
// spinning up its own scene) and gains nothing from running earlier.
const ALL_ORDER = ["smoke", "multiplayer", "cityview", "settlements", "aiDefender", "logpanel", "visual"];

function readEnvPort(name, fallback) {
  try {
    const env = readFileSync(ENV_PATH, "utf8");
    const m = env.match(new RegExp(`^${name}=(.+)`, "m"));
    if (m) return Number(m[1]);
  } catch {}
  return Number(process.env[name] ?? fallback);
}

// Fresh, kernel-picked ports per entry. The shared .env ports belong to the
// worktree's dev environment (and its port-scoped cleanup): reusing them made
// every browser suite race whatever else was bound -- on Windows both binds
// silently succeed (SO_REUSEADDR), boot probes get answered by whichever
// listener wins, and a dev restart or a concurrently starting suite kills the
// previous holder mid-run (observed as simultaneous api+web death and page
// fetches failing with "Failed to fetch"). Ephemeral ports make every
// collision impossible instead of retrying through it.
function pickFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.once("error", rejectPort);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr !== "object" || addr === null) {
        srv.close(() => rejectPort(new Error("could not read allocated port")));
        return;
      }
      srv.close(() => resolvePort(addr.port));
    });
  });
}

async function allocatePorts() {
  return {
    apiPort: await pickFreePort(),
    clientPort: await pickFreePort(),
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

// A chained `all` run reuses the same api/client ports for every entry
// (allocate-ports preserves .env values), and each entry's cleanup
// force-kills its predecessor's api/web with taskkill -- the socket release
// is not instantaneous, so the next entry can boot, probe, and get answers
// from the *dying* previous server while its own replacement fails to bind
// (vite --strictPort exits; the API dies on EADDRINUSE). The up-checks then
// pass against the old server, the page boots, and every /api fetch dies
// with "Failed to fetch". Refuse to spawn an entry until its ports actually
// refuse connections.
function portRefuses(port, timeoutMs = 500) {
  return new Promise((resolveProbe) => {
    const sock = connect({ port, host: "127.0.0.1" });
    const done = (free) => {
      sock.destroy();
      resolveProbe(free);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(false));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(true));
  });
}

async function waitForPortsReleased(ports, timeoutMs = 20_000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let busy = ports;
  while (Date.now() < deadline) {
    busy = [];
    for (const p of ports) {
      if (!(await portRefuses(p))) busy.push(p);
    }
    if (busy.length === 0) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `port(s) ${busy.join(", ")} still in use after ${timeoutMs}ms -- a previous run's api/web ` +
      `process is still holding them; run \`npm run cleanup\` and retry`,
  );
}

async function runOne(entry, opts) {
  const tsFile = ENTRIES[entry];
  if (!tsFile) throw new Error(`unknown entry: ${entry}`);

  const ports = await allocatePorts();
  const req = writeRequest(entry, ports, opts);
  await waitForPortsReleased([ports.apiPort, ports.clientPort]);
  console.log(`>> [${entry}] api=${ports.apiPort} client=${ports.clientPort} ports free`);
  console.log(`>> [${entry}] request @ ${REQUEST_PATH}`);
  console.log(`>> [${entry}] api=${req.apiPort} client=${req.clientPort} autoClose=${req.autoClose}`);

  return await new Promise((resolveRun, rejectRun) => {
    // Uppercase passthrough: vite.config.ts reads API_PORT from the process
    // environment (loadEnv gives process.env precedence over .env), so the
    // dev-server proxy must target THIS entry's ephemeral API port, not the
    // .env value some other environment may hold.
    const child = spawn(NPX, ["tsx", tsFile], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        ...req,
        API_PORT: String(req.apiPort),
        CLIENT_PORT: String(req.clientPort),
        NODE_NO_WARNINGS: "1",
      },
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
    console.error("usage: node tools/run-test.mjs <smoke|multiplayer|cityview|logpanel|visual|all> [--auto-close] [--shutdown-after-ms=N] [--update-baselines]");
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
    spawnSync(NPX, ["tsx", "scripts/allocate-ports.ts"], { cwd: ROOT, stdio: "inherit", shell: true });
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
