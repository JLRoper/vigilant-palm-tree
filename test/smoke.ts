import { chromium, Browser, Page, request as pwRequest } from "playwright";
import { spawn, ChildProcess, execSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { existsSync, readFileSync, statSync, openSync, writeFileSync, promises as fsPromises } from "node:fs";
import assert from "node:assert/strict";
import { GameMap } from "../src/map/gameMap";
import { mulberry32 } from "../src/core/rng";
import { placeResourceTiles, RESOURCES } from "../src/map/resourceTiles";
import { axialToPixel } from "../src/core/hex";
import { Pool } from "pg";

const TERRAINS = new Set(["grass", "dirt", "forest", "desert", "mountain", "water"]);
const RESOURCE_SET = new Set(["gold", "wood", "stone", "iron", "arcane"]);

const WEB_PORT = Number(process.env.CLIENT_PORT) || 4173;
const API_PORT = Number(process.env.API_PORT) || 3001;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const GAME_NAME = "default";
const TEST_NEW_NAME = "smoke-new-game";
const PID_REGISTRY_PATH = "test/.last-test-pids.json";
const IS_WINDOWS = process.platform === "win32";

interface PidEntry {
  role: string;
  pid: number;
  spawnedAt: string;
}

interface PidRegistry {
  runId: string;
  startedAt: string;
  pids: PidEntry[];
}

function parseShutdownAfterSeconds(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--shutdownAfterSeconds="));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const SHUTDOWN_AFTER_MS = parseShutdownAfterSeconds();

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

function writeRegistry(registry: PidRegistry): void {
  try {
    writeFileSync(PID_REGISTRY_PATH, JSON.stringify(registry, null, 2));
  } catch (e) {
    console.error(`>> failed to write pid registry: ${e}`);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function treeKill(pid: number): void {
  if (IS_WINDOWS) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      return;
    } catch {
      // fall through to plain kill
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // best-effort
  }
}

function reapPreviousRunPids(): void {
  const prev = readRegistry();
  if (prev.pids.length === 0) return;
  let reaped = 0;
  for (const entry of prev.pids) {
    if (!isAlive(entry.pid)) continue;
    try {
      treeKill(entry.pid);
      reaped++;
      console.log(`>> reaped leftover ${entry.role} pid=${entry.pid} from previous run`);
    } catch {
      // best-effort
    }
  }
  if (reaped > 0) {
    console.log(`>> reaped ${reaped} leftover pid(s) from previous run`);
  }
}

function killSpawnedChild(extra: ChildProcess | undefined): void {
  if (!extra || extra.killed || extra.pid == null) return;
  try {
    extra.kill("SIGKILL");
  } catch {
    // best-effort
  }
}

function killBrowserTree(): void {
  try {
    const proc = browser?.process?.();
    if (proc && proc.pid != null) treeKill(proc.pid);
  } catch {
    // best-effort
  }
}

function registerPid(role: string, pid: number): void {
  const registry = readRegistry();
  registry.pids = registry.pids.filter((entry) => entry.pid !== pid);
  registry.pids.push({ role, pid, spawnedAt: new Date().toISOString() });
  writeRegistry(registry);
}

function clearRegisteredPids(): void {
  try {
    if (existsSync(PID_REGISTRY_PATH)) writeFileSync(PID_REGISTRY_PATH, "");
  } catch {
    // best-effort
  }
}

reapPreviousRunPids();
let PLAYER_SPAWN = { q: 6, r: 5 };
let AI_SPAWN = { q: 14, r: 8 };
let api: ChildProcess | undefined;
let web: ChildProcess | undefined;
let browser: Browser | undefined;

function runDeterminismChecks() {
  const m1 = new GameMap(42);
  const m2 = new GameMap(42);
  assert.deepEqual(m1.resourceTiles, m2.resourceTiles, "resourceTiles differ across same seed");
  const total = m1.resourceTiles.filter((t): t is NonNullable<typeof t> => Boolean(t)).length;
  assert(total > 35 && total < 85, `resource count out of band: ${total}`);
  const goldCount = m1.resourceTiles.filter((t) => t?.resource === "gold").length;
  assert(goldCount > 8 && goldCount < 30, `gold count out of band: ${goldCount}`);
  for (const res of RESOURCES) {
    const count = m1.resourceTiles.filter((t) => t?.resource === res).length;
    assert(count >= 0, `negative count for ${res}`);
  }
  const sample = placeResourceTiles(new GameMap(7), mulberry32(99));
  assert(sample.length > 0, "expected at least one resource tile on seed 7");
}

runDeterminismChecks();

async function pickClickTarget(
  api: {
    get(url: string): Promise<{
      ok(): boolean;
      status(): number;
      text(): Promise<string>;
      json(): Promise<unknown>;
    }>;
  },
  gameName: string,
  spawn: { q: number; r: number }
): Promise<{ x: number; y: number; tile: { q: number; r: number } }> {
  const res = await api.get(`${API_URL}/api/games/${gameName}/tiles`);
  if (!res.ok()) {
    const status = res.status();
    const body = await res.text().catch(() => "");
    throw new Error(
      `tiles endpoint returned ${status}: ${body.slice(0, 200)}`
    );
  }
  const tiles = (await res.json()) as Array<{
    q: number; r: number; terrain: string; resource: string | null;
  }>;
  const NEIGHBOR_DIRS = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ];
  for (const dir of [...NEIGHBOR_DIRS.map((d) => ({
    q: spawn.q + d.q, r: spawn.r + d.r,
  })), spawn]) {
    const t = tiles.find((x) => x.q === dir.q && x.r === dir.r);
    if (t && t.terrain !== "water" && t.terrain !== "mountain") {
      const { x, y } = axialToPixel(dir.q, dir.r);
      return { x, y, tile: { q: dir.q, r: dir.r } };
    }
  }
  throw new Error("no passable tile found at or adjacent to spawn");
}

async function runTilesEndpointChecks(
  api: {
    get(url: string): Promise<{
      ok(): boolean;
      status(): number;
      text(): Promise<string>;
      json(): Promise<unknown>;
    }>;
  },
  gameName: string
) {
  const res = await api.get(`${API_URL}/api/games/${gameName}/tiles`);
  if (!res.ok()) {
    const status = res.status();
    const body = await res.text().catch(() => "");
    throw new Error(
      `tiles endpoint returned ${status}: ${body.slice(0, 200)}`
    );
  }
  const tiles = (await res.json()) as Array<{
    q: number;
    r: number;
    terrain: string;
    resource: string | null;
  }>;
  assert.equal(tiles.length, 24 * 18, `expected ${24 * 18} tiles, got ${tiles.length}`);
  const seen = new Set<string>();
  for (const t of tiles) {
    assert(
      TERRAINS.has(t.terrain),
      `invalid terrain value at (${t.q},${t.r}): ${t.terrain}`
    );
    assert(
      t.resource === null || RESOURCE_SET.has(t.resource),
      `invalid resource value at (${t.q},${t.r}): ${t.resource}`
    );
    seen.add(`${t.q},${t.r}`);
  }
  assert.equal(
    seen.size,
    24 * 18,
    `expected ${24 * 18} unique (q,r) pairs, got ${seen.size}`
  );
  console.log(`>> tiles endpoint: ${tiles.length} rows, all enum values valid, full coverage`);
}

async function runNewLoadSaveFlow(
  page: Page,
  ctx: {
    get(url: string): Promise<{
      ok(): boolean;
      status(): number;
      text(): Promise<string>;
      json(): Promise<unknown>;
    }>;
    delete(url: string): Promise<unknown>;
    post(url: string, opts?: unknown): Promise<unknown>;
  },
  starterName: string,
  starterUpdatedAt: string
) {
  console.log(">> New/Load/Save flow");

  await ctx.delete(`${API_URL}/api/games/${TEST_NEW_NAME}`).catch(() => {});

  const menuBtn = page.locator("#toolbar button[title='Menu']");
  const newBtn = page.locator("#toolbar button", { hasText: "New" });
  await menuBtn.click();
  await newBtn.click();
  await wait(100);
  const nameInput = page.locator("input[type=text]").first();
  await nameInput.fill(TEST_NEW_NAME);
  const seedInput = page.locator("input[type=number]").first();
  await seedInput.fill("1234");
  const createBtn = page.locator("button", { hasText: "Create" });
  await createBtn.click();
  await wait(800);

  const activeAfterNew = await page.evaluate(() => (window as any).__gameDebug?.activeGameName);
  if (activeAfterNew !== TEST_NEW_NAME) {
    throw new Error(`New Game failed: activeGameName=${activeAfterNew}`);
  }
  console.log(`>> New Game active: ${activeAfterNew}`);

  const newGameRes = await ctx.get(`${API_URL}/api/games/${TEST_NEW_NAME}`);
  const newGameBody = (await newGameRes.json()) as { seed: number; turn: number; gold: number };
  if (newGameBody.seed !== 1234) {
    throw new Error(`Seed not honored: got ${newGameBody.seed}`);
  }
  if (newGameBody.turn !== 1 || newGameBody.gold !== 0) {
    throw new Error(`New game not reset: turn=${newGameBody.turn} gold=${newGameBody.gold}`);
  }
  console.log(`>> New Game DB row: seed=${newGameBody.seed} turn=${newGameBody.turn} gold=${newGameBody.gold}`);

  const saveBtn = page.locator("#toolbar button", { hasText: "Save" });
  await wait(200);
  await menuBtn.click();
  await saveBtn.click();
  await wait(500);
  const hudText = await page.locator("#hud").textContent();
  if (!hudText || !hudText.includes("Last saved")) {
    throw new Error(`HUD missing "Last saved": ${hudText}`);
  }
  console.log(">> HUD shows Last saved");

  const afterSaveRes = await ctx.get(`${API_URL}/api/games/${TEST_NEW_NAME}`);
  const afterSaveBody = (await afterSaveRes.json()) as { updated_at: string };
  if (afterSaveBody.updated_at <= starterUpdatedAt) {
    throw new Error(`Save did not advance updated_at: ${afterSaveBody.updated_at} <= ${starterUpdatedAt}`);
  }
  console.log(`>> Save advanced updated_at`);

  const loadBtn = page.locator("#toolbar button", { hasText: "Load" });
  await menuBtn.click();
  await loadBtn.click();
  await wait(500);
  const rows = page.locator("button", { hasText: "Open" });
  const rowCount = await rows.count();
  if (rowCount < 2) {
    throw new Error(`Load picker expected >=2 entries (starter + new), got ${rowCount}`);
  }
  console.log(`>> Load picker shows ${rowCount} games`);

  await page.locator("button", { hasText: "Forget" }).first().click();
  await wait(150);

  const openFor = starterName;
  const restore = await ctx.get(`${API_URL}/api/games/${openFor}`);
  if (!restore.ok()) throw new Error(`Starter game missing before re-load`);
  await page.locator(`button:has-text("Open")`).first().click();
  await wait(600);
  const reloadedName = await page.evaluate(() => (window as any).__gameDebug?.activeGameName);
  if (reloadedName !== openFor) {
    throw new Error(`Load failed: expected ${openFor}, got ${reloadedName}`);
  }
  console.log(`>> Load switched active to: ${reloadedName}`);

  await ctx.delete(`${API_URL}/api/games/${TEST_NEW_NAME}`).catch(() => {});
}

async function queryDbRow(name: string): Promise<{
  round: number;
  active_player_id: number;
  players: Array<{ id: number; faction: string; settlementIds?: string[]; heroIds?: string[] }>;
  heroes: Record<string, { id: string; ownerId: number; q: number; r: number; gold?: number }>;
  settlements: Record<string, { id: string; ownerId: number | null; population: number; goldTax: number; gold?: number }>;
}> {
  const pool = new Pool({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "gameuser",
    password: process.env.PGPASSWORD ?? "gamepass",
    database: process.env.PGDATABASE ?? "game_poc",
  });
  try {
    const r = await pool.query<{
      round: number;
      active_player_id: number;
      players: any[];
      heroes: Record<string, any>;
      settlements: Record<string, any>;
    }>(
      `SELECT round, active_player_id, players, heroes, settlements FROM games WHERE name = $1`,
      [name]
    );
    if (r.rowCount === 0) throw new Error(`game ${name} not found in DB`);
    const row = r.rows[0];
    return {
      round: row.round,
      active_player_id: row.active_player_id,
      players: row.players,
      heroes: row.heroes,
      settlements: row.settlements,
    };
  } finally {
    await pool.end();
  }
}

async function queryLastEvent(name: string): Promise<{ kind: string; payload: any } | null> {
  const pool = new Pool({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "gameuser",
    password: process.env.PGPASSWORD ?? "gamepass",
    database: process.env.PGDATABASE ?? "game_poc",
  });
  try {
    const r = await pool.query<{ kind: string; payload: any }>(
      `SELECT e.kind, e.payload
         FROM game_events e JOIN games g ON g.id = e.game_id
        WHERE g.name = $1
        ORDER BY e.id DESC LIMIT 1`,
      [name]
    );
    if (r.rowCount === 0) return null;
    return { kind: r.rows[0].kind, payload: r.rows[0].payload };
  } finally {
    await pool.end();
  }
}

async function isHumanTurn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const state = (window as any).__gameDebug?.getGameState?.();
    if (!state || state.phase?.kind !== "PLAYER_TURN") return false;
    const p = state.players?.find((pl: any) => pl.id === state.phase.playerId);
    return p?.faction === "player";
  });
}

// ... many unchanged helper functions omitted in this patch view for brevity ...
// (We will keep the rest of the file unchanged except the functions noted below.)

function ensureBuilt(): void {
  if (!existsSync("dist/index.html")) {
    throw new Error(
      "dist/index.html not found — run `npm run build` before the smoke test"
    );
  }
}

function runOnce(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function startApi(): ChildProcess {
  // Pipe stdout/stderr so logs appear in Actions in real-time with a prefix
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    env: { ...process.env, API_PORT: String(API_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    shell: true,
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[api] ${d.toString()}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[api-err] ${d.toString()}`));
  child.unref();
  if (child.pid != null) registerPid("api", child.pid);
  return child;
}

function startWeb(): ChildProcess {
  const child = spawn(
    "npx",
    ["vite", "preview", "--port", String(WEB_PORT), "--strictPort"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      shell: true,
    }
  );
  child.stdout?.on("data", (d) => process.stdout.write(`[web] ${d.toString()}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[web-err] ${d.toString()}`));
  child.unref();
  if (child.pid != null) registerPid("web", child.pid);
  return child;
}

async function waitForUrl(url: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
      // For 5xx responses, log a snippet of the body to help diagnostics
      const body = await res.text().catch(() => "<unable to read body>");
      console.error(`waitForUrl: ${url} returned ${res.status}. body: ${body.slice(0, 2000)}`);
    } catch {}
    await wait(500);
  }
  throw new Error(`server at ${url} did not respond`);
}

async function canReachDb(timeoutMs = 2000): Promise<boolean> {
  const net = await import("node:net");
  return new Promise<boolean>((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(
      Number(process.env.PGPORT ?? 5432),
      process.env.PGHOST ?? "localhost"
    );
  });
}

let logTailTimer: NodeJS.Timeout | null = null;
let apiLogPos = 0;
let webLogPos = 0;
function startLogTail(): void {
  logTailTimer = setInterval(() => {
    for (const [path, isApi] of [
      ["test/api.log", true],
      ["test/web.log", false],
    ] as const) {
      try {
        if (!existsSync(path)) continue;
        const stat = statSync(path);
        const pos = isApi ? apiLogPos : webLogPos;
        if (stat.size <= pos) continue;
        const buf = readFileSync(path, { encoding: "utf8", start: pos });
        const tag = isApi ? "[api]" : "[web]";
        process.stdout.write(`${tag} ${buf}`);
        if (isApi) apiLogPos = stat.size;
        else webLogPos = stat.size;
      } catch {}
    }
  }, 500);
  logTailTimer.unref();
}
function stopLogTail(): void {
  if (logTailTimer) {
    clearInterval(logTailTimer);
    logTailTimer = null;
  }
}

// ... rest of unchanged helpers and tests ...

async function run() {
  await ensureBuilt();
  api = startApi();
  web = startWeb();
  startLogTail();
  let failed = false;
  try {
    try {
      await waitForUrl(`${API_URL}/api/health`);
    } catch (err) {
      const dbReachable = await canReachDb().catch(() => false);
      if (!dbReachable) {
        console.error(
          ">> API never came up and Postgres on localhost:5432 is unreachable.\n" +
            ">> Hint: start the shared dev DB with `npm run db:up` (or `docker start game_db`),\n" +
            ">> then re-run `npm run test`."
        );
      }
      throw err;
    }
    await waitForUrl(WEB_URL);
    console.log(">> api + web up");

    const ctx = await pwRequest.newContext();
    const health = await ctx.get(`${API_URL}/api/health`);
    const healthBody = (await health.json());
    console.log(`>> api health: ${JSON.stringify(healthBody)}`);
    if (!(healthBody as any).ok) throw new Error("api health not ok");

    await ctx.delete(`${API_URL}/api/games/${GAME_NAME}`);
    console.log(`>> reset game '${GAME_NAME}'`);

    const allGamesRes = await ctx.get(`${API_URL}/api/games`);
    const allGames = (await allGamesRes.json()) as Array<{ name: string }>;
    const stale = allGames.filter((g) => g.name !== GAME_NAME && g.name !== TEST_NEW_NAME);
    for (const g of stale) {
      await ctx.delete(`${API_URL}/api/games/${g.name}`).catch(() => {});
    }
    if (stale.length > 0) console.log(`>> cleaned up ${stale.length} stale games`);

    browser = await chromium.launch();
    try {
      const browserProc = browser.process?.();
      if (browserProc && browserProc.pid != null) registerPid("browser", browserProc.pid);
    } catch {
      // best-effort: some Browser implementations don't expose process()
    }
    const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error") console.error("[browser error]", text);
    });

    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    // Wait for client initialization, with stronger diagnostics on timeout
    try {
      await page.waitForFunction(
        () => (window as any).__gameDebug?.activeGameName != null,
        null,
        { timeout: 60_000 }
      );
    } catch (err) {
      console.error("Timed out waiting for client init; dumping page HTML and recent logs");
      try {
        const html = await page.content();
        await fsPromises.writeFile("test/failure-page.html", html, "utf8");
        console.error("Saved test/failure-page.html");
      } catch (e) { console.error("failed to save page content:", e); }

      try {
        const maybeApiErr = await fsPromises.readFile("test/api.err.log", "utf8").catch(()=>null);
        const maybeWebErr = await fsPromises.readFile("test/web.err.log", "utf8").catch(()=>null);
        if (maybeApiErr) {
          console.error("=== test/api.err.log (tail) ===");
          console.error(maybeApiErr.slice(-16_000));
        }
        if (maybeWebErr) {
          console.error("=== test/web.err.log (tail) ===");
          console.error(maybeWebErr.slice(-16_000));
        }
      } catch (e) { console.error("failed to dump logs:", e); }

      throw err;
    }

    const spawnInfo = await page.evaluate(() => {
      const dbg = (window as any).__gameDebug;
      const heroes = dbg?.getHeroes?.() ?? [];
      const settlements = dbg?.getSettlements?.() ?? [];
      const playerHero = heroes.find((h: any) => h.ownerId === 0);
      const aiSpawn = settlements.find((s: any) => s.ownerId === 1);
      return {
        playerSpawn: playerHero ? { q: playerHero.q, r: playerHero.r } : null,
        aiSpawn: aiSpawn ? { q: aiSpawn.q, r: aiSpawn.r } : null,
      };
    });
    if (spawnInfo.playerSpawn) PLAYER_SPAWN = spawnInfo.playerSpawn;
    if (spawnInfo.aiSpawn) AI_SPAWN = spawnInfo.aiSpawn;
    console.log(`>> dynamic spawns: player=${JSON.stringify(PLAYER_SPAWN)} ai=${JSON.stringify(AI_SPAWN)}`);

    // ... rest of the test flow unchanged ...

    console.log(">> ALL TESTS PASSED");
  } catch (err) {
    failed = true;
    console.error("TEST FAILED:", err);
  } finally {
    stopLogTail();
    killBrowserTree();
    killSpawnedChild(api);
    killSpawnedChild(web);
    clearRegisteredPids();
    process.exit(failed ? 1 : 0);
  }
}

run();

if (SHUTDOWN_AFTER_MS != null) {
  setTimeout(() => {
    console.error(`>> shutdown ceiling (${SHUTDOWN_AFTER_MS}ms) reached, killing child trees`);
    killSpawnedChild(api);
    killSpawnedChild(web);
    killBrowserTree();
    clearRegisteredPids();
    process.exit(3);
  }, SHUTDOWN_AFTER_MS).unref();
}

setTimeout(() => {
  console.error(">> smoke test exceeded 120s, forcing exit");
  process.exit(2);
}, 120_000).unref();
