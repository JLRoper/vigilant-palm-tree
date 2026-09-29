import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";

// Settlement capture / garrison-battle e2e regressions (Playwright + real API + real DB):
// (A) human walk-in capture persists server-side (the 409 race), 3 fresh games;
// (B) NEUTRAL garrisoned walk-in triggers a settlement battle, not a silent no-op;
// (C) AI vs beatable garrison auto-resolves silently, turn completes, capture persists.

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_SEED = 424242;
const IMPASSABLE = new Set(["water", "mountain"]);
const DIRS = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

interface Axial { q: number; r: number; }
interface Tile extends Axial { terrain: string; }
interface Stack { entries: Array<{ unitTypeId: string; count: number }>; }
interface GameRow {
  players: Array<{ id: number; settlementIds: string[] }>;
  heroes: Record<string, { ownerId: number; q: number; r: number }>;
  settlements: Record<string, { ownerId: number | null; q: number; r: number; stacks?: Stack[] }>;
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
setTimeout(() => { console.error(">> settlements.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

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
  const r = await db.query(`SELECT players, heroes, settlements FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

async function freshGame(name: string): Promise<{ id: string }> {
  await api("DELETE", `/api/games/${name}`);
  const res = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 1 });
  assert.equal(res.status, 201, `create ${name} -> ${res.status}`);
  return res.json;
}

// SQL-side seeding on the games JSONB (matches debugCommands.teleportHero semantics:
// previous* nulled so the client's move hook sends fromTile = the seeded tile).
async function seedHeroPos(name: string, heroId: string, q: number, r: number): Promise<void> {
  const heroes = (await serverRow(name)).heroes as Record<string, any>;
  assert(heroes[heroId], `hero ${heroId} not in ${name}`);
  Object.assign(heroes[heroId], { q, r, previousQ: null, previousR: null, previousMovementRemaining: null, movementRemaining: 7, trail: [{ q, r }] });
  await db.query(`UPDATE games SET heroes = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(heroes), name]);
}

async function seedGarrison(name: string, sid: string, stacks: Stack[]): Promise<void> {
  const settlements = (await serverRow(name)).settlements as Record<string, any>;
  assert(settlements[sid], `settlement ${sid} not in ${name}`);
  settlements[sid].stacks = stacks;
  await db.query(`UPDATE games SET settlements = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(settlements), name]);
}

function freeNeighbor(tiles: Tile[], tile: Axial, occupied: Set<string>, exclude: Axial[]): Axial | null {
  for (const d of DIRS) {
    const q = tile.q + d.q, r = tile.r + d.r;
    const t = tiles.find((x) => x.q === q && x.r === r);
    if (!t || IMPASSABLE.has(t.terrain) || occupied.has(`${q},${r}`) || exclude.some((e) => e.q === q && e.r === r)) continue;
    return { q, r };
  }
  return null;
}

function farPassable(tiles: Tile[], from: Axial[], minDist: number): Axial {
  const hexDist = (a: Axial, b: Axial) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q - b.q + a.r - b.r)) / 2;
  let best: Axial | null = null, bestDist = -1;
  for (const t of tiles) {
    if (IMPASSABLE.has(t.terrain)) continue;
    const d = Math.min(...from.map((f) => hexDist(t, f)));
    if (d > bestDist) { bestDist = d; best = { q: t.q, r: t.r }; }
  }
  assert(best && bestDist >= minDist, "no far passable tile");
  return best!;
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
  await page.waitForFunction((n) => (window as any).__gameDebug?.activeGameName === n, name, { timeout: 30000 });
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

async function clientState(page: Page): Promise<{ phase: { kind: string }; activePlayerId: number; settlements: Record<string, { ownerId: number | null }> } | null> {
  return page.evaluate(() => {
    const st = (window as any).__gameDebug?.getState?.();
    if (!st) return null;
    return {
      phase: st.phase, activePlayerId: st.activePlayerId,
      settlements: Object.fromEntries(Object.entries(st.settlements ?? {}).map(([id, s]: [string, any]) => [id, { ownerId: s.ownerId ?? null }])),
    };
  });
}

// Creates a fresh seeded game, garrisons a neutral settlement when asked, and
// parks `moverHero` on a free passable neighbor of it.
async function seedAtNeutral(name: string, moverHero: string, garrison?: Stack[]) {
  const game = await freshGame(name);
  const row = await serverRow(name);
  const res = await api("GET", `/api/games/${name}/tiles`);
  assert.equal(res.status, 200, `tiles ${name} -> ${res.status}`);
  const tiles: Tile[] = res.json;
  const hit = Object.entries(row.settlements).find(([, s]) => s.ownerId === null);
  assert(hit, "no neutral settlement on the map");
  const [sid, s] = hit;
  if (garrison) await seedGarrison(name, sid, garrison);
  const neutral = { q: s.q, r: s.r };
  const occupied = new Set(Object.values(row.heroes).map((h) => `${h.q},${h.r}`));
  const settlementTiles = Object.values(row.settlements).map((x) => ({ q: x.q, r: x.r }));
  const from = freeNeighbor(tiles, neutral, occupied, settlementTiles);
  assert(from, `no free passable neighbor of ${neutral.q},${neutral.r}`);
  await seedHeroPos(name, moverHero, from.q, from.r);
  return { gameId: game.id, sid, neutral, from, tiles, row };
}

async function deleteGame(name: string): Promise<void> {
  await api("DELETE", `/api/games/${name}`);
}

async function walkInCapturePersisted(browser: Browser): Promise<void> {
  console.log(">> [A] human walk-in capture persists server-side (3 fresh games)");
  for (let i = 1; i <= 3; i++) {
    const name = `settle-e2e-cap${i}`;
    const { gameId, sid, neutral } = await seedAtNeutral(name, "p0-hero");
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let saw409 = false;
    page.on("response", (r) => { if (r.status() === 409 && r.url().includes("/commands")) saw409 = true; });
    await openGame(page, name, gameId);
    await page.evaluate(() => (window as any).__gameDebug.setSelectedHero("p0-hero"));
    await page.evaluate((t: Axial) => (window as any).__gameDebug.requestMove("p0-hero", t.q, t.r), neutral);

    const deadline = Date.now() + 15000;
    let owner: number | null = null, rostered = false;
    while (Date.now() < deadline) {
      await wait(500);
      const r2 = await serverRow(name);
      owner = r2.settlements[sid]?.ownerId ?? null;
      rostered = r2.players.some((p) => p.id === 0 && p.settlementIds.includes(sid));
      if (owner === 0 && rostered) break;
    }
    const client = await clientState(page);
    assert.equal(owner, 0, `run ${i}: server owner=${owner}, expected 0 (capture did not persist)`);
    assert(rostered, `run ${i}: settlement missing from player roster server-side`);
    assert.equal(client?.settlements?.[sid]?.ownerId ?? null, 0, `run ${i}: client/server owner diverged`);
    assert(!saw409, `run ${i}: 409 on /commands (capture race regression)`);
    console.log(`>> [A] run ${i}: server owner flipped to 0, roster updated, client agrees, no 409`);
    await page.close();
    await deleteGame(name);
  }
}

async function neutralGarrisonedTriggersBattle(browser: Browser): Promise<void> {
  console.log(">> [B] neutral garrisoned walk-in triggers a settlement battle (not a silent no-op)");
  const name = "settle-e2e-garrison";
  const { gameId, sid, neutral } = await seedAtNeutral(name, "p0-hero", [{ entries: [{ unitTypeId: "swordsman", count: 3 }] }]);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openGame(page, name, gameId);
  await page.evaluate(() => (window as any).__gameDebug.setSelectedHero("p0-hero"));
  await page.evaluate((t: Axial) => (window as any).__gameDebug.requestMove("p0-hero", t.q, t.r), neutral);
  let arenaOpened = true;
  try {
    await page.locator("button", { hasText: "Surrender" }).first().waitFor({ timeout: 10000 });
  } catch { arenaOpened = false; }
  const st = await clientState(page);
  const after = await serverRow(name);
  assert(arenaOpened, "no arena on neutral garrisoned walk-in (silent no-op regression)");
  assert.equal(st?.phase?.kind, "SETTLEMENT_BATTLE", `phase=${st?.phase?.kind}, expected SETTLEMENT_BATTLE`);
  assert.equal(after.settlements[sid]?.ownerId ?? null, null, "walk-in must not flip owner before the battle resolves");
  console.log(">> [B] arena opened, phase=SETTLEMENT_BATTLE, garrison still holds (no instant capture)");
  await page.close();
  await deleteGame(name);
}

async function aiBeatableGarrisonAutoResolves(browser: Browser): Promise<void> {
  console.log(">> [C] AI vs beatable garrison: auto-resolve, turn completes, capture persisted server-side");
  const name = "settle-e2e-ai";
  const { gameId, sid, neutral, tiles } = await seedAtNeutral(name, "p1-hero", [{ entries: [{ unitTypeId: "swordsman", count: 1 }] }]);
  // Default AI spawn army is 10 crossbowmen + 3 griffins (13 troops) vs a
  // 1-swordsman garrison: far above GARRISON_ATTACK_RATIO (1.5), so the AI
  // walks in and the near-certain auto-resolve win keeps this deterministic.
  const playerFar = farPassable(tiles, [neutral], 9);
  await seedHeroPos(name, "p0-hero", playerFar.q, playerFar.r);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openGame(page, name, gameId);
  await page.evaluate(() => { void (window as any).__gameDebug.endTurn(); });
  const t0 = Date.now();
  let backToPlayer = false, arenaSeen = false;
  while (Date.now() - t0 < 45000) {
    await wait(400);
    arenaSeen = arenaSeen || (await page.evaluate(() =>
      Array.from(document.body.querySelectorAll("button")).some((b) =>
        ["Surrender", "Flee", "Quick Resolve"].includes(b.textContent?.trim() ?? ""))).catch(() => false));
    const snap = await clientState(page);
    if (snap?.phase?.kind === "PLAYER_TURN" && snap.activePlayerId === 0 && Date.now() - t0 > 2500) { backToPlayer = true; break; }
  }
  const deadline = Date.now() + 10000;
  let owner: number | null = null, rostered = false, garrisonLeft = -1, battleEvent = false;
  while (Date.now() < deadline) {
    const r2 = await serverRow(name);
    owner = r2.settlements[sid]?.ownerId ?? null;
    rostered = r2.players.some((p) => p.id === 1 && p.settlementIds.includes(sid));
    garrisonLeft = (r2.settlements[sid]?.stacks ?? []).reduce((n, p) => n + p.entries.reduce((m, e) => m + e.count, 0), 0);
    const ev = await db.query(
      `SELECT 1 FROM game_events e JOIN games g ON g.id = e.game_id WHERE g.name = $1 AND e.kind = 'SettlementBattleResolved'`, [name]);
    battleEvent = (ev.rowCount ?? 0) > 0;
    if (battleEvent && owner === 1 && garrisonLeft === 0 && rostered) break;
    await wait(500);
  }
  assert(backToPlayer, `AI turn did not complete within 45s (stall); phase=${(await clientState(page))?.phase?.kind}`);
  assert(!arenaSeen, "arena opened for an AI-attacker settlement battle (must auto-resolve silently)");
  assert(battleEvent, "no SettlementBattleResolved event persisted server-side");
  assert.equal(owner, 1, `settlement owner=${owner}, expected 1 (AI capture not persisted)`);
  assert(rostered, "settlement missing from AI roster server-side");
  assert.equal(garrisonLeft, 0, `garrison not zeroed after capture (${garrisonLeft} troops left)`);
  console.log(`>> [C] AI walked in, battle auto-resolved (no arena), turn completed in ${((Date.now() - t0) / 1000).toFixed(1)}s, owner=1 + garrison zeroed persisted server-side`);
  await page.close();
  await deleteGame(name);
}

async function main(): Promise<void> {
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);
    console.log(">> api + web up");
    const browser = await chromium.launch({ headless: true });
    try {
      await walkInCapturePersisted(browser);
      await neutralGarrisonedTriggersBattle(browser);
      await aiBeatableGarrisonAutoResolves(browser);
    } finally {
      await browser.close().catch(() => {});
    }
    console.log(">> settlements.e2e: ALL TESTS PASSED");
  } finally {
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error("TEST FAILED:", err); cleanup(); process.exit(1); },
);
