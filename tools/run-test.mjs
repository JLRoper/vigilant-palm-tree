import { spawn, spawnSync } from "node:child_process";
import { connect, createServer } from "node:net";
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { nodeToolCommand, toolEntry } from "./resolve-tool-entry.mjs";

const ROOT = process.cwd();
const LOCAL_DIR = resolve(ROOT, "local");
const REQUEST_PATH = resolve(LOCAL_DIR, ".test-request.json");
// Children are started shell-free (see tools/resolve-tool-entry.mjs): a
// `shell: true` child on Windows runs through cmd.exe, which allocates a
// visible console window when it does not inherit one, and that window takes
// the foreground with it.
const TSX = nodeToolCommand("tsx");

// The request file is written FOR ONE CHILD and read by that child at import
// time. It used to be identified by mtime alone (test/_request.ts's 30s
// window), which meant a DIRECT-run suite (`npm run test:cityview`,
// test:settlements, test:resourcePickup) started within 30s of a wrapper entry
// inherited the DEAD run's ports: measured 2026-11-03, `npm run test:settlements`
// brought its API up on the previous run's 65020 while vite proxied .env's
// 56776, so every page fetch died with ECONNREFUSED and the suite looked red
// for an environmental reason. The token below is handed to this run's child
// through the environment, so a file that was not written for THIS process is
// ignored no matter how fresh it is.
const REQUEST_TOKEN_ENV = "HEROES_TEST_REQUEST_TOKEN";
const REQUEST_TOKEN = randomBytes(12).toString("hex");

// Test-run environment files, applied to the child in this order and BEFORE
// this shell's own environment -- a variable already exported here still wins,
// which is the same precedence `node --env-file` gives it.
//
//   .env.test        tracked. Pins Postgres back to the local docker-compose
//                    container; the suites delete games, so they must never
//                    follow a `.env` that points at the gameserver (its own
//                    header explains that at length).
//   .env.test.local  gitignored, per box. THIS checkout's test overrides --
//                    above all PGDATABASE=game_play_<hex>, so a suite run from
//                    the PRIMARY checkout cannot wipe the games the deployed
//                    stack is serving while the reader is playing on them.
//
// Until this existed the wrapper handed its entry NO env file at all, so
// PGDATABASE resolved by falling through to server/persistence/db.ts's
// `game_poc` default -- which is the shared database both the dev stack and
// the DEPLOYED stack read. Measured 2026-11-03: a browser suite run from the
// primary resolves its database that way with no export and no file.
const TEST_ENV_FILES = [".env.test", ".env.test.local"];

function readEnvVarsFrom(name) {
  const out = {};
  try {
    // Split on \n alone: a trailing CR is absorbed by the regexes below.
    for (const line of readFileSync(resolve(ROOT, name), "utf8").split("\n")) {
      if (/^\s*(#|$)/.test(line)) continue;
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Absent is the normal case for the local file.
  }
  return out;
}

// Where PGDATABASE came from, so the run's own log says which database it is
// about to delete games from instead of leaving it to be discovered.
function describeDatabaseSource(env) {
  if (process.env.PGDATABASE) return "this shell's environment";
  for (const name of [...TEST_ENV_FILES].reverse()) {
    const vars = readEnvVarsFrom(name);
    if (vars.PGDATABASE) return name;
  }
  if (env.PGDATABASE) return "an env file";
  return "server/persistence/db.ts default";
}


const ENTRIES = {
  smoke: "test/smoke.ts",
  multiplayer: "test/multiplayer.smoke.ts",
  cityview: "test/cityView.test.ts",
  cityGridTurnover: "test/cityGridTurnover.e2e.ts",
  newGameForm: "test/newGameFormViewport.e2e.ts",
  settlements: "test/settlements.e2e.ts",
  districts: "test/districts.e2e.ts",
  aiDefender: "test/aiDefender.e2e.ts",
  aiCharter: "test/aiCharter.e2e.ts",
  logisticsCaravan: "test/logisticsCaravanFollowsHero.e2e.ts",
  logpanel: "test/logPanel.browser.test.ts",
  uncharted: "test/unchartedMode.e2e.ts",
  heroVariants: "test/heroVariants.e2e.ts",
  heroTrade: "test/heroTrade.e2e.ts",
  resourcePickup: "test/resourcePickup.e2e.ts",
  settlers: "test/settlers.e2e.ts",
  towncenter: "test/townCenterSprite.e2e.ts",
  visual: "test/visualRegression.test.ts",
};

// "visual" runs last -- it's the slowest suite (several game setups, each
// spinning up its own scene) and gains nothing from running earlier.
const ALL_ORDER = ["smoke", "multiplayer", "cityview", "cityGridTurnover", "newGameForm", "settlements", "districts", "aiDefender", "aiCharter", "logisticsCaravan", "logpanel", "uncharted", "heroVariants", "heroTrade", "resourcePickup", "settlers", "towncenter", "visual"];

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
    token: REQUEST_TOKEN,
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

// The request file must not outlive the run that wrote it. Every exit path is
// covered: `exit` fires for a normal return, an unhandled throw and an explicit
// process.exit (which is why the exit code below is applied with
// process.exitCode + an explicit exit AFTER the try/finally, and never with
// process.exit inside it -- process.exit inside the try used to skip the
// finally, and the file was left behind with the dead run's ports on it).
function installRequestCleanup() {
  process.on("exit", clearRequest);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      clearRequest();
      process.exit(130);
    });
  }
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

  const fileEnv = TEST_ENV_FILES.reduce((acc, name) => ({ ...acc, ...readEnvVarsFrom(name) }), {});
  const childEnv = {
    ...fileEnv,
    ...process.env,
    ...req,
    [REQUEST_TOKEN_ENV]: REQUEST_TOKEN,
    API_PORT: String(req.apiPort),
    CLIENT_PORT: String(req.clientPort),
    NODE_NO_WARNINGS: "1",
  };
  const dbSource = describeDatabaseSource(childEnv);
  console.log(`>> [${entry}] PGDATABASE=${childEnv.PGDATABASE ?? "(unset -> db.ts default)"} (from ${dbSource})`);
  if (childEnv.PGDATABASE === "game_poc") {
    console.log(
      `>> [${entry}] WARNING: game_poc is the SHARED database -- the dev stack and the DEPLOYED stack ` +
        `both read it, and these suites delete games. Put PGDATABASE=game_play_<hex> in ${TEST_ENV_FILES[1]} ` +
        `(gitignored) or export it, to aim this run at a database of its own.`,
    );
  }

  return await new Promise((resolveRun, rejectRun) => {
    // Uppercase passthrough: vite.config.ts reads API_PORT from the process
    // environment (loadEnv gives process.env precedence over .env), so the
    // dev-server proxy must target THIS entry's ephemeral API port, not the
    // .env value some other environment may hold.
    // REQUEST_TOKEN_ENV is what makes the request file above belong to THIS
    // child: test/_request.ts honours the file only when it carries the token
    // this process was handed, so a leftover from a dead run is ignored.
    const child = spawn(TSX.cmd, [...TSX.args, tsFile], {
      cwd: ROOT,
      stdio: "inherit",
      env: childEnv,
      windowsHide: true,
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

// Prints the run's whole verdict, including what did NOT run. `npm run test:all`
// used to abort at the first red entry with nothing but the failing entry's own
// output, so a partial pass read as a full one: measured 2026-11-03, a red
// `settlers` entry ended the chain and towncenter + visual + `npm run test:unit`
// silently never ran.
function printReport(suiteLabel, results, opts) {
  const failed = results.filter((r) => r.status === "fail");
  const notRun = results.filter((r) => r.status === "notRun");
  console.log(`\n===== ${suiteLabel} report =====`);
  for (const r of results) {
    const verdict = r.status === "pass" ? "PASS" : r.status === "fail" ? `FAIL (${r.detail})` : "DID NOT RUN";
    console.log(`>> [${suiteLabel}] verdict: ${r.entry} ${verdict}`);
  }
  console.log(
    `>> [${suiteLabel}] ${results.filter((r) => r.status === "pass").length} passed, ` +
      `${failed.length} failed, ${notRun.length} did not run`,
  );
  console.log(`>> [${suiteLabel}] DID NOT RUN: ${notRun.length === 0 ? "(none)" : notRun.map((r) => r.entry).join(", ")}`);
  if (notRun.length > 0) {
    console.log(
      `>> [${suiteLabel}] those ${notRun.length} entr${notRun.length === 1 ? "y" : "ies"} were NOT verified by this run: ` +
        `do not read this run as a full pass.`,
    );
  }
  if (opts.chainAfterAll && (failed.length > 0 || notRun.length > 0)) {
    console.log(
      `>> [${suiteLabel}] \`npm run test:all\` chains \`npm run test:unit\` after this runner and tests stop at its ` +
        `non-zero exit: test:unit did NOT run.`,
    );
  }
}

// Writes the request file exactly as runOne does and leaves the last one in
// place: a real run's file is cleared by the RUNNER's exit path, never by the
// entry, so the dry run must exercise that same path (a per-entry clear here
// would hide a runner that fails to clean up after itself).
async function dryRunAll(entries, opts) {
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const ports = await allocatePorts();
    const req = writeRequest(entry, ports, opts);
    console.log(`>> [dry-run] ${entry} -> ${ENTRIES[entry]} api=${req.apiPort} client=${req.clientPort} request @ ${REQUEST_PATH}`);
    if (opts.failAt && entry === opts.failAt) {
      results.push({ entry, status: "fail", detail: "exited code=1 signal=null (--fail-at)" });
      if (opts.stopOnFail) {
        for (const rest of entries.slice(i + 1)) results.push({ entry: rest, status: "notRun" });
        break;
      }
      continue;
    }
    results.push({ entry, status: "pass" });
  }
  printReport(opts.suiteLabel, results, opts);
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node tools/run-test.mjs <smoke|multiplayer|cityview|settlements|districts|logpanel|logisticsCaravan|uncharted|heroVariants|heroTrade|resourcePickup|settlers|towncenter|visual|aiCharter|all> [--auto-close] [--shutdown-after-ms=N] [--update-baselines] [--stop-on-fail] [--dry-run] [--fail-at=<entry>]");
    return 2;
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
    stopOnFail: args.includes("--stop-on-fail"),
    dryRun: args.includes("--dry-run"),
    failAt: (() => {
      const a = args.find((x) => x.startsWith("--fail-at="));
      return a ? a.split("=")[1] : null;
    })(),
    suiteLabel: cmd,
    chainAfterAll: cmd === "all",
  };

  installRequestCleanup();
  // Start clean: whatever wrote the file before this process is not this run's.
  clearRequest();

  // Best-effort: allocate ports via the existing script so .env is fresh.
  try {
    spawnSync(process.execPath, [toolEntry("tsx"), "scripts/allocate-ports.ts"], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {}

  const entries = cmd === "all" ? ALL_ORDER : [cmd];
  if (cmd !== "all" && !ENTRIES[cmd]) {
    console.error(`>> run-test FAILED: unknown entry: ${cmd}`);
    return 2;
  }

  let code = 0;
  try {
    if (opts.dryRun) {
      code = await dryRunAll(entries, opts);
    } else if (cmd === "all") {
      const results = [];
      for (let i = 0; i < ALL_ORDER.length; i++) {
        const entry = ALL_ORDER[i];
        console.log(`\n===== ${entry} =====`);
        try {
          await runOne(entry, opts);
          results.push({ entry, status: "pass" });
        } catch (e) {
          results.push({ entry, status: "fail", detail: e?.message ?? String(e) });
          if (opts.stopOnFail) {
            for (const rest of ALL_ORDER.slice(i + 1)) results.push({ entry: rest, status: "notRun" });
            break;
          }
        }
      }
      printReport(cmd, results, opts);
      code = results.some((r) => r.status === "fail") ? 1 : 0;
    } else {
      const results = [];
      try {
        await runOne(cmd, opts);
        results.push({ entry: cmd, status: "pass" });
      } catch (e) {
        results.push({ entry: cmd, status: "fail", detail: e?.message ?? String(e) });
      }
      printReport(cmd, results, opts);
      code = results.some((r) => r.status === "fail") ? 1 : 0;
    }
  } catch (e) {
    console.error(">> run-test FAILED:", e?.message ?? e);
    code = 1;
  } finally {
    clearRequest();
  }

  console.log(code === 0 ? ">> run-test OK" : ">> run-test FAILED");
  return code;
}

main().then(
  (code) => {
    // Deliberately outside the try/finally above: process.exit() inside it
    // would skip the finally and leave the request file behind.
    process.exit(code);
  },
  (err) => {
    console.error(">> run-test FAILED:", err?.message ?? err);
    clearRequest();
    process.exit(1);
  },
);
