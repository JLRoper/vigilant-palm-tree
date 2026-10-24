import { chromium, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import { SETTLERS_MODE_DEFAULTS, coveredWagonIdFor, hexDistance } from "@heroes/contracts";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

// The settlers mode's founding gesture, end-to-end in a real browser
// (SETTLERS-PLAN.md §4 W6, phase 1's exit condition): a settlers game creates,
// places its wagon start and FOUNDS A SETTLEMENT through the shipped client,
// driven by real mouse interaction -- the wagon is selected by clicking its own
// hex, the gesture is armed by clicking the toolbar's button, and the
// settlement is planted by clicking that hex again. Nothing here dispatches a
// synthetic event or calls a debug hook to make the founding happen.
//
//  (A) POST /games {gameMode:"settlers"} stores the mode and seeds bare
//      wilderness with one covered wagon per seat (the entity-seeding pass);
//  (B) the client loads that game and the toolbar tells the truth about the
//      mode: the settle button reads "Found Settlement" and arms the founding
//      gesture instead of the classic charter flow;
//  (C) a click on a hex the gesture does not cover is refused with the
//      engine's own `found_invalid` (the gesture stays armed);
//  (D) a click on the wagon's own hex founds the settlement: the client state
//      and the server row both carry the town, the wagon is consumed, and the
//      mode's supplies are its warehouse;
//  (E) the classic control: the same button reads "Charter Settlement" and
//      opens the charter requirements modal -- no founding gesture exists in a
//      classic game.
//
// Both games are created and deleted by exact name (never a table sweep).

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_NAME = "settlers-e2e";
const CLASSIC_NAME = "settlers-classic-e2e";
const GAME_SEED = 4242;
const CLASSIC_SEED = 4243;
const WAGON_ID = coveredWagonIdFor(0);
const FOUND_BUTTON_LABEL = "Found Settlement";
const CLASSIC_BUTTON_LABEL = "Charter Settlement";
const ARMED_TITLE = "Click your wagon's highlighted hex to plant its settlement";
const UNARMED_TITLE = "Select your covered wagon, then plant its settlement where it stands (one per wagon)";

interface Axial { q: number; r: number }
interface Tile extends Axial { terrain: string }

interface GameRowShape {
  id: number;
  seed: number;
  players: Array<{ id: number; heroIds: string[]; settlementIds: string[] }>;
  heroes: Record<
    string,
    { id: string; ownerId: number; q: number; r: number; troops: number; resources?: Record<string, number> }
  >;
  settlements: Record<
    string,
    { id: string; name?: string; ownerId: number | null; q: number; r: number; level?: number; warehouse?: Record<string, number> }
  >;
  lobby: { gameMode?: string } | null;
}

interface ClientState {
  gameMode?: string;
  selectedHeroId?: string | null;
  heroes: Record<string, { id: string; ownerId: number; q: number; r: number }>;
  settlements: Record<
    string,
    { id: string; name: string; ownerId: number | null; q: number; r: number; level: number; warehouse?: Record<string, number> }
  >;
  players: Array<{ id: number; heroIds: string[]; settlementIds: string[] }>;
}

const IMPASSABLE = new Set(["water", "mountain"]);

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
setTimeout(() => { console.error(">> settlers.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

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

async function gameRow(name: string): Promise<GameRowShape> {
  const r = await db.query(
    `SELECT id, seed, players, heroes, settlements, lobby FROM games WHERE name = $1`,
    [name],
  );
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0] as GameRowShape;
}

async function tilesOf(name: string): Promise<Tile[]> {
  const res = await api("GET", `/api/games/${name}/tiles`);
  assert.equal(res.status, 200, `tiles ${name} -> ${res.status}`);
  return res.json as Tile[];
}

async function foundedEventCount(name: string): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM game_events e JOIN games g ON g.id = e.game_id
      WHERE g.name = $1 AND e.kind = 'SettlementFounded'`,
    [name],
  );
  return r.rows[0].n as number;
}

async function granularWagonRowCount(name: string): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM heroes h JOIN games g ON g.id = h.game_id
      WHERE g.name = $1 AND h.id = $2`,
    [name, WAGON_ID],
  );
  return r.rows[0].n as number;
}

/** Create a game by exact name and return its row (the API's own creation path). */
async function createGame(name: string, seed: number, gameMode?: "settlers"): Promise<GameRowShape> {
  await api("DELETE", `/api/games/${name}`);
  const res = await api("POST", "/api/games", {
    name, seed, humanSlots: 1, enemySlots: 0, ...(gameMode ? { gameMode } : {}),
  });
  assert.equal(res.status, 201, `create ${name} -> ${res.status} ${JSON.stringify(res.json)}`);
  return await gameRow(name);
}

// Open the game in the browser (the Load Game flow, then the map). Copied from
// the sibling suites: the whole app draws into ONE canvas, so the game is
// loaded through the home overlay's Load Game list and the map is reached via
// __gameDebug rather than DOM geometry.
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
    assert(clicked, `no Open row matched ${name}`);
  }
  await page.waitForFunction((n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === n, name, { timeout: 30000 });
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

function clientState(page: Page): Promise<ClientState> {
  return page.evaluate(() => {
    const gs = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.() as unknown as ClientState | undefined;
    return gs as ClientState;
  });
}

function lastClickReason(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const c = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.lastClick as { reason?: string } | null;
    return c?.reason;
  });
}

function selectedHeroId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const s = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as { selectedHeroId?: string | null } | undefined;
    return s?.selectedHeroId ?? null;
  });
}

function screenOf(page: Page, tile: Axial): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (t) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.screenFor(t.q, t.r),
    tile,
  );
}

/**
 * A real click on a map hex: hover there first (the click resolver reads the
 * hovered tile), then press and release without moving -- a click, not a drag.
 */
async function clickHex(page: Page, tile: Axial): Promise<void> {
  const pt = await screenOf(page, tile);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await wait(80);
  await page.mouse.click(pt.x, pt.y);
  await wait(350);
}

/** The toolbar's settle button, by its mode's own copy. */
function settleButton(page: Page, label: string) {
  return page.locator("button").filter({ hasText: label }).first();
}

/** Read a hex off the map, with a screen position that is safely on the map area. */
async function pickFarHex(page: Page, tiles: Tile[], from: Axial): Promise<Axial> {
  const candidates = tiles.filter((t) =>
    !IMPASSABLE.has(t.terrain) &&
    hexDistance(t, from) >= 2 && hexDistance(t, from) <= 3);
  for (const t of candidates) {
    const pt = await screenOf(page, t);
    if (pt.x > 300 && pt.x < 1000 && pt.y > 250 && pt.y < 620) return { q: t.q, r: t.r };
  }
  assert.fail("no passable hex 2-3 tiles from the wagon landed inside the map area");
}

async function main(): Promise<void> {
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);
    console.log(">> api + web up");

    // (A) The mode at creation: bare wilderness, one wagon per seat, neutrals kept.
    const settlers = await createGame(GAME_NAME, GAME_SEED, "settlers");
    assert.equal(settlers.lobby?.gameMode, "settlers", "the mode rides the lobby jsonb (no column, no migration)");
    assert.deepEqual(
      Object.values(settlers.settlements).filter((s) => s.ownerId !== null).map((s) => s.id),
      [],
      "a settlers seat must not start with a pre-existing town (§2.1: entity seeding, not terrain)",
    );
    const neutrals = Object.values(settlers.settlements).filter((s) => s.ownerId === null);
    assert.ok(neutrals.length > 0, "the neutral castles are still capture objectives (design answer 4)");
    for (const player of settlers.players) {
      assert.deepEqual(player.heroIds, [coveredWagonIdFor(player.id)], "the seat's roster entry IS its wagon");
      assert.deepEqual(player.settlementIds, [], "no starting settlement list");
    }
    const wagon = settlers.heroes[WAGON_ID];
    assert.ok(wagon, `seat 0 must own its wagon (${WAGON_ID})`);
    assert.equal(wagon.troops, 0, "a wagon carries no army");
    assert.deepEqual(wagon.resources, SETTLERS_MODE_DEFAULTS.wagonSupplies, "the mode's supplies ride as cargo");
    const wagonHex: Axial = { q: wagon.q, r: wagon.r };
    console.log(`>> settlers game created: wagon ${WAGON_ID} at ${wagonHex.q},${wagonHex.r}, ${neutrals.length} neutral castles, seat towns 0`);

    const tiles = await tilesOf(GAME_NAME);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openGame(page, GAME_NAME, settlers.id);

      // (B) The client knows the game's mode.
      const loaded = await clientState(page);
      assert.equal(loaded.gameMode, "settlers", "the loaded client state must carry the mode (hydrateClientGame maps lobby.gameMode)");
      const foundBtn = settleButton(page, FOUND_BUTTON_LABEL);
      await foundBtn.waitFor({ state: "visible", timeout: 15000 });
      assert.equal(
        await settleButton(page, CLASSIC_BUTTON_LABEL).count(),
        0,
        "a settlers game must not offer the classic charter copy",
      );

      // The wagon is selected by a REAL click on its own hex.
      await clickHex(page, wagonHex);
      assert.equal(await lastClickReason(page), "select", "clicking the wagon's hex selects it");
      assert.equal(await selectedHeroId(page), WAGON_ID, "the covered wagon is the selected entity");
      assert.equal(await foundBtn.isDisabled(), false, "the settle button is live with the wagon selected");

      // Arming the gesture: a real click on the toolbar button.
      await foundBtn.click();
      await wait(500);
      assert.equal(await foundBtn.getAttribute("title"), ARMED_TITLE, "the armed gesture says what to click");
      assert.deepEqual(
        Object.values((await clientState(page)).settlements).filter((s) => s.ownerId === 0).map((s) => s.id),
        [],
        "arming the gesture must not plant anything on its own",
      );
      console.log(">> the settle button armed the founding gesture");

      // (C) A hex the gesture does not cover is refused, and the gesture stays armed.
      const far = await pickFarHex(page, tiles, wagonHex);
      await clickHex(page, far);
      assert.equal(
        await lastClickReason(page),
        "found_invalid",
        `a click on ${far.q},${far.r} while armed must resolve to found_invalid, got "${await lastClickReason(page)}"`,
      );
      assert.equal(await foundBtn.getAttribute("title"), ARMED_TITLE, "a refused click keeps the gesture armed");
      assert.equal(await granularWagonRowCount(GAME_NAME), 0, "the refused click created no hero row");
      console.log(`>> a click on ${far.q},${far.r} was refused (found_invalid); nothing was planted`);

      // (D) The founding: a real click on the wagon's own hex.
      await clickHex(page, wagonHex);
      assert.equal(await lastClickReason(page), "settlement_founded", "the founding click must resolve to the founding gesture");
      assert.equal(await foundBtn.getAttribute("title"), UNARMED_TITLE, "founding disarms the gesture");

      const after = await clientState(page);
      const clientFounded = Object.values(after.settlements).find((s) => s.ownerId === 0 && s.q === wagonHex.q && s.r === wagonHex.r);
      assert.ok(clientFounded, `the client state must carry the new settlement at ${wagonHex.q},${wagonHex.r}`);
      assert.ok(!after.heroes[WAGON_ID], "the consumed wagon must leave the client's hero record");
      assert.deepEqual(
        after.players[0].settlementIds,
        [clientFounded!.id],
        "the seat's roster carries the new town",
      );
      assert.deepEqual(
        clientFounded!.warehouse,
        SETTLERS_MODE_DEFAULTS.wagonSupplies,
        "the town's warehouse is the cargo the wagon carried",
      );
      assert.equal(after.players[0].heroIds.includes(WAGON_ID), false, "the consumed wagon leaves the seat's roster");
      console.log(`>> founded ${clientFounded!.name} (${clientFounded!.id}) at ${wagonHex.q},${wagonHex.r} — client state agrees`);

      // The server row carries the same founding (poll: the command's POST is
      // fire-and-forget on the client).
      let row = await gameRow(GAME_NAME);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        row = await gameRow(GAME_NAME);
        if (Object.values(row.settlements).some((s) => s.ownerId === 0 && s.q === wagonHex.q && s.r === wagonHex.r)) break;
        await wait(400);
      }
      const serverFounded = Object.values(row.settlements).find((s) => s.ownerId === 0 && s.q === wagonHex.q && s.r === wagonHex.r);
      assert(serverFounded, "the founding never reached the games row");
      assert.equal(serverFounded!.name, clientFounded!.name, "the server and the client agree on the town's name");
      assert.deepEqual(serverFounded!.warehouse, SETTLERS_MODE_DEFAULTS.wagonSupplies, "the persisted warehouse is the mode's supplies");
      assert.equal(row.heroes[WAGON_ID], undefined, "the consumed wagon must be gone from the games row");
      assert.deepEqual(row.players[0].settlementIds, [serverFounded!.id], "the persisted roster carries the new town");
      assert.equal(await foundedEventCount(GAME_NAME), 1, "exactly one SettlementFounded event");
      assert.equal(await granularWagonRowCount(GAME_NAME), 0, "the removed wagon must not survive in the granular heroes table");
      console.log(">> server row, roster, event log and the granular heroes table agree");

      // (E) The classic control: the same button is the charter flow, and no
      // founding gesture exists there.
      const classic = await createGame(CLASSIC_NAME, CLASSIC_SEED);
      await openGame(page, CLASSIC_NAME, classic.id);
      const classicBtn = settleButton(page, CLASSIC_BUTTON_LABEL);
      await classicBtn.waitFor({ state: "visible", timeout: 15000 });
      assert.equal(
        await settleButton(page, FOUND_BUTTON_LABEL).count(),
        0,
        "a classic game must keep the charter copy (the mode gates the label)",
      );
      const classicWagon = classic.heroes[WAGON_ID];
      assert.ok(!classicWagon, "classic mode starts a seat with a commander, not a wagon");
      const classicHero = classic.heroes["p0-hero"];
      assert.ok(classicHero, "classic seat 0 starts with its commander");
      const classicHex: Axial = { q: classicHero.q, r: classicHero.r };
      await clickHex(page, classicHex);
      assert.equal(await selectedHeroId(page), "p0-hero", "the classic commander is selectable");
      const classicSettlementsBefore = Object.keys((await clientState(page)).settlements).sort();
      await classicBtn.click();
      await wait(500);
      const modal = page.locator("text=Charter a New Settlement").first();
      await modal.waitFor({ state: "visible", timeout: 10000 });
      await page.keyboard.press("Escape");
      await wait(400);
      // With no founding gesture armed, the same hex click is a plain selection
      // change -- never a founding.
      await clickHex(page, classicHex);
      const classicReason = await lastClickReason(page);
      assert.notEqual(classicReason, "settlement_founded", "a classic game must never found through the settlers gesture");
      // The classic game starts WITH a town under the commander (its own
      // castle), so the assertion is that the set did not MOVE: no founding
      // happened, and the click left the world alone.
      const classicState = await clientState(page);
      assert.deepEqual(
        Object.keys(classicState.settlements).sort(),
        classicSettlementsBefore,
        "the classic game's settlement set changed -- a founding must be impossible here",
      );
      console.log(`>> classic control: the button opened the charter modal and the hex click stayed "${classicReason}"`);

      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
    console.log(">> settlers.e2e: ALL TESTS PASSED");
  } finally {
    await api("DELETE", `/api/games/${GAME_NAME}`).catch(() => {});
    await api("DELETE", `/api/games/${CLASSIC_NAME}`).catch(() => {});
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error("TEST FAILED:", err); cleanup(); process.exit(1); },
);
