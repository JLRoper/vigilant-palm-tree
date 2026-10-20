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

// Uncharted mode e2e regressions (Playwright + real API + real DB):
// (A) new-game UI checkbox end-to-end: check "Uncharted mode", create, lobby flag
//     + seeded initial reveal persisted server-side;
// (B) move-trail corridor reveal + save/load persistence: a multi-hex
//     __gameDebug.requestMove on an API-created uncharted game must reveal a
//     corridor tile outside the endpoint vision rings (proves the client sends
//     MoveHero.trail), and that reveal must survive a full reload;
// (C) visual darkness probe: uncharted canvas shows opaque #000 unrevealed
//     hexes; a non-uncharted control game shows zero pure-black pixels;
// (D) backward-compat: non-uncharted games never persist a revealedTiles key.

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_SEED = 424242;
const IMPASSABLE = new Set(["water", "mountain"]);
const DIRS = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

interface Axial { q: number; r: number; }
interface Tile extends Axial { terrain: string; }
interface PlayerRow { id: number; revealedTiles?: string[]; [key: string]: unknown; }
interface HeroRow { ownerId: number; q: number; r: number; movementRemaining: number; }
interface GameRow {
  players: PlayerRow[];
  heroes: Record<string, HeroRow>;
}

const children: ChildProcess[] = [];
const createdGames: string[] = [];
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
setTimeout(() => { console.error(">> unchartedMode.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

// Defaults pin the LOCAL docker db -- never .env's possible gameserver host.
const db = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser", password: process.env.PGPASSWORD ?? "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});

// raw JSON, shape unknown here; narrowed at each assert site (same as settlements.e2e.ts)
async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function serverRow(name: string): Promise<GameRow> {
  const r = await db.query(`SELECT players, heroes FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

async function freshGame(name: string, uncharted = false): Promise<{ id: string }> {
  await deleteGame(name);
  createdGames.push(name);
  const res = await api("POST", "/api/games", uncharted
    ? { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 1, uncharted: true }
    : { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 1 });
  assert.equal(res.status, 201, `create ${name} -> ${res.status}`);
  return res.json;
}

async function deleteGame(name: string): Promise<void> {
  await api("DELETE", `/api/games/${name}`);
}

async function deleteAllCreated(): Promise<void> {
  for (const name of createdGames) await api("DELETE", `/api/games/${name}`).catch(() => {});
}

// SQL-side movement budget boost so a long multi-hex move is affordable
// (movementRemaining defaults to 7 -- not enough to prove the trail corridor).
async function seedHeroMovement(name: string, heroId: string, movement: number): Promise<void> {
  const heroes = (await serverRow(name)).heroes as Record<string, any>;
  assert(heroes[heroId], `hero ${heroId} not in ${name}`);
  heroes[heroId] = { ...heroes[heroId], movementRemaining: movement };
  await db.query(`UPDATE games SET heroes = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(heroes), name]);
}

const hexDist = (a: Axial, b: Axial) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q - b.q + a.r - b.r)) / 2;

function sortedByQThenR(keys: string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    const [aq, ar] = keys[i - 1].split(",").map(Number);
    const [bq, br] = keys[i].split(",").map(Number);
    if (aq > bq || (aq === bq && ar > br)) return false;
  }
  return true;
}

// Longest consecutive passable straight-line run from `origin` per direction.
function straightPassableRuns(tiles: Tile[], origin: Axial): Array<{ dir: Axial; run: number }> {
  return DIRS.map((dir) => {
    let run = 0;
    for (let s = 1; ; s++) {
      const t = tiles.find((x) => x.q === origin.q + dir.q * s && x.r === origin.r + dir.r * s);
      if (!t || IMPASSABLE.has(t.terrain)) break;
      run = s;
    }
    return { dir, run };
  });
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

// Counts opaque pure-black (#000 alpha 255) pixels on the #game map canvas.
async function countBlackPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.getElementById("game") as HTMLCanvasElement | null;
    if (!c || c.width === 0 || c.height === 0) return -1;
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255) n++;
    }
    return n;
  });
}

async function uiCheckboxFlow(browser: Browser): Promise<void> {
  console.log(">> [A] new-game UI checkbox: uncharted flag + seeded reveal persist server-side");
  const name = "uncharted-e2e-a";
  await deleteGame(name);
  createdGames.push(name);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(WEB_URL, { waitUntil: "load" });
  await page.locator("button").filter({ hasText: /^New Game$/ }).first().waitFor({ timeout: 15000 });
  await page.locator("button").filter({ hasText: /^New Game$/ }).first().click();

  const unchartedLabel = page.getByText("Uncharted mode", { exact: true }).first();
  await unchartedLabel.waitFor({ timeout: 10000 });
  assert(await unchartedLabel.isVisible(), "Uncharted mode row label not visible");
  const checkbox = page.locator('input[type="checkbox"]').first();
  await checkbox.waitFor({ timeout: 5000 });
  await checkbox.check();
  assert(await checkbox.isChecked(), "uncharted checkbox did not check");

  await page.locator('input[type="text"]').first().fill(name);
  await page.locator("button").filter({ hasText: /^Create Game$/ }).first().click();

  const deadline = Date.now() + 30000;
  let res: { status: number; json: any } = { status: 0, json: null };
  while (Date.now() < deadline) {
    res = await api("GET", `/api/games/${name}`);
    if (res.status === 200) break;
    await wait(400);
  }
  assert.equal(res.status, 200, `game ${name} never appeared via API GET`);
  const row = res.json;
  assert.equal(row.lobby?.uncharted, true, `lobby.uncharted=${row.lobby?.uncharted}, expected true`);
  const reveal: string[] | undefined = row.players?.[0]?.revealedTiles;
  assert(Array.isArray(reveal) && reveal.length > 0, `players[0].revealedTiles missing/empty: ${JSON.stringify(row.players?.[0])}`);
  assert(sortedByQThenR(reveal), `players[0].revealedTiles not sorted: ${reveal.slice(0, 10).join(" ")}`);
  console.log(`>> [A] UI flow created ${name}: lobby.uncharted=true, ${reveal.length} initial revealed tiles, sorted`);
  await page.close();
  await deleteGame(name);
}

async function corridorAndPersistence(browser: Browser): Promise<void> {
  console.log(">> [B] trail corridor reveal + reload persistence (proves client sends MoveHero.trail)");
  const name = "uncharted-e2e-b";
  const game = await freshGame(name, true);
  const row = await serverRow(name);
  const hero = row.heroes["p0-hero"];
  assert(hero, `p0-hero missing in ${name}`);
  const origin = { q: hero.q, r: hero.r };
  await seedHeroMovement(name, "p0-hero", 25);

  const tilesRes = await api("GET", `/api/games/${name}/tiles`);
  assert.equal(tilesRes.status, 200, `tiles ${name} -> ${tilesRes.status}`);
  const tiles: Tile[] = tilesRes.json;

  // A trail-only corridor tile exists when some direction has a >=10 straight
  // passable run: the tile at hex-distance exactly 5 from the origin is >4
  // from BOTH endpoints, so only the walked-path trail can reveal it.
  const runs = straightPassableRuns(tiles, origin)
    .filter((x) => x.run >= 10)
    .sort((a, b) => b.run - a.run);
  assert(runs.length > 0, `no straight passable run of >=10 hexes from ${origin.q},${origin.r} (seed ${GAME_SEED})`);
  const { dir, run } = runs[0];
  const dest = { q: origin.q + dir.q * run, r: origin.r + dir.r * run };

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openGame(page, name, game.id);
  await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero("p0-hero"));
  const moved = await page.evaluate(
    (t: Axial) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.requestMove("p0-hero", t.q, t.r),
    dest,
  );
  assert(moved, `requestMove to ${dest.q},${dest.r} rejected client-side`);

  const deadline = Date.now() + 15000;
  let reveal: string[] = [];
  let landed = false;
  while (Date.now() < deadline) {
    await wait(500);
    const r2 = await serverRow(name);
    reveal = r2.players.find((p) => p.id === 0)?.revealedTiles ?? [];
    landed = r2.heroes["p0-hero"]?.q === dest.q && r2.heroes["p0-hero"]?.r === dest.r;
    if (landed && reveal.includes(`${dest.q},${dest.r}`) &&
      reveal.some((k) => { const [q, r] = k.split(",").map(Number); return hexDist(origin, { q, r }) === 5 && hexDist(dest, { q, r }) >= 5; })) break;
  }
  assert(landed, `hero p0 did not land on ${dest.q},${dest.r} server-side`);
  assert(reveal.includes(`${dest.q},${dest.r}`), `destination ${dest.q},${dest.r} not in revealedTiles`);
  const corridorKey = reveal.find((k) => {
    const [q, r] = k.split(",").map(Number);
    return hexDist(origin, { q, r }) === 5 && hexDist(dest, { q, r }) >= 5;
  });
  assert(corridorKey, "no corridor tile at hex-distance 5 from origin revealed (trail not wired into MoveHero)");
  console.log(`>> [B] move landed, destination + corridor ${corridorKey} revealed server-side`);

  // Full reload: client hydrates players[] from the games JSONB, so the
  // persisted reveal must come back with the same keys.
  await page.reload({ waitUntil: "load" });
  await openGame(page, name, game.id);
  const hydrated = await page.evaluate(() => {
    const st = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState();
    const p = st.players.find((x) => x.id === 0);
    return (p?.revealedTiles ?? []) as string[];
  });
  assert(hydrated.includes(`${dest.q},${dest.r}`), `destination key missing after reload (persistence broken)`);
  assert(hydrated.includes(corridorKey!), `corridor key ${corridorKey} missing after reload (persistence broken)`);
  console.log(`>> [B] after reload, client hydrated reveal keeps destination + corridor ${corridorKey}`);
  await page.close();
  await deleteGame(name);
}

async function visualDarknessProbe(browser: Browser): Promise<void> {
  console.log(">> [C] visual darkness probe: uncharted canvas has opaque black; control has none");
  const name = "uncharted-e2e-c";
  const game = await freshGame(name, true);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openGame(page, name, game.id);
  await wait(1200);
  const blackUncharted = await countBlackPixels(page);
  assert(blackUncharted >= 0, "getImageData unavailable on #game canvas");
  assert(blackUncharted > 1000, `expected a large opaque-black unrevealed region, got ${blackUncharted} pure-black pixels`);
  console.log(`>> [C] uncharted game: ${blackUncharted} opaque pure-black pixels (>1000 threshold met)`);
  await page.close();
  await deleteGame(name);

  const ctrlName = "uncharted-e2e-ctrl";
  const ctrlGame = await freshGame(ctrlName, false);
  const ctrlPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openGame(ctrlPage, ctrlName, ctrlGame.id);
  await wait(1200);
  const blackControl = await countBlackPixels(ctrlPage);
  assert(blackControl >= 0, "getImageData unavailable on #game canvas (control)");
  // Fog rgba(8,10,16,0.78) and the #0a0a0a background are never pure black, but
  // scaled sprite art leaves exact-#000 outline pixels: the hero/castle used to
  // contribute ~3 on a 1280x800 canvas, and the iso resource piles that became
  // the default map sprite add a couple of hundred (measured: 223). A broken
  // pipeline leaking uncharted-black into a normal game adds hundreds of
  // thousands, so this ceiling stays three orders of magnitude below that while
  // tolerating sprite outlines, and the margin-vs-uncharted check below keeps
  // the control strict.
  assert(blackControl < 5_000, `control (non-uncharted) game shows ${blackControl} opaque pure-black pixels, expected near 0 (fog rgba(8,10,16,0.78)/background #0a0a0a are never pure black; only sprite outlines may be #000)`);
  assert(blackUncharted > Math.max(1000, 100 * blackControl), `uncharted black ${blackUncharted} not convincingly above control ${blackControl}`);
  console.log(`>> [C] control game: ${blackControl} pure-black pixels (fog/background never pure black)`);
  await ctrlPage.close();
  await deleteGame(ctrlName);
}

async function negativeBackwardCompat(browser: Browser): Promise<void> {
  console.log(">> [D] non-uncharted game: moving the hero never persists a revealedTiles key");
  const name = "uncharted-e2e-d";
  const game = await freshGame(name, false);
  const row = await serverRow(name);
  const hero = row.heroes["p0-hero"];
  assert(hero, `p0-hero missing in ${name}`);
  const origin = { q: hero.q, r: hero.r };
  const tilesRes = await api("GET", `/api/games/${name}/tiles`);
  assert.equal(tilesRes.status, 200, `tiles ${name} -> ${tilesRes.status}`);
  const tiles: Tile[] = tilesRes.json;
  const runs = straightPassableRuns(tiles, origin).filter((x) => x.run >= 2);
  assert(runs.length > 0, `no straight passable run of >=2 hexes from ${origin.q},${origin.r}`);
  const dest = { q: origin.q + runs[0].dir.q * 2, r: origin.r + runs[0].dir.r * 2 };

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openGame(page, name, game.id);
  await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero("p0-hero"));
  const moved = await page.evaluate(
    (t: Axial) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.requestMove("p0-hero", t.q, t.r),
    dest,
  );
  assert(moved, `requestMove to ${dest.q},${dest.r} rejected client-side`);

  const deadline = Date.now() + 15000;
  let players: PlayerRow[] = [];
  while (Date.now() < deadline) {
    await wait(500);
    const r2 = await serverRow(name);
    players = r2.players;
    if (r2.heroes["p0-hero"]?.q === dest.q && r2.heroes["p0-hero"]?.r === dest.r) break;
  }
  for (const p of players) {
    assert(!Object.prototype.hasOwnProperty.call(p, "revealedTiles"), `player ${p.id} gained a revealedTiles key in a non-uncharted game (byte-compat broken)`);
  }
  console.log(`>> [D] move landed on ${dest.q},${dest.r}; no player row carries revealedTiles (byte-compatible)`);
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
      await uiCheckboxFlow(browser);
      await corridorAndPersistence(browser);
      await visualDarknessProbe(browser);
      await negativeBackwardCompat(browser);
    } finally {
      await browser.close().catch(() => {});
    }
    console.log(">> unchartedMode.e2e: ALL TESTS PASSED");
  } finally {
    await deleteAllCreated();
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("TEST FAILED:", err);
    void deleteAllCreated();
    cleanup();
    process.exit(1);
  },
);