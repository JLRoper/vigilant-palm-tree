import { chromium, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import { resourceAmountFor } from "@heroes/engine";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

// Heroes picking resources off the adventure map, IN A REAL BROWSER against the
// real API and the real database -- the reader's own acceptance run ("Playwright
// test as much as you want").
//
//  (1) the hero WALKS onto a resource tile (a real move command, persisted);
//  (2) the tile panel shows the deposit's remaining amount and offers the
//      pickup; clicking it in the DOM moves resources into the hero's cargo and
//      drops the tile's number by exactly what was taken -- both on screen and
//      in the games row;
//  (3) with the hold now FULL, the same button is DISABLED and names the
//      refusal ("wagons are full") instead of silently doing nothing, and the
//      tile's number does not move;
//  (4) a reload shows the REDUCED amount, not a fresh tile: the remaining
//      amount is server state (games.resource_deposits), not a client guess.
//
// The game is created and deleted by exact name (never a table sweep), and the
// suite runs on this worktree's own ports and its own PGDATABASE.

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_NAME = "resource-pickup-e2e";
const GAME_SEED = 515151;
const HERO_ID = "p0-hero";
/** Two cargo wagons = 100 per-resource cap, so a big enough tile MUST leave a remainder. */
const CARGO_WAGONS = 2;
const PER_RESOURCE_CAP = CARGO_WAGONS * 50;

interface Axial { q: number; r: number }
interface Tile extends Axial { terrain: string; resource: string | null }
interface HeroRow {
  id?: string;
  name?: string;
  ownerId: number;
  q: number;
  r: number;
  gold: number;
  resources?: Record<string, number>;
  wagons?: number;
  movementRemaining?: number;
}

const IMPASSABLE = new Set(["water", "mountain"]);
const WAREHOUSE_RESOURCES = ["wood", "stone", "iron", "arcane", "food"];

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
setTimeout(() => { console.error(">> resourcePickup.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

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

async function gameRow(name: string): Promise<{ heroes: Record<string, HeroRow>; resource_deposits: Record<string, number> | null }> {
  const r = await db.query(`SELECT heroes, resource_deposits FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

interface PickupFixture {
  /** NUMERIC, not a string: userGames' cache validates `typeof id === "number"`. */
  gameId: number;
  tile: Axial;
  resource: string;
  pristine: number;
}

/**
 * Create the game and pick a WAREHOUSE-resource tile a couple of hexes from the
 * starting hero whose pristine amount exceeds the hero's hold -- so the run
 * exercises the partial pickup (take what fits, leave the rest) rather than a
 * tile that happens to fit. The amount is computed with the ENGINE's own
 * derivation from the same seed, which is the point: the client, the server and
 * this test all agree on the number with no wire field carrying it.
 */
async function seedPickupGame(name: string): Promise<PickupFixture> {
  await api("DELETE", `/api/games/${name}`);
  const created = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 0 });
  assert.equal(created.status, 201, `create ${name} -> ${created.status}`);

  const row = await gameRow(name);
  const hero = row.heroes[HERO_ID];
  assert(hero, `hero ${HERO_ID} missing in ${name}`);
  const tiles = (await api("GET", `/api/games/${name}/tiles`)).json as Tile[];

  const candidate = tiles
    .filter((t) => t.resource !== null && WAREHOUSE_RESOURCES.includes(t.resource) && !IMPASSABLE.has(t.terrain))
    .map((t) => ({ tile: t, amount: resourceAmountFor(GAME_SEED, t.q, t.r, t.resource as never), distance: axialDistance(hero, t) }))
    .filter((c) => c.amount > PER_RESOURCE_CAP + 40 && c.distance >= 1 && c.distance <= 4)
    .sort((a, b) => a.distance - b.distance)[0];
  assert(candidate, "no warehouse-resource tile with a big enough pile 1-4 hexes from the start");

  // Enough movement to walk there in this turn, so the move is a real command
  // rather than a teleport, and two wagons so the hold is a real constraint.
  await db.query(
    `UPDATE games SET heroes = jsonb_set(jsonb_set(heroes, '{${HERO_ID},wagons}', '${CARGO_WAGONS}'), '{${HERO_ID},movementRemaining}', '30') WHERE name = $1`,
    [name],
  );
  console.log(
    `>> fixture: ${candidate.tile.resource} tile (${candidate.tile.q},${candidate.tile.r}) holds ${candidate.amount}; hero holds ${PER_RESOURCE_CAP}`,
  );
  return {
    gameId: Number(created.json.id),
    tile: { q: candidate.tile.q, r: candidate.tile.r },
    resource: candidate.tile.resource,
    pristine: candidate.amount,
  };
}

async function openGame(page: Page, name: string, gameId: number): Promise<void> {
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
          for (let i = 0; i < 3 && row && (row.textContent ?? "").length < 40; i++) row = row.parentElement;
          return { btn: b, text: row?.textContent ?? "" };
        });
      const hit = rows.find((r) => r.text.includes(n));
      if (!hit) return false;
      hit.btn.click();
      return true;
    }, name);
    if (!clicked) {
      const dump = await page.evaluate(() =>
        Array.from(document.body.querySelectorAll("button")).slice(0, 40).map((b) => b.textContent?.trim()),
      );
      console.error("Open-row dump:", JSON.stringify(dump));
      assert.fail(`no Open row matched ${name}`);
    }
  }
  await page.waitForFunction((n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === n, name, { timeout: 30000 });
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

/** A real click on a hex, with the screen position re-derived immediately before it. */
async function clickHex(page: Page, tile: Axial): Promise<void> {
  const pt = await page.evaluate(
    (t) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.screenFor(t.q, t.r),
    tile,
  );
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await wait(80);
  await page.mouse.click(pt.x, pt.y);
  await wait(400);
}

async function clientHero(page: Page): Promise<HeroRow | null> {
  return page.evaluate((id) => {
    const s = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as { heroes?: Record<string, HeroRow> } | undefined;
    return s?.heroes?.[id] ?? null;
  }, HERO_ID);
}

async function clientDeposits(page: Page): Promise<Record<string, number> | undefined> {
  return page.evaluate(() => {
    const s = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as { resourceDeposits?: Record<string, number> } | undefined;
    return s?.resourceDeposits;
  });
}

/** The tile panel's deposit line, e.g. "Iron deposit — worked by X (+8 iron/turn) · 214 left". */
async function depositLine(page: Page): Promise<string> {
  return page.locator('[data-tile-body] [data-tile-line="deposit"]').first().innerText();
}

async function remainingOnScreen(line: string): Promise<number | null> {
  const m = /·\s*(\d+) left/.exec(line);
  return m ? Number(m[1]) : null;
}

async function cargoOnScreen(page: Page, resource: string): Promise<number> {
  const text = await page.locator(`[data-hero-cargo="${resource}"]`).first().innerText();
  return Number(text);
}

async function main(): Promise<void> {
  const name = GAME_NAME;
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);
    console.log(">> api + web up");

    const fixture = await seedPickupGame(name);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openGame(page, name, fixture.gameId);

      // (1) Walk the hero onto the resource tile, through the game's own move
      // path (the same requestMove the click path uses), then confirm BOTH
      // sides agree on where the hero stands.
      const before = await clientHero(page);
      assert(before, "no starting hero on the client");
      console.log(`>> hero starts at (${before!.q},${before!.r}), ${before!.movementRemaining} move`);
      // Select the hero first: the move reducer's own gate is "is this the hero
      // the player has clicked on".
      await page.evaluate((id) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero(id), HERO_ID);
      await wait(300);
      const moved = await page.evaluate(
        ({ id, q, r }) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.requestMove(id, q, r),
        { id: HERO_ID, q: fixture.tile.q, r: fixture.tile.r },
      );
      if (!moved) {
        const why = await page.evaluate((id) => {
          const dbg = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
          const s = dbg.getState() as { heroes?: Record<string, { q: number; r: number; movementRemaining: number }>; selectedHeroId?: string | null };
          return { hero: s?.heroes?.[id], selected: s?.selectedHeroId, passable: dbg.isPassable(7, 6) };
        }, HERO_ID);
        console.error("move refused:", JSON.stringify(why));
      }
      assert.equal(moved, true, "the move onto the resource tile was refused");
      await page.waitForFunction(
        ({ id, q, r }) => {
          const s = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as { heroes?: Record<string, { q: number; r: number }> };
          return s?.heroes?.[id]?.q === q && s?.heroes?.[id]?.r === r;
        },
        { id: HERO_ID, q: fixture.tile.q, r: fixture.tile.r },
        { timeout: 15000 },
      );
      await wait(700);
      const serverHero = (await gameRow(name)).heroes[HERO_ID];
      assert.equal(
        `${serverHero.q},${serverHero.r}`,
        `${fixture.tile.q},${fixture.tile.r}`,
        "the hero must be ON the tile server-side too",
      );
      console.log(`>> hero walked onto (${fixture.tile.q},${fixture.tile.r}) -- client and server agree`);

      // (2) Inspect the hex: the tile panel shows the deposit AND its remaining
      // amount. (The first click on the hero's own hex puts the hero down; the
      // second picks it back up, which is what leaves the cargo readout on
      // screen next to the tile panel.)
      await clickHex(page, fixture.tile);
      await clickHex(page, fixture.tile);
      await page.locator('[data-tile-body] [data-tile-line="deposit"]').first().waitFor({ state: "visible", timeout: 10000 });
      const lineBefore = await depositLine(page);
      assert.equal(
        await remainingOnScreen(lineBefore),
        fixture.pristine,
        `the panel must show the tile's full amount first, got "${lineBefore}"`,
      );
      assert.match(lineBefore, /deposit/i, "the deposit line is the city-view line, extended with the amount");

      const button = page.locator("[data-pickup]").first();
      await button.waitFor({ state: "visible", timeout: 10000 });
      assert.equal(await button.isDisabled(), false, "the pickup is offered while there is room");
      const buttonBefore = await button.innerText();
      const cargoBefore = await cargoOnScreen(page, fixture.resource);
      console.log(`>> panel: "${lineBefore}" | button "${buttonBefore}" | cargo ${fixture.resource}=${cargoBefore}`);

      // Click it IN THE DOM -- the real gesture, on the real button.
      await button.click();
      await page.waitForFunction(
        (expected) => {
          const el = document.querySelector('[data-tile-body] [data-tile-line="deposit"]');
          return !!el && new RegExp(`\\u00b7\\s*${expected} left`).test(el.textContent ?? "");
        },
        fixture.pristine - PER_RESOURCE_CAP,
        { timeout: 15000 },
      );
      await wait(400);
      const lineAfter = await depositLine(page);
      const cargoAfter = await cargoOnScreen(page, fixture.resource);
      const expectedTake = Math.min(fixture.pristine, PER_RESOURCE_CAP);
      console.log(`>> after: "${lineAfter}" | cargo ${fixture.resource}=${cargoAfter}`);

      // The gain on the cargo readout and the fall on the tile's line, both
      // read off the screen.
      assert.equal(cargoAfter, cargoBefore + expectedTake, "the hero's cargo readout must show the whole gain");
      assert.equal(
        await remainingOnScreen(lineAfter),
        fixture.pristine - expectedTake,
        "the tile's line must fall by exactly what was taken",
      );
      assert.equal(expectedTake, PER_RESOURCE_CAP, "the fixture must exercise a PARTIAL pickup");
      assert.ok(fixture.pristine - expectedTake > 0, "...and something must be left on the ground");

      // The same numbers, server-side: the games row's remaining amount and the
      // hero's cargo.
      const afterRow = await gameRow(name);
      assert.equal(
        afterRow.resource_deposits?.[`${fixture.tile.q},${fixture.tile.r}`],
        fixture.pristine - expectedTake,
        "games.resource_deposits must carry the remaining amount",
      );
      assert.equal(
        afterRow.heroes[HERO_ID].resources?.[fixture.resource] ?? 0,
        expectedTake,
        "the persisted hero carries the take",
      );
      const clientAfter = await clientHero(page);
      assert.equal(clientAfter?.resources?.[fixture.resource] ?? 0, expectedTake, "the client's hero agrees");
      assert.equal(
        (await clientDeposits(page))?.[`${fixture.tile.q},${fixture.tile.r}`],
        fixture.pristine - expectedTake,
        "the client's hydrated remaining amount agrees",
      );
      console.log(">> server row + client state carry the same partial pickup");

      // (3) The hold is now FULL: the button is disabled and names the refusal,
      // and nothing moves when it is clicked.
      await page.waitForFunction(
        () => (document.querySelector("[data-pickup]") as HTMLButtonElement | null)?.disabled === true,
        undefined,
        { timeout: 15000 },
      );
      const fullButton = page.locator("[data-pickup]").first();
      const refusalTitle = await fullButton.getAttribute("title");
      const fullLabel = await fullButton.innerText();
      console.log(`>> full hold: button "${fullLabel}" disabled title="${refusalTitle}"`);
      assert.match(
        refusalTitle ?? "",
        /wagons are full/i,
        `the disabled button must name the reason, got "${refusalTitle}"`,
      );
      await fullButton.click({ force: true }).catch(() => {});
      await wait(500);
      assert.equal(await depositLine(page).then(remainingOnScreen), fixture.pristine - expectedTake, "a refused pickup must not move the tile");
      assert.equal(await cargoOnScreen(page, fixture.resource), expectedTake, "a refused pickup must not move the cargo");
      const refusalRow = await gameRow(name);
      assert.equal(
        refusalRow.resource_deposits?.[`${fixture.tile.q},${fixture.tile.r}`],
        fixture.pristine - expectedTake,
        "a refused pickup writes nothing",
      );
      console.log(">> no-room pickup refused with a named reason, row untouched");

      // (4) Reload: the reduced amount is SERVER state, so it survives.
      await openGame(page, name, fixture.gameId);
      await clickHex(page, fixture.tile);
      await page.locator('[data-tile-body] [data-tile-line="deposit"]').first().waitFor({ state: "visible", timeout: 10000 });
      const reloadedLine = await depositLine(page);
      console.log(`>> after reload: "${reloadedLine}"`);
      assert.equal(
        await remainingOnScreen(reloadedLine),
        fixture.pristine - expectedTake,
        "a reloaded game must show the reduced amount, not a fresh tile",
      );

      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
    console.log(">> resourcePickup.e2e: ALL TESTS PASSED");
  } finally {
    await api("DELETE", `/api/games/${name}`).catch(() => {});
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error("TEST FAILED:", err); cleanup(); process.exit(1); },
);
