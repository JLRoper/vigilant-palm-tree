import { chromium, type Page } from "playwright";
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

// Hero-to-hero field trading (Playwright + real API + real DB). The trade
// panel is a DRAG surface, so this suite drives the real gestures: a resource
// chip and an army tile dragged across the two columns, then one Confirm that
// must land BOTH offers on the server in a single command.
//
//  (A) two adjacent heroes of one seat: the hero panel's Trade button names
//      the partner and opens the panel with both heroes side by side;
//  (B) drag wood from the left hero onto the right column -> staged as that
//      hero's offer; drag the right hero's gold and its archer platoon left ->
//      staged as the right hero's offer;
//  (C) Confirm: the server row and the client state both show the exact swap
//      (gold up, wood gone, platoons exchanged), and the panel cleared;
//  (D) a trade the hero cannot pay for is a 409 from the real command route
//      and leaves the row untouched.
//
// The game is created and deleted by exact name (never a table sweep).

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_NAME = "hero-field-trade-e2e";
const GAME_SEED = 909090;
const HERO_ID = "p0-hero";
const PARTNER_ID = "p0-hero2";

interface Axial { q: number; r: number }
interface Tile extends Axial { terrain: string }

interface HeroRow {
  id?: string;
  name?: string;
  ownerId: number;
  q: number;
  r: number;
  gold: number;
  resources?: Record<string, number>;
  stacks?: { entries: { unitTypeId: string; count: number }[] }[];
  treasuryWagons?: number;
  wagons?: number;
}

interface GameRowShape {
  players: Array<{ id: number; heroIds?: string[] }>;
  heroes: Record<string, HeroRow>;
  settlements: Record<string, { ownerId: number | null; q: number; r: number }>;
}

const HEX_DIRECTIONS: Axial[] = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];
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
setTimeout(() => { console.error(">> heroTrade.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

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
  const r = await db.query(`SELECT players, heroes, settlements FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

async function tilesOf(name: string): Promise<Tile[]> {
  const res = await api("GET", `/api/games/${name}/tiles`);
  assert.equal(res.status, 200, `tiles ${name} -> ${res.status}`);
  return res.json as Tile[];
}

function unitsByType(hero: HeroRow): Record<string, number> {
  const out: Record<string, number> = {};
  for (const platoon of hero.stacks ?? []) {
    for (const entry of platoon.entries ?? []) {
      out[entry.unitTypeId] = (out[entry.unitTypeId] ?? 0) + entry.count;
    }
  }
  return out;
}

// Seat 0's starting hero, plus a SECOND hero for the same seat on an adjacent
// passable tile with its own holdings, so the pair can trade in the field.
async function seedFieldPair(name: string): Promise<{ gameId: string; partnerTile: Axial }> {
  await api("DELETE", `/api/games/${name}`);
  const created = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 0 });
  assert.equal(created.status, 201, `create ${name} -> ${created.status}`);

  const row = await gameRow(name);
  const hero = row.heroes[HERO_ID];
  assert(hero, `hero ${HERO_ID} missing in ${name}`);
  const occupied = new Set([
    `${hero.q},${hero.r}`,
    ...Object.values(row.settlements).map((s) => `${s.q},${s.r}`),
  ]);
  const neighbour = (await tilesOf(name)).find((t) =>
    HEX_DIRECTIONS.some((d) => d.q + hero.q === t.q && d.r + hero.r === t.r) &&
    !IMPASSABLE.has(t.terrain) &&
    !occupied.has(`${t.q},${t.r}`),
  );
  assert(neighbour, "no passable tile adjacent to the starting hero");

  const heroes = JSON.parse(JSON.stringify(row.heroes)) as Record<string, HeroRow>;
  heroes[HERO_ID] = {
    ...heroes[HERO_ID],
    gold: 1200,
    resources: { wood: 250, stone: 0, iron: 0, arcane: 0, food: 0 },
    // 5 cargo wagons (250 per resource -- the wood stack sat exactly at that
    // cap, so the PARTNER needs its own empty cargo to receive it) and 5
    // treasury carts (2,500g purse).
    wagons: 5,
    treasuryWagons: 5,
    stacks: [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }],
  };
  heroes[PARTNER_ID] = {
    ...heroes[HERO_ID],
    id: PARTNER_ID,
    name: "Borin",
    q: neighbour.q,
    r: neighbour.r,
    trail: [{ q: neighbour.q, r: neighbour.r }],
    gold: 200,
    resources: { wood: 0, stone: 0, iron: 40, arcane: 0, food: 0 },
    stacks: [{ entries: [{ unitTypeId: "archer", count: 4 }] }],
  };
  const players = JSON.parse(JSON.stringify(row.players)) as GameRowShape["players"];
  const seat0 = players.find((p) => p.id === 0);
  assert(seat0, "seat 0 missing");
  seat0.heroIds = [...(seat0.heroIds ?? []), PARTNER_ID];

  await db.query(
    `UPDATE games SET heroes = $1::jsonb, players = $2::jsonb, updated_at = now() WHERE name = $3`,
    [JSON.stringify(heroes), JSON.stringify(players), name],
  );
  return { gameId: created.json.id, partnerTile: { q: neighbour.q, r: neighbour.r } };
}

// Open the game in the browser (the Load Game flow, then the map). Copied from
// the sibling suites: the whole app draws into ONE canvas, so the game is
// loaded through the home overlay's Load Game list and the map is reached via
// __gameDebug rather than DOM geometry.
async function openGame(page: Page, name: string, gameId: string): Promise<void> {
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

/**
 * A real mouse drag: down on the source, a couple of moves so Chromium starts
 * its HTML5 drag session, then onto the target and up. This is the gesture the
 * panel is built for, so the suite drives it rather than dispatching events.
 */
async function dragOnto(page: Page, fromSel: string, toSel: string): Promise<void> {
  const from = page.locator(fromSel).first();
  const to = page.locator(toSel).first();
  await from.waitFor({ state: "visible", timeout: 10000 });
  await to.waitFor({ state: "visible", timeout: 10000 });
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  assert(a && b, `drag endpoints not measurable: ${fromSel} -> ${toSel}`);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2 + 1, { steps: 2 });
  await page.mouse.up();
  await wait(120);
}

async function stagedAmount(page: Page, side: "give" | "take", key: string): Promise<number | null> {
  const row = page.locator(`[data-trade-staged="${key}"][data-trade-side="${side}"]`).first();
  if ((await row.count()) === 0) return null;
  const text = await row.locator("[data-trade-staged-amount]").first().innerText();
  return Number(text);
}

async function clientHeroes(page: Page): Promise<Record<string, HeroRow>> {
  return page.evaluate(() => {
    const s = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.() as
      | { heroes?: Record<string, HeroRow> }
      | undefined;
    return s?.heroes ?? {};
  });
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

    const { gameId } = await seedFieldPair(name);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openGame(page, name, gameId);

      // (A) Select the hero: the hero panel's Trade button names the adjacent
      // partner hero and opens the two-hero panel.
      await page.evaluate((id) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero(id), HERO_ID);
      const tradeOpen = page.locator("[data-hero-trade-open]").first();
      await tradeOpen.waitFor({ state: "visible", timeout: 15000 });
      await page.waitForFunction(
        () => (document.querySelector("[data-hero-trade-open]") as HTMLButtonElement | null)?.disabled === false,
        undefined,
        { timeout: 15000 },
      );
      const openLabel = await tradeOpen.innerText();
      assert.match(openLabel, /Borin/, `hero panel Trade button must name the partner, got "${openLabel}"`);
      await tradeOpen.click();
      await page.locator('[data-trade-column="give"]').first().waitFor({ state: "visible", timeout: 15000 });
      console.log(">> trade panel open with both heroes side by side");

      // (A2) The footer (status + Clear + Confirm) is a child of the panel ROOT,
      // not of its scrolling body, and the panel places itself inside the
      // viewport: Confirm is never below the fold on a short window.
      assert.equal(
        await page.locator("[data-panel-body] [data-trade-confirm]").count(),
        0,
        "Confirm must not live inside the scrolling body",
      );
      assert.equal(
        await page.locator("[data-trade-footer] [data-trade-confirm]").count(),
        1,
        "the pinned footer owns Confirm",
      );
      const confirmBox = await page.locator("[data-trade-confirm]").first().boundingBox();
      assert(confirmBox, "Confirm has a measurable box");
      assert(
        confirmBox!.y + confirmBox!.height <= 800 && confirmBox!.y >= 0,
        `Confirm must sit inside the 800px viewport (y ${confirmBox!.y}, bottom ${confirmBox!.y + confirmBox!.height})`,
      );

      const names = await clientHeroes(page);
      const giveName = await page.locator('[data-trade-column="give"]').first().locator("div").first().innerText();
      const takeName = await page.locator('[data-trade-column="take"]').first().locator("div").first().innerText();
      assert.equal(giveName, names[HERO_ID]?.name, "left column must be the selected hero");
      assert.equal(takeName, "Borin", "right column must be the adjacent partner");
      const woodHeld = await page.locator('[data-trade-holding="res:wood"][data-trade-side="give"]').first().getAttribute("data-trade-holding-amount");
      assert.equal(woodHeld, "250", "left column must show the hero's live wood");
      const partnerGold = await page.locator('[data-trade-holding="gold"][data-trade-side="take"]').first().getAttribute("data-trade-holding-amount");
      assert.equal(partnerGold, "200", "right column must show the partner's live gold");

      // (B) Drag across the middle: wood right, then the partner's gold and
      // archer platoon back left, plus the hero's own swordsmen right.
      await dragOnto(page, '[data-trade-holding="res:wood"][data-trade-side="give"]', '[data-trade-column="take"]');
      assert.equal(await stagedAmount(page, "give", "res:wood"), 250, "dragging wood across must stage the whole stack");
      await dragOnto(page, '[data-trade-holding="gold"][data-trade-side="take"]', '[data-trade-column="give"]');
      assert.equal(await stagedAmount(page, "take", "gold"), 200, "dragging the partner's gold across must stage it");
      await dragOnto(page, '[data-trade-army="take"] > div:nth-child(1)', '[data-trade-army="give"] > div:nth-child(1)');
      assert.equal(await stagedAmount(page, "take", "unit:archer"), 4, "dragging a platoon across must stage every unit of it");
      await dragOnto(page, '[data-trade-army="give"] > div:nth-child(1)', '[data-trade-army="take"] > div:nth-child(1)');
      assert.equal(await stagedAmount(page, "give", "unit:swordsman"), 5, "the hero's own platoon staged the same way");
      // The stepper adjusts a staged amount without touching the rest.
      await page.locator('[data-trade-staged="unit:archer"][data-trade-side="take"] [data-trade-step="down"]').first().click();
      assert.equal(await stagedAmount(page, "take", "unit:archer"), 3, "the − stepper must lower the staged amount");
      await page.locator('[data-trade-staged="unit:archer"][data-trade-side="take"] [data-trade-step="up"]').first().click();
      assert.equal(await stagedAmount(page, "take", "unit:archer"), 4, "the + stepper must raise it back");
      console.log(">> both offers staged by real drags");

      // (C) Confirm: one command, both offers, applied whole.
      const [confirmResponse] = await Promise.all([
        page
          .waitForResponse((r) => r.url().includes("/commands") && r.request().method() === "POST", { timeout: 20000 })
          .catch(() => null),
        page.locator("[data-trade-confirm]").first().click(),
      ]);
      if (confirmResponse) {
        console.log(`>> confirm POST -> ${confirmResponse.status()} ${await confirmResponse.text().catch(() => "")}`);
      } else {
        const status = await page.locator("[data-trade-status]").first().innerText().catch(() => "");
        console.log(`>> confirm sent no command; panel status: "${status}"`);
      }

      const deadline = Date.now() + 20000;
      let row: GameRowShape | null = null;
      while (Date.now() < deadline) {
        await wait(400);
        const r = await gameRow(name);
        if (r.heroes[PARTNER_ID]?.gold === 0) { row = r; break; }
      }
      assert(row, "the trade never reached the server row");
      const giver = row!.heroes[HERO_ID];
      const partner = row!.heroes[PARTNER_ID];
      assert.equal(giver.gold, 1400, "the hero keeps 1,200 and receives 200");
      assert.equal(partner.gold, 0, "the partner handed its whole purse over");
      assert.equal(giver.resources?.wood ?? 0, 0, "the hero's wood left with the offer");
      assert.equal(partner.resources?.wood ?? 0, 250, "the partner received the wood");
      assert.equal(partner.resources?.iron ?? 0, 40, "an unstaged resource never moves");
      assert.deepEqual(unitsByType(giver), { archer: 4 }, "the hero's swordsmen left and the archers arrived");
      assert.deepEqual(unitsByType(partner), { swordsman: 5 }, "the partner's archers left and the swordsmen arrived");
      console.log(">> server row carries the exact swap");

      // The client merged the same swap (it applied it optimistically, and the
      // server echo must agree).
      let client: Record<string, HeroRow> = {};
      const clientDeadline = Date.now() + 15000;
      while (Date.now() < clientDeadline) {
        client = await clientHeroes(page);
        if (client[HERO_ID]?.gold === 1400 && client[PARTNER_ID]?.gold === 0) break;
        await wait(300);
      }
      assert.equal(client[HERO_ID]?.gold, 1400, "client hero gold after the trade");
      assert.equal(client[PARTNER_ID]?.gold, 0, "client partner gold after the trade");
      assert.deepEqual(unitsByType(client[HERO_ID]), { archer: 4 }, "client hero army after the trade");
      assert.deepEqual(unitsByType(client[PARTNER_ID]), { swordsman: 5 }, "client partner army after the trade");

      // The panel cleared its staging and said so.
      assert.equal(await page.locator("[data-trade-staged]").count(), 0, "staged rows must clear after the trade");
      const status = await page.locator("[data-trade-status]").first().innerText();
      assert.match(status, /Traded/i, `status line after the trade, got "${status}"`);
      const afterWood = await page.locator('[data-trade-holding="res:wood"][data-trade-side="give"]').first().getAttribute("data-trade-holding-amount");
      assert.equal(afterWood, "0", "the left column's readout must follow the trade");

      // (D) A trade the hero cannot pay for is refused by the real command
      // route, and the row is untouched.
      const refused = await api("POST", `/api/games/${name}/commands`, {
        kind: "TradeHeroes",
        actor: 0,
        heroId: HERO_ID,
        partnerId: PARTNER_ID,
        give: { gold: 99999 },
        take: {},
      });
      assert.equal(refused.status, 409, `over-spending trade -> ${refused.status}`);
      assert.equal(refused.json?.error, "not_enough_gold", "server reason for an unaffordable offer");
      const after = await gameRow(name);
      assert.equal(after.heroes[HERO_ID].gold, 1400, "a refused trade must not move anything");
      assert.equal(after.heroes[PARTNER_ID].gold, 0, "a refused trade must not move anything (partner)");
      console.log(">> unaffordable trade refused, row untouched");

      // (E) A swap that would strip a hero of its whole army is refused — in
      // the panel (before Confirm is even clickable) and by the server.
      const giverName = (await clientHeroes(page))[HERO_ID]?.name ?? "";
      await dragOnto(page, '[data-trade-army="give"] > div:nth-child(1)', '[data-trade-army="take"] > div:nth-child(1)');
      assert.equal(await stagedAmount(page, "give", "unit:archer"), 4, "the hero's whole army is staged");
      assert.equal(
        await page.locator("[data-trade-confirm]").first().isDisabled(),
        true,
        "Confirm is refused while the trade would leave an army-less hero",
      );
      const blocked = await page.locator("[data-trade-status]").first().innerText();
      assert.match(blocked, /no troops/i, `the panel explains the army rule, got "${blocked}"`);
      assert.ok(blocked.includes(giverName), `the reason names the hero, got "${blocked}"`);
      await page.locator('[data-trade-staged="unit:archer"][data-trade-side="give"] [data-trade-unstage]').first().click();
      assert.equal(await page.locator("[data-trade-staged]").count(), 0, "the staged platoon came off the table again");
      const cleared = await page.locator("[data-trade-status]").first().innerText();
      assert.doesNotMatch(cleared, /no troops/i, `the warning clears with the staging, got "${cleared}"`);

      const emptied = await api("POST", `/api/games/${name}/commands`, {
        kind: "TradeHeroes",
        actor: 0,
        heroId: HERO_ID,
        partnerId: PARTNER_ID,
        give: { units: [{ unitTypeId: "archer", count: 4 }] },
        take: {},
      });
      assert.equal(emptied.status, 409, `army-emptying trade -> ${emptied.status}`);
      assert.equal(
        emptied.json?.error,
        "would_be_left_without_troops",
        "server reason for an army-emptying trade",
      );
      const afterEmpty = await gameRow(name);
      assert.equal(unitsByType(afterEmpty.heroes[HERO_ID]).archer, 4, "a refused army-emptying trade moves nothing");
      console.log(">> army-emptying trade refused by both the panel and the server");

      // A malformed body (a fractional amount) is a transport-level 400.
      const malformed = await api("POST", `/api/games/${name}/commands`, {
        kind: "TradeHeroes",
        actor: 0,
        heroId: HERO_ID,
        partnerId: PARTNER_ID,
        give: { gold: 1.5 },
        take: {},
      });
      assert.equal(malformed.status, 400, `malformed offer -> ${malformed.status}`);

      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
    console.log(">> heroTrade.e2e: ALL TESTS PASSED");
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
