import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

// Logistics retarget regression (Playwright + real API + real DB): a caravan
// heading to a hero whose OWNER MOVED the hero this turn must, at turn end,
// point its remaining path at the hero's CURRENT tile -- not the tile the
// hero stood on when the route loaded. This pins the engine's pre-walk
// re-target (packages/engine/src/logistics.ts) end to end.

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_SEED = 707070;
const IMPASSABLE = new Set(["water", "mountain"]);

interface Axial { q: number; r: number }
interface Tile extends Axial { terrain: string }

interface CaravanShape {
  phase: string;
  cargo: number;
  path: Axial[];
  pathIndex: number;
}

interface RouteShape {
  id: string;
  from: { kind: string; id: string };
  to: { kind: string; id: string };
  payload: { kind: string; resource?: string };
  wagons: number;
  caravan: CaravanShape | null;
  ownerId: number | null;
}

interface GameRow {
  round: number;
  players: Array<{ id: number; settlementIds: string[] }>;
  heroes: Record<string, { ownerId: number; q: number; r: number }>;
  settlements: Record<string, { ownerId: number | null; q: number; r: number }>;
  trade_routes: RouteShape[];
}

function hexDist(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q - b.q + a.r - b.r)) / 2;
}

const children: ChildProcess[] = [];
let cleaned = false;
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  console.log(">> Cleaning up subprocesses...");
  for (const c of children) if (c.pid != null) treeKill(c.pid);
  clearRegisteredPids();
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (err) => { console.error(err); cleanup(); process.exit(1); });
reapPreviousRunPids();
setTimeout(() => { console.error(">> logisticsCaravanFollowsHero.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

// Defaults pin the LOCAL docker db -- never .env's possible gameserver host.
const db = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser", password: process.env.PGPASSWORD ?? "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function serverRow(name: string): Promise<GameRow> {
  const r = await db.query(
    `SELECT players, heroes, settlements, trade_routes, round FROM games WHERE name = $1`, [name],
  );
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

async function freshGame(name: string): Promise<{ id: string }> {
  await api("DELETE", `/api/games/${name}`);
  const res = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 0 });
  assert.equal(res.status, 201, `create ${name} -> ${res.status}`);
  return res.json;
}

async function deleteGame(name: string): Promise<void> {
  await api("DELETE", `/api/games/${name}`);
}

async function tilesOf(name: string): Promise<Tile[]> {
  const res = await api("GET", `/api/games/${name}/tiles`);
  assert.equal(res.status, 200, `tiles ${name} -> ${res.status}`);
  return res.json;
}

// A passable tile at least minDist hexes from every `from` tile, avoiding
// every settlement tile (so a hero parked on it doesn't sit on a city).
function farPassable(tiles: Tile[], from: Axial[], avoid: Set<string>, minDist: number): Axial {
  let best: Axial | null = null;
  let bestDist = -1;
  for (const t of tiles) {
    if (IMPASSABLE.has(t.terrain)) continue;
    if (avoid.has(`${t.q},${t.r}`)) continue;
    const d = Math.min(...from.map((f) => hexDist(t, f)));
    if (d > bestDist) { bestDist = d; best = { q: t.q, r: t.r }; }
  }
  assert(best && bestDist >= minDist, `no passable tile >= ${minDist} hexes away`);
  return best!;
}

// Seed the games row JSONB: park the hero far from its settle, fund the
// settle, give the hero purse room, and stage a gold route (caravan null, so
// the next turn-end advance loads it and walks toward the hero's current tile).
async function seedScenario(name: string): Promise<{
  gameId: string; heroId: string; settlementId: string;
  origin: Axial; heroStart: Axial;
}> {
  const game = await freshGame(name);
  const row = await serverRow(name);
  const heroId = "p0-hero";
  assert(row.heroes[heroId], `hero ${heroId} missing in ${name}`);
  const settlementId = row.players.find((p) => p.id === 0)!.settlementIds[0];
  const origin = { q: row.settlements[settlementId].q, r: row.settlements[settlementId].r };
  const avoid = new Set(Object.values(row.settlements).map((s) => `${s.q},${s.r}`));
  const heroStart = farPassable(await tilesOf(name), [origin], avoid, 6);

  const heroes = JSON.parse(JSON.stringify(row.heroes));
  Object.assign(heroes[heroId], {
    q: heroStart.q, r: heroStart.r,
    previousQ: null, previousR: null,
    movementRemaining: 7, treasuryWagons: 5,
    trail: [{ q: heroStart.q, r: heroStart.r }],
  });
  const settlements = JSON.parse(JSON.stringify(row.settlements));
  settlements[settlementId].gold = 2500;
  const tradeRoutes: RouteShape[] = [{
    id: "route0",
    from: { kind: "settlement", id: settlementId },
    to: { kind: "hero", id: heroId },
    payload: { kind: "gold" },
    wagons: 1,
    caravan: null,
    ownerId: 0,
  }];
  await db.query(
    `UPDATE games SET heroes = $1::jsonb, settlements = $2::jsonb, trade_routes = $3::jsonb, updated_at = now() WHERE name = $4`,
    [JSON.stringify(heroes), JSON.stringify(settlements), JSON.stringify(tradeRoutes), name],
  );
  return { gameId: game.id, heroId, settlementId, origin, heroStart };
}

// A passable, unoccupied tile the hero can actually reach this turn (within 7
// hexes of its last persisted tile) but that the caravan cannot reach this
// wrap (>= 5 hexes from the caravan's current tile), off every settlement.
function pickNewHeroTile(tiles: Tile[], heroTile: Axial, cartTile: Axial, occupied: Set<string>): Axial {
  const cands = tiles
    .filter((t) => !IMPASSABLE.has(t.terrain) && !occupied.has(`${t.q},${t.r}`))
    .map((t) => ({ t, dHero: hexDist(t, heroTile), dCart: hexDist(t, cartTile) }))
    .filter((c) => c.dHero >= 2 && c.dHero <= 7 && c.dCart >= 5)
    .sort((a, b) => a.dHero - b.dHero);
  assert(cands.length > 0, "no legal hero-retreat tile (2..7 from hero, >=5 from caravan)");
  return { q: cands[0].t.q, r: cands[0].t.r };
}

async function openGame(page: Page, name: string, gameId: string): Promise<void> {
  // waitUntil "load", never "networkidle": the SSE stream holds a request open forever.
  await page.goto(WEB_URL, { waitUntil: "load" });
  await page.evaluate((g) => {
    localStorage.setItem("heroesJs.userGames", JSON.stringify({
      version: 1, games: [{ id: g.id, name: g.name, lastSeenAt: new Date().toISOString() }],
    }));
  }, { id: gameId, name });
  await page.reload({ waitUntil: "load" });
  await wait(1200);
  const loadBtn = page.locator("button").filter({ hasText: /^Load Game$/ }).first();
  if ((await loadBtn.count()) > 0) {
    await loadBtn.click();
    await page.locator("button", { hasText: "Open" }).first().waitFor({ timeout: 10000 });
    const clicked = await page.evaluate((n) => {
      const rows = Array.from(document.body.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Open")
        .map((b) => {
          let row = b.parentElement;
          for (let i = 0; i < 3 && row && row.textContent.length < 40; i++) row = row.parentElement;
          return { btn: b, text: row?.textContent ?? "" };
        });
      const hit = rows.find((r) => r.text.includes(n));
      if (!hit) return false;
      hit.btn.click();
      return true;
    }, name);
    assert(clicked, `no Open row matched ${name}`);
  }
  await page.waitForFunction((n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === n, name, { timeout: 30000 });
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

async function endTurnAndWaitRound(page: Page, name: string, expectedRound: number): Promise<void> {
  await page.evaluate(() => { void (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.endTurn(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await wait(400);
    const row = await serverRow(name);
    if (row.round >= expectedRound) return;
  }
  assert.fail(`round never reached ${expectedRound}`);
}

// Read server + client truth together after a turn.
async function clientCaravan(page: Page): Promise<{
  heroQ: number; heroR: number;
  caravan: CaravanShape | null;
}> {
  const st = await page.evaluate(() => {
    const s = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.() as any;
    if (!s) return null;
    return {
      hero: s.heroes?.["p0-hero"] ?? null,
      route: s.tradeRoutes?.[0] ?? null,
    };
  });
  return {
    heroQ: st?.hero?.q ?? -1,
    heroR: st?.hero?.r ?? -1,
    caravan: st?.route?.caravan ?? null,
  };
}

async function main(): Promise<void> {
  let name = "caravan-follows-hero";
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);
    console.log(">> api + web up");

    const { gameId, heroId, origin, heroStart } = await seedScenario(name);
    const tiles = await tilesOf(name);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openGame(page, name, gameId);

      // Turn 1: the advance loads the gold at the origin (caravan appears at pathIndex 0).
      await endTurnAndWaitRound(page, name, 1);
      let row = await serverRow(name);
      assert(row.trade_routes[0].caravan, "caravan must be loaded after turn 1");
      assert.equal(row.trade_routes[0].caravan!.phase, "toDestination");
      assert.equal(row.trade_routes[0].caravan!.pathIndex, 0);

      // Turn 2: the caravan walks up to 4 tiles toward the hero's OLD tile
      // (the hero has not moved yet), landing mid-path.
      await endTurnAndWaitRound(page, name, 2);
      row = await serverRow(name);
      const mid = row.trade_routes[0].caravan!;
      assert.ok(mid.pathIndex > 0 && mid.pathIndex < mid.path.length, "caravan must be mid-path, not arrived");

      // The hero (route destination) moves this turn, off the stale path.
      const heroTile = { q: row.heroes[heroId].q, r: row.heroes[heroId].r };
      const cartTile = mid.path[mid.pathIndex - 1];
      const occupied = new Set([
        ...Object.values(row.heroes).map((h) => `${h.q},${h.r}`),
        ...Object.values(row.settlements).map((s) => `${s.q},${s.r}`),
      ]);
      const c = pickNewHeroTile(tiles, heroTile, cartTile, occupied);
      assert.ok(!(c.q === heroTile.q && c.r === heroTile.r), "retreat tile must differ from the hero's old tile");
      console.log(`>> moving hero ${heroId} ${heroTile.q},${heroTile.r} -> ${c.q},${c.r} (cart at ${cartTile.q},${cartTile.r})`);
      await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero("p0-hero"));
      await page.evaluate((t: Axial) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.requestMove("p0-hero", t.q, t.r), c);

      const moveDeadline = Date.now() + 20000;
      let moved = false;
      while (Date.now() < moveDeadline) {
        await wait(400);
        const h = (await serverRow(name)).heroes[heroId];
        if (h.q === c.q && h.r === c.r) { moved = true; break; }
      }
      assert(moved, "the hero move did not persist server-side");

      // Turn 3: the caravan must re-target toward the hero's CURRENT tile
      // (C), not finish the stale path to the tile the hero started the turn on.
      await endTurnAndWaitRound(page, name, 3);
      const deadline = Date.now() + 20000;
      let after: GameRow | null = null;
      while (Date.now() < deadline) {
        await wait(400);
        const r = await serverRow(name);
        const cv = r.trade_routes[0]?.caravan;
        if (cv && cv.path.length > 0) {
          const last = cv.path[cv.path.length - 1];
          if (last.q === c.q && last.r === c.r) { after = r; break; }
        }
      }
      assert(after, "the caravan path never re-targeted to the hero's current tile");
      assert.equal(after!.trade_routes[0].caravan!.phase, "toDestination", "re-targeted path still outbound (no premature arrival)");
      const pathEnd = after!.trade_routes[0].caravan!.path[after!.trade_routes[0].caravan!.path.length - 1];
      assert.equal(`${pathEnd.q},${pathEnd.r}`, `${c.q},${c.r}`, "path end must be the hero's CURRENT tile");
      assert.notEqual(`${pathEnd.q},${pathEnd.r}`, `${heroTile.q},${heroTile.r}`, "path end must not be the stale tile");
      assert.equal(after!.heroes[heroId].q, c.q, "server hero must be at the moved tile");

      // The client adopted the same merged state.
      const cc = await clientCaravan(page);
      assert.equal(`${cc.heroQ},${cc.heroR}`, `${c.q},${c.r}`, "client hero position");
      assert(cc.caravan && cc.caravan.path.length > 0, "client caravan present");
      const cEnd = cc.caravan.path[cc.caravan.path.length - 1];
      assert.equal(`${cEnd.q},${cEnd.r}`, `${c.q},${c.r}`, "client path end must be the hero's current tile");

      assert.ok(hexDist(heroStart, origin) >= 6, "fixture sanity: hero started far enough for a mid-path caravan");
      console.log(`>> caravan re-targeted to the hero's current tile (${c.q},${c.r}); delivered on path end=${pathEnd.q},${pathEnd.r}`);
      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
    console.log(">> logisticsCaravanFollowsHero.e2e: ALL TESTS PASSED");
  } finally {
    await deleteGame(name).catch(() => {});
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error("TEST FAILED:", err); cleanup(); process.exit(1); },
);