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
// test as much as you want"). EVERY step is a player gesture: the hero is
// selected and moved by REAL MOUSE CLICKS on the map canvas, the pickup and the
// deposit are clicks on the panels' own buttons. `__gameDebug` is READ (to see
// what the client did) but never INVOKED as an action, so nothing on this path
// is reachable only through the debug controller.
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
//      amount is server state (games.resource_deposits), not a client guess;
//  (5) the hero CARRIES the cargo home and DELIVERS it through the settlement
//      panel's Warehouse row -- the other half of the verb (playthrough finding
//      F-2: map-picked cargo had no UI path into a settlement).
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
interface SettlementRow {
  q: number;
  r: number;
  name: string;
  ownerId: number | null;
  warehouse?: Record<string, number>;
}
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

async function gameRow(name: string): Promise<{ heroes: Record<string, HeroRow>; settlements: Record<string, SettlementRow>; resource_deposits: Record<string, number> | null }> {
  const r = await db.query(`SELECT heroes, settlements, resource_deposits FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

/**
 * The API's own payload for the game -- the middle of the three readings. It is
 * `GET /api/games/:name` (server/routes.ts), whose row carries the same
 * `resource_deposits` JSONB and `heroes` the DB does and the client hydrates
 * from, so DOM / API / DB can be quoted side by side for the same number.
 */
async function apiGame(name: string): Promise<{
  heroes: Record<string, HeroRow>;
  settlements: Record<string, SettlementRow>;
  resource_deposits: Record<string, number> | null;
}> {
  const r = await api("GET", `/api/games/${name}`);
  assert.equal(r.status, 200, `GET /api/games/${name} -> ${r.status}`);
  return r.json;
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

  // Enough movement for the WHOLE round trip (out to the deposit and back to the
  // settlement) in one turn -- so every leg is a real click-driven move command
  // rather than a teleport or a mid-run DB poke -- and two wagons so the hold is
  // a real constraint on what one pickup can take.
  await db.query(
    `UPDATE games SET heroes = jsonb_set(jsonb_set(heroes, '{${HERO_ID},wagons}', '${CARGO_WAGONS}'), '{${HERO_ID},movementRemaining}', '300') WHERE name = $1`,
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
  await page.waitForFunction((n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName() === n, name, { timeout: 30000 });
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

/**
 * Select a hero the way a PLAYER does: click the hex it stands on. The click is
 * a real mouse click on the canvas, never `__gameDebug.setSelectedHero` -- the
 * debug API is only ever READ here (to see what the gesture did), so a broken
 * click path cannot be papered over by a helper.
 *
 * A click on a hero is a toggle, so this clicks until the hero is selected
 * rather than assuming which side of the toggle it landed on.
 */
async function selectHeroByClick(page: Page, at: Axial): Promise<void> {
  const isSelected = () =>
    page.evaluate((id) => {
      const s = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as {
        selectedHeroId?: string | null;
      };
      return s?.selectedHeroId === id;
    }, HERO_ID);
  await clickHex(page, at);
  for (let i = 0; i < 2 && !(await isSelected()); i++) {
    await clickHex(page, at);
  }
  assert.equal(await isSelected(), true, `clicking (${at.q},${at.r}) never left ${HERO_ID} selected`);
}

/**
 * Move a hero by clicking its destination -- the map's own gesture, the one
 * `src/screens/adventure/adventureView.ts`'s click handler turns into
 * `requestMove`. `__gameDebug.requestMove` is NOT used: the move is the click's
 * own effect, and the client's own `lastClick().moved` (a readout, never an
 * action) is the record that the CLICK produced it.
 */
async function moveByClick(page: Page, dest: Axial): Promise<void> {
  await clickHex(page, dest);
  const clicked = await page.evaluate(() =>
    (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.lastClick(),
  );
  assert.equal(
    (clicked as { moved?: boolean } | null)?.moved,
    true,
    `the click on (${dest.q},${dest.r}) must move the hero; lastClick=${JSON.stringify(clicked)}`,
  );
  await page.waitForFunction(
    ({ id, q, r }) => {
      const s = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as {
        heroes?: Record<string, { q: number; r: number }>;
      };
      return s?.heroes?.[id]?.q === q && s?.heroes?.[id]?.r === r;
    },
    { id: HERO_ID, q: dest.q, r: dest.r },
    { timeout: 20000 },
  );
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

/** A resource's stock on the settlement panel, as the player reads it. */
async function warehouseStock(page: Page, resource: string): Promise<number> {
  const text = await page.locator(`[data-warehouse-stock="${resource}"]`).first().innerText();
  return Number(text.replace(/[^0-9.-]/g, ""));
}

/**
 * Opens the settlement panel through the door a player standing on their own
 * settlement has: the toolbar's Settlements roster. A click on that hex is a
 * HERO gesture while a hero stands there (clickIntent.ts resolves your own hero
 * first), so the roster row is the way in -- and the panel is where the cargo
 * row lives.
 */
async function openSettlementPanel(page: Page, settlementName: string): Promise<void> {
  await page.locator("button").filter({ hasText: /Settlements/ }).first().click();
  await wait(700);
  const clicked = await page.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll("div")).filter(
      (d) =>
        getComputedStyle(d).cursor === "pointer" &&
        (d.textContent ?? "").includes(n),
    );
    rows.sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
    const row = rows[0];
    if (!row) return false;
    row.click();
    return true;
  }, settlementName);
  assert(clicked, `no roster row matched ${settlementName}`);
  await wait(800);
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

      // (1) Walk the hero onto the resource tile WITH THE MOUSE: select it by
      // clicking the hex it stands on, then click the deposit's hex. Both are
      // the real player gestures (adventureView's own click handler); no debug
      // action drives this leg, so a broken click-to-move path fails HERE.
      const before = await clientHero(page);
      assert(before, "no starting hero on the client");
      console.log(`>> hero starts at (${before!.q},${before!.r}), ${before!.movementRemaining} move`);
      await selectHeroByClick(page, { q: before!.q, r: before!.r });
      await moveByClick(page, fixture.tile);
      await wait(700);
      const serverHero = (await gameRow(name)).heroes[HERO_ID];
      assert.equal(
        `${serverHero.q},${serverHero.r}`,
        `${fixture.tile.q},${fixture.tile.r}`,
        "the hero must be ON the tile server-side too",
      );
      console.log(`>> hero walked onto (${fixture.tile.q},${fixture.tile.r}) -- client and server agree`);

      // (2) Inspect the hex: the tile panel shows the deposit AND its remaining
      // amount. One click on the hex inspects it; a click on a hero's own hex is
      // a toggle, so the selection is re-established explicitly (and left on for
      // the walk home below).
      await selectHeroByClick(page, fixture.tile);
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
      // The API's own payload carries the same two numbers, so DOM / API / DB
      // can be read side by side for one pickup.
      const afterApi = await apiGame(name);
      assert.equal(
        afterApi.resource_deposits?.[`${fixture.tile.q},${fixture.tile.r}`],
        fixture.pristine - expectedTake,
        "the API payload must carry the same remaining amount",
      );
      assert.equal(
        afterApi.heroes[HERO_ID].resources?.[fixture.resource] ?? 0,
        expectedTake,
        "the API payload must carry the same cargo",
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

      // (5) THE OTHER HALF (F-2): carry the cargo home and deliver it through
      // the settlement panel's Warehouse row. The walk home is the SAME mouse
      // gesture as the walk out -- the reload dropped the selection, so the hero
      // is re-selected by clicking its hex, then the settlement's hex is
      // clicked. No debug action and no mid-run DB poke: the fixture's movement
      // budget covers the whole round trip.
      const homeEntries = Object.entries((await gameRow(name)).settlements);
      const homePick = homeEntries.find(([, s]) => s.ownerId === 0) ?? homeEntries[0];
      assert(homePick, "the fixture game must own a settlement to deliver into");
      const [homeId, home] = homePick;
      const heroNow = await clientHero(page);
      assert(heroNow, "the hero must still be on the client after the reload");
      await selectHeroByClick(page, { q: heroNow!.q, r: heroNow!.r });
      await moveByClick(page, { q: home.q, r: home.r });
      await wait(700);
      const atHome = (await gameRow(name)).heroes[HERO_ID];
      assert.equal(
        `${atHome.q},${atHome.r}`,
        `${home.q},${home.r}`,
        "the hero must be standing ON its own settlement",
      );
      const carried = atHome.resources?.[fixture.resource] ?? 0;
      assert.equal(carried, expectedTake, "the hero carried the whole pickup home");

      await openSettlementPanel(page, home.name);
      const deliver = page.locator('[data-cargo-transfer="deposit"]').first();
      await deliver.waitFor({ state: "visible", timeout: 10000 });
      const stockBefore = await warehouseStock(page, fixture.resource);
      const deliverTitle = (await deliver.getAttribute("title")) ?? "";
      assert.equal(
        await deliver.isDisabled(),
        false,
        "a hero standing on its own settlement with cargo is offered the deposit",
      );
      assert.match(
        deliverTitle,
        new RegExp(`Move ${carried} of the hero's cargo into the warehouse`),
        `the button names what it will move, got "${deliverTitle}"`,
      );
      console.log(`>> panel: "${deliverTitle}"`);
      await deliver.click();
      let stockAfter = stockBefore;
      for (let i = 0; i < 20 && stockAfter !== stockBefore + carried; i++) {
        await wait(300);
        stockAfter = await warehouseStock(page, fixture.resource);
      }
      console.log(`>> delivered: warehouse ${fixture.resource} ${stockBefore} -> ${stockAfter} (carried ${carried})`);
      assert.equal(stockAfter, stockBefore + carried, "the whole hold must ARRIVE in the warehouse");

      // The panel is optimistic, so the ARRIVAL is only proven once the server
      // row carries it: the hook's POST is fire-and-forget.
      const expectedStock = stockBefore + carried;
      let persisted = -1;
      for (let i = 0; i < 25 && persisted !== expectedStock; i++) {
        await wait(400);
        persisted = (await gameRow(name)).settlements[homeId]?.warehouse?.[fixture.resource] ?? -1;
      }
      assert.equal(persisted, expectedStock, "the persisted warehouse must carry the delivery");
      // Same delivery, read off the API's own payload: the warehouse stock and
      // the emptied hold.
      const deliveredApi = await apiGame(name);
      assert.equal(
        deliveredApi.settlements[homeId]?.warehouse?.[fixture.resource] ?? -1,
        expectedStock,
        "the API payload must carry the delivered warehouse stock",
      );
      assert.equal(
        deliveredApi.heroes[HERO_ID].resources?.[fixture.resource] ?? 0,
        0,
        "the API payload must carry the emptied hold",
      );
      const deliveredRow = await gameRow(name);
      assert.equal(
        deliveredRow.heroes[HERO_ID].resources?.[fixture.resource] ?? 0,
        0,
        "and the wagons must be empty again",
      );
      const clientDelivered = await clientHero(page);
      assert.equal(
        clientDelivered?.resources?.[fixture.resource] ?? 0,
        0,
        "the client's hero agrees the hold is empty",
      );

      // (6) THE SAME DELIVERY, through the Logistics modal's OWN control -- the
      // surface the card's headline is about (a declared transferResources
      // action with no caller). The hold is loaded back out of the warehouse
      // through the settlement panel, then put back with the modal's button, so
      // the modal is measured doing real work against the real API rather than
      // merely rendering.
      const take = page.locator('[data-cargo-transfer="withdraw"]').first();
      await take.waitFor({ state: "visible", timeout: 10000 });
      const stockedBeforeModal = (await gameRow(name)).settlements[homeId]?.warehouse?.[fixture.resource] ?? -1;
      const takeTitle = (await take.getAttribute("title")) ?? "";
      assert.equal(await take.isDisabled(), false, "the warehouse has stock to take back out");
      console.log(`>> panel: "${takeTitle}"`);
      await take.click();
      let held = 0;
      for (let i = 0; i < 25 && held !== PER_RESOURCE_CAP; i++) {
        await wait(300);
        held = (await gameRow(name)).heroes[HERO_ID].resources?.[fixture.resource] ?? 0;
      }
      assert.equal(held, PER_RESOURCE_CAP, "the whole hold comes back out of the warehouse");
      assert.equal(
        (await gameRow(name)).settlements[homeId]?.warehouse?.[fixture.resource] ?? -1,
        stockedBeforeModal - PER_RESOURCE_CAP,
        "and the warehouse loses exactly that",
      );
      // The transfer buttons sum ACROSS the warehouse resources (one hold, five
      // piles), so the sentence names the total the click would move.
      const heldRow = (await gameRow(name)).heroes[HERO_ID].resources ?? {};
      const heldTotal = WAREHOUSE_RESOURCES.reduce((n, r) => n + (heldRow[r] ?? 0), 0);

      await page.keyboard.press("Escape").catch(() => {});
      await wait(500);
      const logisticsBtn = page.locator("button").filter({ hasText: /Logistics/ }).first();
      assert.equal(await logisticsBtn.isDisabled(), false, "the Logistics modal is reachable mid-game");
      await logisticsBtn.click();
      await wait(900);
      const modalDeposit = page.locator('[data-focus="hero-cargo-deposit"]').first();
      await modalDeposit.waitFor({ state: "visible", timeout: 10000 });
      assert.equal(
        await modalDeposit.isDisabled(),
        false,
        "the modal offers the deposit for a hero carrying cargo onto its own settlement",
      );
      const modalTitle = (await modalDeposit.getAttribute("title")) ?? "";
      assert.match(
        modalTitle,
        new RegExp(`Move ${heldTotal} of the hero's cargo into the warehouse`),
        `the modal names what it will move, got "${modalTitle}"`,
      );
      console.log(`>> logistics modal: "${modalTitle}"`);
      await modalDeposit.click();
      let restored = -1;
      for (let i = 0; i < 25 && restored !== stockedBeforeModal; i++) {
        await wait(400);
        restored = (await gameRow(name)).settlements[homeId]?.warehouse?.[fixture.resource] ?? -1;
      }
      assert.equal(restored, stockedBeforeModal, "the Logistics modal's own button must move the warehouse");
      assert.equal(
        (await gameRow(name)).heroes[HERO_ID].resources?.[fixture.resource] ?? 0,
        0,
        "and empty the hold again",
      );
      const modalApi = await apiGame(name);
      assert.equal(
        modalApi.settlements[homeId]?.warehouse?.[fixture.resource] ?? -1,
        stockedBeforeModal,
        "the API payload carries the modal's delivery",
      );
      console.log(`>> logistics modal deposit: warehouse ${fixture.resource} ${stockedBeforeModal - PER_RESOURCE_CAP} -> ${restored} (moved ${heldTotal} across the hold)`);

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
