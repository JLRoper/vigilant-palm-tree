import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl, waitForPortReleased,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

// City districts e2e (Playwright + real API + real Postgres, docs/settlements.md
// "City districts"). Covers the whole player-facing path the unit suite cannot:
//   double-click a controlled, passable, non-settlement hex inside territory ->
//   CityView opens in district mode (5x5, no Town Hall, all 25 cells buildable)
//   -> place buildings on the CENTER cell and a corner -> the district is
//   persisted in settlements.districts JSONB and round-trips through the
//   PlaceBuildings command -> the adventure map paints the district sprite and
//   the tile panel reports the variant -> End Turn ticks district construction
//   -> a page reload re-hydrates the district from the server.
//
// Set DISTRICTS_GAME_NAME_TAG to suffix the game name and avoid clashing with
// a concurrent run on the shared game DB (default: unsuffixed).

const API_PORT = getApiPort(4000);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const SEED = 90210;
const GAME_NAME = process.env.DISTRICTS_GAME_NAME_TAG
  ? `districts-e2e-${process.env.DISTRICTS_GAME_NAME_TAG}`
  : "districts-e2e";

const VIEWPORT = { width: 1280, height: 800 };
const DIRS: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

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
setTimeout(() => { console.error(">> districts.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

function startApi(): void {
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], {
    API_PORT: String(API_PORT), CLIENT_PORT: String(WEB_PORT),
  }));
}
function startWeb(): void {
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
}

// Defaults pin the LOCAL docker db -- never .env's possible gameserver host.
const db = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser", password: process.env.PGPASSWORD ?? "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});

interface DistrictRow {
  q: number; r: number;
  citySpots: Array<{ cell: { x: number; y: number }; resource: string; vein: string }>;
  buildings: Array<{ gx: number; gy: number; kind: string; construction?: { daysRemaining: number } }>;
}

async function storedDistricts(gameId: number, settlementId: string): Promise<Record<string, DistrictRow> | null> {
  const r = await db.query(`SELECT districts FROM settlements WHERE game_id = $1 AND id = $2`, [gameId, settlementId]);
  assert(r.rows[0], `settlement ${settlementId} missing from db`);
  return r.rows[0].districts ?? null;
}

const settleSnapshot = (page: Page, id: string) => page.evaluate((sid) => {
  const gs = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as any;
  const list = Array.isArray(gs.settlements) ? gs.settlements : Object.values(gs.settlements);
  const s = list.find((x: any) => x.id === sid) as any;
  return s ? { gold: s.gold, round: gs.round, districts: s.districts ?? null } : null;
}, id);

/** Cell centre in CLIENT coordinates -- the same space handleBuildingClick reads. */
async function cellScreen(page: Page, gx: number, gy: number, size = 5) {
  return page.evaluate(async ({ gx, gy, size }) => {
    // Non-literal specifiers on purpose: these are Vite dev-server module URLs
    // resolved in the page at runtime, not modules TS can resolve from here.
    const gridPath = "/src/core/cityGrid.ts";
    const railPath = "/src/screens/shared/panelRail.ts";
    const grid: any = await import(/* @vite-ignore */ gridPath);
    const rail: any = await import(/* @vite-ignore */ railPath);
    const layout = grid.cityLayout(size, window.innerWidth, window.innerHeight, rail.toolbarHeight());
    const c = grid.cellToScreen(gx, gy, layout.gridOrigin);
    return { x: layout.screenOrigin.x + c.x * layout.tileScale, y: layout.screenOrigin.y + c.y * layout.tileScale };
  }, { gx, gy, size });
}

const cityViewOpen = (page: Page) => page.evaluate(() => document.body.textContent!.includes("City Design"));

/** A district never renders starter buildings, so "Cart is fresh" is its own assertion. */
const buildingKinds = (page: Page) => page.evaluate(() => [...document.querySelectorAll("button")]
  .filter((b) => b.title && b.title.length > 0)
  .map((b) => ({ text: (b.textContent || "").trim(), title: b.title, cursor: getComputedStyle(b).cursor })));

// Palette rows are <button>s whose textContent is "<cost icons><label>" with no
// separator, so match on the suffix and click through a temporary marker: a real
// Playwright click, immune to hasText collisions ("House" vs "Farmhouse").
async function clickPalette(page: Page, endsWith: string, notMatching?: string): Promise<void> {
  const tagged = await page.evaluate(({ endsWith, notMatching }) => {
    const rows = [...document.querySelectorAll("button")].filter((b) => b.title && b.title.length > 0);
    const btn = rows.find((b) => {
      const t = (b.textContent || "").trim();
      return t.endsWith(endsWith) && !(notMatching && new RegExp(notMatching, "i").test(t));
    });
    if (!btn) return false;
    btn.setAttribute("data-districts-target", "1");
    return true;
  }, { endsWith, notMatching });
  assert(tagged, `palette row ending with "${endsWith}" not found`);
  await page.locator('[data-districts-target="1"]').click();
  await wait(400);
}

async function clickHex(page: Page, q: number, r: number): Promise<void> {
  const px = await page.evaluate(({ q, r }) =>
    (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.screenFor(q, r), { q, r });
  await page.mouse.move(px.x, px.y);
  await wait(150);
  await page.mouse.click(px.x, px.y);
  await wait(150);
  await page.mouse.dblclick(px.x, px.y);
  await wait(900);
}

async function closeCityView(page: Page): Promise<void> {
  await page.locator("button", { hasText: "Back" }).first().click();
  await wait(500);
}

async function waitForSettlement(page: Page, id: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await settleSnapshot(page, id);
    if (s) return s;
    await wait(300);
  }
  return null;
}

/** The app boots to the home overlay and never auto-rejoins a game, so this is the only reload path. */
async function loadGameFromHome(page: Page, name: string): Promise<void> {
  await page.locator("button", { hasText: "Load Game" }).last().click();
  await wait(700);
  const tagged = await page.evaluate((gameName) => {
    const rows = [...document.querySelectorAll("div")].filter((d) => {
      const t = (d.textContent || "").trim();
      return t.startsWith(gameName) && /turn \d+/.test(t) && d.querySelector("button");
    });
    const row = rows[rows.length - 1];
    if (!row) return false;
    const open = [...row.querySelectorAll("button")].find((b) => /Open/.test(b.textContent || ""));
    if (!open) return false;
    open.setAttribute("data-districts-open", "1");
    return true;
  }, name);
  assert(tagged, `no Load Game row for "${name}"`);
  await page.locator('[data-districts-open="1"]').click();
  await wait(2500);
}

async function run(): Promise<void> {
  let browser: Browser | undefined;
  let exitCode = 1;
  try {
    await waitForPortReleased(API_PORT);
    await waitForPortReleased(WEB_PORT);
    startApi();
    startWeb();
    await waitForApiHealth(API_URL);
    await waitForUrl(WEB_URL);
    console.log(">> api + web up");

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    await context.request.delete(`${API_URL}/api/games/${GAME_NAME}`).catch(() => {});
    await page.goto(WEB_URL, { waitUntil: "load" });
    // Readiness is the debug API + the home overlay, NOT activeGameName: the app
    // only auto-restores a game whose userGames cache entry still exists server-side.
    await page.waitForFunction(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug != null, null, { timeout: 20_000 });
    await page.locator("button", { hasText: "New Game" }).last().waitFor({ state: "visible", timeout: 20_000 });
    await wait(300);

    await page.locator("button", { hasText: "New Game" }).last().click();
    await wait(200);
    await page.locator("input[type=text]").first().fill(GAME_NAME);
    await page.locator("input[type=number]").first().fill(String(SEED));
    await page.locator("button", { hasText: "Create Game" }).click();
    await wait(1500);

    const created = await page.evaluate(() => {
      const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug as GameDebugApi;
      const gs = d.getState() as any;
      return {
        name: d.activeGameName,
        id: d.activeGameId,
        settlements: Array.isArray(gs.settlements) ? gs.settlements : Object.values(gs.settlements),
        heroes: d.getHeroes(),
      };
    });
    assert.equal(created.name, GAME_NAME, `New Game failed: activeGameName=${created.name}`);
    assert(created.id != null, "activeGameId missing");
    const gameId = created.id!;
    const home = created.settlements.find((s: any) => s.ownerId === 0) as any;
    assert(home, "no player-owned settlement in the fresh game");
    const heroId = created.heroes[0].id;
    await page.evaluate((id) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero(id), heroId);
    await wait(400);
    console.log(`>> game ${GAME_NAME} (id ${gameId}), home ${home.id} at (${home.q},${home.r})`);

    // ── 1. a hex OUTSIDE the player's territory must not open a district ──
    const farHex = await page.evaluate(({ q, r, dirs }) => {
      const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug as GameDebugApi;
      for (const [dq, dr] of dirs) {
        const tq = q + dq * 3, tr = r + dr * 3;
        if (d.isPassable(tq, tr)) return { q: tq, r: tr };
      }
      return null;
    }, { q: home.q, r: home.r, dirs: DIRS });
    assert(farHex, "no passable hex far from the home settlement");
    await clickHex(page, farHex!.q, farHex!.r);
    assert.equal(await cityViewOpen(page), false,
      `double-click on (${farHex!.q},${farHex!.r}), outside territory, opened a city view`);

    // ── 2. a controlled, passable, non-settlement hex opens a district ───
    const target = await page.evaluate(({ sq, sr, dirs }) => {
      const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug as GameDebugApi;
      const centers = new Set(d.getSettlements().map((s) => `${s.q},${s.r}`));
      for (const [dq, dr] of dirs) {
        const q = sq + dq, r = sr + dr;
        if (centers.has(`${q},${r}`) || !d.isPassable(q, r)) continue;
        return { q, r };
      }
      return null;
    }, { sq: home.q, sr: home.r, dirs: DIRS });
    assert(target, "no controlled passable hex adjacent to the home settlement");
    const key = `${target!.q},${target!.r}`;
    await clickHex(page, target!.q, target!.r);
    assert.equal(await cityViewOpen(page), true, `district city view did not open on (${key})`);

    // ── 3. district palette: Town Hall disabled, district-specific reason ─
    await page.keyboard.press("b");
    await wait(600);
    const rows = await buildingKinds(page);
    const townHall = rows.find((r) => /Town Hall/i.test(r.text));
    assert(townHall, "Town Hall row missing from the district build palette");
    assert.equal(townHall!.cursor, "not-allowed", "Town Hall must be disabled in a district");
    assert.match(townHall!.title, /only be built in the main settlement/,
      `Town Hall reason is not district-specific: ${townHall!.title}`);

    const before = await settleSnapshot(page, home.id);
    assert(before, "home settlement vanished from state");
    assert.equal(before!.districts?.[key], undefined, "a fresh district must not be persisted");

    // ── 4. build on the CENTER cell (2,2): every one of the 25 cells is open ─
    await clickPalette(page, "House", "Farmhouse");
    const centre = await cellScreen(page, 2, 2);
    await page.mouse.move(centre.x, centre.y);
    await wait(200);
    await page.mouse.click(centre.x, centre.y);
    await wait(1000);

    const afterHouse = await settleSnapshot(page, home.id);
    const district = afterHouse!.districts?.[key] as DistrictRow | undefined;
    assert(district, `no district persisted at ${key} after placing on the centre cell`);
    assert(district!.buildings.some((b) => b.gx === 2 && b.gy === 2), "house was not placed on (2,2)");
    assert(afterHouse!.gold < before!.gold,
      `district placement must charge full cost (gold ${before!.gold} -> ${afterHouse!.gold})`);

    // ── 5. a farm producer -> the district renders the 'farm' sprite variant ─
    await clickPalette(page, "Farm Field (2×2)");
    const corner = await cellScreen(page, 0, 0);
    await page.mouse.move(corner.x, corner.y);
    await wait(200);
    await page.mouse.click(corner.x, corner.y);
    await wait(1000);

    const afterFarm = await settleSnapshot(page, home.id);
    const farmDistrict = afterFarm!.districts?.[key] as DistrictRow | undefined;
    assert(farmDistrict?.buildings.some((b) => b.kind === "farmField"), "farm field was not placed");
    assert.equal(farmDistrict!.citySpots.length, 3, "a district must carry exactly 3 deterministic resource spots");

    // ── 6. the server persisted the same district (real JSONB round-trip) ─
    const stored = await storedDistricts(gameId, home.id);
    assert(stored?.[key], `settlements.districts has no ${key} row for game ${gameId}`);
    assert.deepEqual(
      stored![key]!.buildings.map((b) => `${b.kind}@${b.gx},${b.gy}`).sort(),
      farmDistrict!.buildings.map((b) => `${b.kind}@${b.gx},${b.gy}`).sort(),
      "persisted district buildings differ from the client's view",
    );
    assert.deepEqual(stored![key]!.citySpots, farmDistrict!.citySpots,
      "persisted citySpots differ from the client's view");

    // ── 7. close: tile inspection reports variant + building count ────────
    await closeCityView(page);
    await wait(700);
    const px = await page.evaluate(({ q, r }) =>
      (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.screenFor(q, r), { q: target!.q, r: target!.r });
    await page.mouse.move(px.x, px.y);
    await wait(900);
    const panel = (await page.evaluate(() => document.body.textContent!)).replace(/\s+/g, " ");
    const line = panel.match(/(\S[^.]*?) district \((standard|farm), (\d+) building/);
    assert(line, "tile info panel did not report the district");
    assert.equal(line![2], "farm", `expected the farm variant, panel said "${line![2]}"`);
    assert.equal(Number(line![3]), 2, `expected 2 buildings, panel said "${line![3]}"`);

    // ── 8. End Turn: districts survive and their timers tick ──────────────
    const daysBefore = Object.fromEntries((farmDistrict!.buildings ?? [])
      .filter((b) => b.construction)
      .map((b) => [`${b.kind}@${b.gx},${b.gy}`, b.construction!.daysRemaining]));
    await page.locator("button", { hasText: "End Turn" }).first().click();
    await wait(4500);
    const afterTurn = await settleSnapshot(page, home.id);
    const turnedDistrict = afterTurn!.districts?.[key] as DistrictRow | undefined;
    assert(turnedDistrict?.buildings.length === 2, "district did not survive the End Turn round wrap");
    for (const b of turnedDistrict!.buildings) {
      const id = `${b.kind}@${b.gx},${b.gy}`;
      if (!(id in daysBefore)) continue;
      assert(
        b.construction == null || b.construction.daysRemaining < daysBefore[id],
        `district construction timer for ${id} did not tick (${daysBefore[id]} -> ${b.construction?.daysRemaining})`,
      );
    }

    // ── 9. reload: the district must re-hydrate from the server ──────────
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug != null, null, { timeout: 20_000 });
    await page.locator("button", { hasText: "New Game" }).last().waitFor({ state: "visible", timeout: 20_000 });
    await wait(300);
    await loadGameFromHome(page, GAME_NAME);
    const reloaded = await waitForSettlement(page, home.id);
    assert(reloaded, "could not re-load the game after reload");
    const reloadedDistrict = reloaded!.districts?.[key] as DistrictRow | undefined;
    assert(reloadedDistrict?.buildings.length === 2, "district did not round-trip across a page reload");
    assert.deepEqual(reloadedDistrict!.citySpots, farmDistrict!.citySpots,
      "district citySpots changed across a page reload");

    await page.evaluate((id) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero(id), heroId);
    await wait(400);
    await clickHex(page, target!.q, target!.r);
    assert.equal(await cityViewOpen(page), true, "district did not re-open after reload");

    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);

    console.log(">> districts e2e: all checks passed");
    exitCode = 0;
  } catch (e) {
    console.error(">> threw:", e);
    exitCode = 3;
  } finally {
    if (browser) await browser.close();
    await db.end().catch(() => {});
    cleanup();
    process.exit(exitCode);
  }
}

run();
