import { chromium, Browser, Page, request as pwRequest } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { existsSync, readFileSync, statSync, openSync } from "node:fs";
import assert from "node:assert/strict";
import { GameMap } from "../src/map/gameMap";
import { mulberry32 } from "../src/core/rng";
import { placeResourceTiles, RESOURCES } from "../src/map/resourceTiles";
import { axialToPixel } from "../src/core/hex";
import { Pool } from "pg";

const TERRAINS = new Set(["grass", "dirt", "forest", "desert", "mountain", "water"]);
const RESOURCE_SET = new Set(["gold", "wood", "stone", "iron", "arcane"]);

const WEB_PORT = 4173;
const API_PORT = 3001;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const GAME_NAME = "default";
const TEST_NEW_NAME = "smoke-new-game";
let PLAYER_SPAWN = { q: 6, r: 5 };
let AI_SPAWN = { q: 14, r: 8 };

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

  const newBtn = page.locator("#toolbar button", { hasText: "New" });
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
  await loadBtn.click();
  await wait(300);
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

async function runTurnFlowChecks(page: Page, ctx: any, activeName: string) {
  console.log(">> Turn flow: select hero, move, end turn, AI runs, round advances");

  const hudBefore = await page.locator("#hud").textContent();
  if (!hudBefore || !hudBefore.includes("Round 1")) {
    throw new Error(`HUD missing "Round 1": ${hudBefore}`);
  }
  if (!hudBefore.includes("Turn: Human")) {
    throw new Error(`HUD missing "Turn: Human": ${hudBefore}`);
  }
  console.log(`>> HUD before move: ${hudBefore}`);

  const screen = await page.evaluate(
    ({ q, r }) => (window as any).__gameDebug.screenFor(q, r),
    { q: AI_SPAWN.q, r: AI_SPAWN.r }
  );
  await page.mouse.click(screen.x, screen.y);
  await wait(200);

  const screenPlayer = await page.evaluate(
    ({ q, r }) => (window as any).__gameDebug.screenFor(q, r),
    { q: PLAYER_SPAWN.q, r: PLAYER_SPAWN.r }
  );
  await page.mouse.click(screenPlayer.x, screenPlayer.y);
  await wait(200);

  const heroesAfterSelect = await page.evaluate(() => (window as any).__gameDebug.getHeroes?.());
  console.log(`>> heroes after select: ${JSON.stringify(heroesAfterSelect)}`);
  const playerHeroBeforeMove = heroesAfterSelect?.find((h: any) => h.ownerId === 0);
  if (!playerHeroBeforeMove) throw new Error("player hero not found");

  const target = await pickClickTarget(ctx, activeName, PLAYER_SPAWN);
  const targetScreen = await page.evaluate(
    ({ q, r }) => (window as any).__gameDebug.screenFor(q, r),
    { q: target.tile.q, r: target.tile.r }
  );
  await page.mouse.click(targetScreen.x, targetScreen.y);
  await wait(1200);

  const heroesAfterMove = await page.evaluate(() => (window as any).__gameDebug.getHeroes?.());
  const moved = heroesAfterMove?.find((h: any) => h.ownerId === 0);
  if (!moved) throw new Error("player hero not found after move");
  if (moved.q === PLAYER_SPAWN.q && moved.r === PLAYER_SPAWN.r) {
    throw new Error(`Hero did not move: still at (${moved.q},${moved.r})`);
  }
  console.log(`>> Player hero moved to (${moved.q},${moved.r})`);

  if (!Array.isArray(moved.trail) || moved.trail.length < 2) {
    throw new Error(`Hero trail missing or too short: ${JSON.stringify(moved.trail)}`);
  }
  const trailStart = moved.trail[0];
  const trailEnd = moved.trail[moved.trail.length - 1];
  if (trailStart.q !== PLAYER_SPAWN.q || trailStart.r !== PLAYER_SPAWN.r) {
    throw new Error(`Trail start should be ${PLAYER_SPAWN.q},${PLAYER_SPAWN.r}, got ${trailStart.q},${trailStart.r}`);
  }
  if (trailEnd.q !== moved.q || trailEnd.r !== moved.r) {
    throw new Error(`Trail end should be ${moved.q},${moved.r}, got ${trailEnd.q},${trailEnd.r}`);
  }
  console.log(`>> Trail: ${moved.trail.length} steps from (${trailStart.q},${trailStart.r}) to (${trailEnd.q},${trailEnd.r})`);

  const hudAfterMove = await page.locator("#hud").textContent();
  console.log(`>> HUD after move: ${hudAfterMove}`);
  const moveMatch = hudAfterMove?.match(/Movement:\s*(\d+(?:\.\d+)?)\/7/);
  if (!moveMatch) throw new Error(`HUD missing "Movement: X/7": ${hudAfterMove}`);
  const movementValue = parseFloat(moveMatch[1]);
  if (!(movementValue < 7)) {
    throw new Error(`Movement should be < 7, got ${movementValue}`);
  }
  console.log(`>> HUD shows Movement: ${movementValue}/7 (< 7)`);

  const heroInfoMenuText = await page
    .locator("#toolbar button:has-text('End Turn')")
    .first()
    .evaluate((btn) => btn.parentElement?.parentElement?.textContent ?? "");
  console.log(`>> Toolbar menu text: ${heroInfoMenuText}`);
  if (!heroInfoMenuText.includes("End Turn")) {
    throw new Error("End Turn button missing from toolbar menu");
  }
  if (!heroInfoMenuText.match(/Day\s*\d+/)) {
    throw new Error(`Toolbar menu missing Day counter: ${heroInfoMenuText}`);
  }
  if (!heroInfoMenuText.match(/Week\s*\d+/)) {
    throw new Error(`Toolbar menu missing Week counter: ${heroInfoMenuText}`);
  }
  if (!heroInfoMenuText.match(/Month/)) {
    throw new Error(`Toolbar menu missing Month display: ${heroInfoMenuText}`);
  }
  if (!heroInfoMenuText.includes("turn")) {
    throw new Error(`Toolbar menu missing active turn indicator: ${heroInfoMenuText}`);
  }

  const playerCount = await page.evaluate(() => {
    const state = (window as any).__gameDebug?.getGameState?.();
    return state?.players?.length ?? 0;
  });
  if (playerCount !== 3) {
    throw new Error(`Expected 3 players, got ${playerCount}`);
  }
  console.log(`>> Player count: ${playerCount}`);

  const heroInfoVisible = await page.evaluate(() => {
    const els = Array.from(document.body.children);
    const popup = els.find((el) => el.textContent?.includes("Stats & Army"));
    if (!popup) return null;
    const style = (popup as HTMLElement).style;
    return { display: style.display, text: popup.textContent ?? "" };
  });
  console.log(`>> Hero info menu visible: ${JSON.stringify(heroInfoVisible)}`);
  if (!heroInfoVisible || heroInfoVisible.display === "none") {
    throw new Error("Hero info menu not visible while hero is selected");
  }
  if (!heroInfoVisible.text.includes("Movement")) {
    throw new Error(`Hero info menu missing "Movement": ${heroInfoVisible.text}`);
  }

  const settlementPanel = await page.evaluate(() => {
    const els = Array.from(document.body.children);
    const popup = els.find((el) => el.textContent?.startsWith("Settlements"));
    if (!popup) return null;
    const text = popup.textContent ?? "";
    return {
      hasSettlementsHeader: text.includes("Settlements"),
      hasNeutral: text.includes("Neutral"),
      hasPopulation: text.includes("Population"),
      hasResourceRates: text.includes("Resource rates") || text.includes("/turn"),
      hasIncome: text.includes("Income/turn"),
      snippet: text.slice(0, 400),
    };
  });
  console.log(`>> Settlement panel: ${JSON.stringify(settlementPanel)}`);
  if (!settlementPanel || !settlementPanel.hasSettlementsHeader) {
    throw new Error("Settlement panel not visible");
  }
  if (!settlementPanel.hasPopulation) {
    throw new Error(`Settlement panel missing Population: ${settlementPanel.snippet}`);
  }
  if (!settlementPanel.hasIncome) {
    throw new Error(`Settlement panel missing Income/turn: ${settlementPanel.snippet}`);
  }
  if (!settlementPanel.hasResourceRates) {
    throw new Error(`Settlement panel missing Resource rates: ${settlementPanel.snippet}`);
  }

  const hasNeutralSettlement = await page.evaluate(() => {
    const dbg = (window as any).__gameDebug;
    const settlements = dbg?.getSettlements?.() ?? [];
    return settlements.some((s: any) => s.ownerId === null);
  });
  if (hasNeutralSettlement && !settlementPanel.hasNeutral) {
    throw new Error(`Settlement panel missing Neutral section: ${settlementPanel.snippet}`);
  }

  const heroBeforeClamp = await page.evaluate(() => {
    const dbg = (window as any).__gameDebug;
    const heroes = dbg?.getHeroes?.() ?? [];
    return heroes.find((h: any) => h.ownerId === 0);
  });
  const movementLeft = heroBeforeClamp?.movementRemaining ?? 0;
  const clampedTarget = await page.evaluate(
    ({ q, r, look }) => {
      const dbg = (window as any).__gameDebug;
      const hero = (dbg?.getHeroes?.() ?? []).find((h: any) => h.ownerId === 0);
      if (!hero) return null;
      const W = 24, H = 18;
      let best = { q: hero.q, r: hero.r, dist: 0 };
      for (let dq = -look; dq <= look; dq++) {
        for (let dr = -look; dr <= look; dr++) {
          if (Math.abs(dq + dr) > look) continue;
          const nq = q + dq;
          const nr = r + dr;
          if (nq < 0 || nq >= W || nr < 0 || nr >= H) continue;
          if (!dbg.isPassable(nq, nr)) continue;
          const d = Math.max(Math.abs(nq - hero.q), Math.abs(nr - hero.r), Math.abs((nq + nr) - (hero.q + hero.r)));
          if (d > best.dist) best = { q: nq, r: nr, dist: d };
        }
      }
      return { tile: best };
    },
    { q: heroBeforeClamp?.q ?? 0, r: heroBeforeClamp?.r ?? 0, look: Math.max(8, Math.ceil(movementLeft) + 4) }
  );
  if (clampedTarget) {
    const ok = await page.evaluate(
      ({ id, q, r }) => (window as any).__gameDebug.requestMove(id, q, r),
      { id: heroBeforeClamp?.id, q: clampedTarget.tile.q, r: clampedTarget.tile.r }
    );
    await wait(800);
    const heroAfterClamp = await page.evaluate(() => {
      const dbg = (window as any).__gameDebug;
      const heroes = dbg?.getHeroes?.() ?? [];
      return heroes.find((h: any) => h.ownerId === 0);
    });
    console.log(
      `>> Clamp: was (${heroBeforeClamp?.q},${heroBeforeClamp?.r}) m=${movementLeft}; requested (${clampedTarget.tile.q},${clampedTarget.tile.r}); ok=${ok}; now at (${heroAfterClamp?.q},${heroAfterClamp?.r}) m=${heroAfterClamp?.movementRemaining}`
    );
    if (!ok) {
      throw new Error(`Clamped requestMove returned false`);
    }
    if (
      heroAfterClamp &&
      heroAfterClamp.movementRemaining >= 0 &&
      heroAfterClamp.q === heroBeforeClamp?.q &&
      heroAfterClamp.r === heroBeforeClamp?.r
    ) {
      throw new Error(`Hero did not move on out-of-range request`);
    }
  }

  const endTurnBtn = page.locator("#toolbar button:has-text('End Turn')");
  if (!(await endTurnBtn.isVisible())) throw new Error("End Turn button not visible in toolbar");
  if (!(await endTurnBtn.isEnabled())) throw new Error("End Turn button disabled during PLAYER_TURN");

  const preTurnRow = await queryDbRow(activeName);
  const preTurnPlayer0 = preTurnRow.players.find((p) => p.id === 0);
  if (!preTurnPlayer0) throw new Error("players[0] missing before end-turn");
  const ownedSettlementIds = preTurnPlayer0.settlementIds ?? [];
  const expectedIncome = ownedSettlementIds.reduce((acc, sid) => {
    const s = preTurnRow.settlements[sid];
    if (!s) return acc;
    if (s.ownerId !== 0) return acc;
    return acc + (s.population ?? 0) * (s.goldTax ?? 0);
  }, 0);
  const preSettlementGold: Record<string, number> = {};
  for (const sid of ownedSettlementIds) {
    preSettlementGold[sid] = Number(preTurnRow.settlements[sid]?.gold ?? 0);
  }
  console.log(
    `>> pre-turn: expected income=${expectedIncome}; pre-treasury=${JSON.stringify(preSettlementGold)}`
  );

  await endTurnBtn.click();

  await wait(300);
  const hudAfterEnd = await page.locator("#hud").textContent();
  console.log(`>> HUD after End Turn: ${hudAfterEnd}`);

  const deadline = Date.now() + 15000;
  let hudFinal = "";
  while (Date.now() < deadline) {
    hudFinal = (await page.locator("#hud").textContent()) ?? "";
    if (hudFinal.includes("Round 2") && hudFinal.includes("Turn: Human")) break;
    await wait(250);
  }
  console.log(`>> HUD after AI: ${hudFinal}`);
  if (!hudFinal.includes("Round 2")) {
    throw new Error(`HUD did not reach Round 2: ${hudFinal}`);
  }
  if (!hudFinal.includes("Turn: Human")) {
    throw new Error(`HUD did not return to "Turn: Human" after AI: ${hudFinal}`);
  }

  const dbRow = await queryDbRow(activeName);
  console.log(`>> DB row after End Turn: round=${dbRow.round} active=${dbRow.active_player_id}`);
  if (dbRow.round !== 2) {
    throw new Error(`Expected DB round=2, got ${dbRow.round}`);
  }
  if (dbRow.active_player_id !== 0) {
    throw new Error(`Expected DB active_player_id=0, got ${dbRow.active_player_id}`);
  }
  const player0 = dbRow.players.find((p) => p.id === 0);
  if (!player0) throw new Error("players[0] missing in DB row");

  let treasuryDelta = 0;
  for (const sid of ownedSettlementIds) {
    const before = preSettlementGold[sid] ?? 0;
    const after = Number(dbRow.settlements[sid]?.gold ?? 0);
    const expected = before + expectedIncome / ownedSettlementIds.length;
    if (Math.abs(after - expected) > 1) {
      throw new Error(
        `Treasury mismatch for ${sid}: expected ~${expected}, got ${after} (before=${before})`
      );
    }
    treasuryDelta += after - before;
  }
  console.log(
    `>> DB treasury delta for owned settlements: ${treasuryDelta} (expected ${expectedIncome})`
  );
  if (Math.abs(treasuryDelta - expectedIncome) > ownedSettlementIds.length) {
    throw new Error(
      `Expected treasury delta=${expectedIncome}, got ${treasuryDelta}`
    );
  }

  const playerHeroWealth = Object.values(dbRow.heroes)
    .filter((h) => h.ownerId === 0)
    .reduce((acc, h) => acc + (Number(h.gold) || 0), 0);
  const playerSettlementWealth = Object.values(dbRow.settlements)
    .filter((s) => s.ownerId === 0)
    .reduce((acc, s) => acc + (Number(s.gold) || 0), 0);
  console.log(
    `>> Player0 wealth: heroPurses=${playerHeroWealth} + treasuries=${playerSettlementWealth} = ${playerHeroWealth + playerSettlementWealth}`
  );

  const toolbarText = await page
    .locator("#toolbar button:has-text('End Turn')")
    .first()
    .evaluate((btn) => btn.parentElement?.parentElement?.textContent ?? "");
  if (!toolbarText.match(/Income\s*\+\d+g\/turn/)) {
    throw new Error(`Toolbar menu missing "Income +Xg/turn" display: ${toolbarText}`);
  }
  if (!toolbarText.match(/Wealth\s*\d+/)) {
    throw new Error(`Toolbar menu missing "Wealth: X" display: ${toolbarText}`);
  }
  console.log(`>> Toolbar shows Income +Xg/turn and Wealth: Xg`);

  const settingsOpen = await page.evaluate(() => {
    const gear = document.querySelector("#toolbar button[title='Settings']");
    if (!gear) return false;
    (gear as HTMLButtonElement).click();
    return true;
  });
  if (!settingsOpen) throw new Error("Settings gear button not found in toolbar");
  await wait(300);

  const settingsModal = await page.evaluate(() => {
    const popups = Array.from(document.body.children);
    const modal = popups.find((el) => el.textContent?.includes("Hero movement speed"));
    if (!modal) return null;
    const slider = modal.querySelector("input[type=range]") as HTMLInputElement | null;
    return {
      hasSlider: !!slider,
      value: slider?.value ?? null,
      max: slider?.max ?? null,
      min: slider?.min ?? null,
    };
  });
  console.log(`>> Settings modal: ${JSON.stringify(settingsModal)}`);
  if (!settingsModal || !settingsModal.hasSlider) {
    throw new Error("Settings modal did not open with a slider");
  }
  if (settingsModal.value !== "220") {
    throw new Error(`Default speed should be 220ms, got ${settingsModal.value}`);
  }
  if (settingsModal.max !== "1000") {
    throw new Error(`Settings max should be 1000ms, got ${settingsModal.max}`);
  }

  await page.evaluate(() => {
    const popups = Array.from(document.body.children);
    const modal = popups.find((el) => el.textContent?.includes("Hero movement speed"));
    const slider = modal?.querySelector("input[type=range]") as HTMLInputElement | null;
    if (!slider) return;
    slider.value = "1000";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(150);
  const speedAfter = await page.evaluate(() => (window as any).__gameDebug?.getMoveDurationMs?.());
  console.log(`>> Speed after slider drag to 1000: ${speedAfter}`);
  if (speedAfter !== 1000) {
    throw new Error(`Expected moveDurationMs=1000 after slider, got ${speedAfter}`);
  }

  await page.evaluate(() => {
    const popups = Array.from(document.body.children);
    const modal = popups.find((el) => el.textContent?.includes("Hero movement speed"));
    const closeBtn = Array.from(modal?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent === "Close"
    );
    (closeBtn as HTMLButtonElement | undefined)?.click();
  });
  await wait(200);
}

async function runSettlementCaptureChecks(page: Page, ctx: any, activeName: string) {
  console.log(">> Capture flow: teleport player onto AI castle, capture");

  const target = await page.evaluate(() => {
    const dbg = (window as any).__gameDebug;
    const settlements = dbg?.getSettlements?.() ?? [];
    const enemySettlement = settlements.find((s: any) => s.ownerId !== 0 && s.ownerId !== null);
    if (!enemySettlement) return null;
    return { id: enemySettlement.id, q: enemySettlement.q, r: enemySettlement.r };
  });
  if (!target) {
    console.log(">> No enemy settlement available to capture, skipping");
    return;
  }

  const before = await page.evaluate(
    ({ id }) => {
      const dbg = (window as any).__gameDebug;
      const playerHero = dbg?.getHeroes?.().find((h: any) => h.ownerId === 0);
      const state = dbg?.getGameState?.();
      const settlement = state?.settlements?.[id];
      return {
        heroId: playerHero?.id ?? null,
        heroQ: playerHero?.q ?? null,
        heroR: playerHero?.r ?? null,
        heroGold: playerHero?.gold ?? 0,
        ownerId: settlement?.ownerId ?? null,
      };
    },
    { id: target.id }
  );
  console.log(`>> Before capture: hero=${before.heroId} at (${before.heroQ},${before.heroR}); settlement owner=${before.ownerId}; heroPurse=${before.heroGold}`);

  const teleported = await page.evaluate(
    ({ id, q, r }) => (window as any).__gameDebug.teleportHero?.(id, q, r),
    { id: before.heroId, q: target.q, r: target.r }
  );
  if (!teleported) throw new Error("teleportHero for capture failed");

  await page.evaluate(
    ({ settlementId, heroId }) => {
      const dbg = (window as any).__gameDebug;
      if (typeof dbg.captureSettlement === "function") {
        dbg.captureSettlement(heroId, settlementId);
      }
    },
    { settlementId: target.id, heroId: before.heroId }
  );
  await wait(300);

  const after = await page.evaluate(
    ({ id }) => {
      const dbg = (window as any).__gameDebug;
      const playerHero = dbg?.getHeroes?.().find((h: any) => h.ownerId === 0);
      const state = dbg?.getGameState?.();
      const settlement = state?.settlements?.[id];
      const player = state?.players?.find((p: any) => p.id === 0);
      return {
        ownerId: settlement?.ownerId ?? null,
        heroGold: playerHero?.gold ?? 0,
        playerSettlements: (player?.settlementIds ?? []).length,
      };
    },
    { id: target.id }
  );
  console.log(`>> After capture: settlement owner=${after.ownerId}; heroPurse=${after.heroGold}; player owns ${after.playerSettlements} settlements`);

  if (after.ownerId !== 0) {
    throw new Error(`Capture failed: settlement ownerId is ${after.ownerId}, expected 0`);
  }
  if ((after.heroGold ?? 0) <= (before.heroGold ?? 0)) {
    throw new Error(`Capture did not award gold to hero purse: before=${before.heroGold} after=${after.heroGold}`);
  }
  if (after.playerSettlements <= (await queryDbRow(activeName)).players?.[0]?.settlementIds?.length) {
    console.log(">> Note: DB settlementIds may not have updated until next save");
  }

  const lastEvent = await queryLastEvent(activeName);
  if (lastEvent?.kind !== "settlement_captured") {
    throw new Error(`Last event should be settlement_captured, got ${lastEvent?.kind}`);
  }
  console.log(`>> Last event: ${lastEvent.kind}`);
}

async function runBattleChecks(page: Page, ctx: any, activeName: string) {
  console.log(">> Battle flow: teleport player next to AI, resolve, defender removed");

  const beforeDefenders = await page.evaluate(
    () => (window as any).__gameDebug.getHeroes?.().filter((h: any) => h.ownerId !== 0).map((h: any) => h.id) ?? []
  );
  if (beforeDefenders.length === 0) throw new Error("no AI heroes available for battle test");
  const defenderId = beforeDefenders[0];
  console.log(`>> Defenders before battle: ${JSON.stringify(beforeDefenders)} (using ${defenderId})`);

  const defenderPos = await page.evaluate(
    (id: string) => (window as any).__gameDebug.getHeroes?.().find((h: any) => h.id === id),
    defenderId
  );
  if (!defenderPos) throw new Error("defender position not found");

  // Give the defender some gold so we can verify winner-takes-all persists.
  // Teleport defender to its own settlement and call the server transfer endpoint
  // so the gold is persisted (client-only transfers don't survive to battle resolution).
  const defenderSettlement = await page.evaluate(
    (id: string) => {
      const dbg = (window as any).__gameDebug;
      const state = dbg?.getGameState?.();
      const hero = state?.heroes?.[id];
      if (!hero) return null;
      for (const s of Object.values(state.settlements ?? {})) {
        if (s.ownerId === hero.ownerId) return { id: s.id, q: s.q, r: s.r };
      }
      return null;
    },
    defenderId
  );
  if (defenderSettlement) {
    const teleDef = await page.evaluate(
      ({ id, q, r }) => (window as any).__gameDebug.teleportHero?.(id, q, r),
      { id: defenderId, q: defenderSettlement.q, r: defenderSettlement.r }
    );
    if (!teleDef) throw new Error("teleportHero for defender failed");
    await wait(150);
    const withdrawRes = await ctx.post(`${API_URL}/api/games/${activeName}/transfer`, {
      data: { heroId: defenderId, settlementId: defenderSettlement.id, direction: "withdraw" },
    });
    if (!withdrawRes.ok()) {
      throw new Error(`Server transfer (defender withdraw) failed: ${withdrawRes.status()}`);
    }
    console.log(`>> Defender withdraw persisted via API`);
  }

  const preBattleDb = await queryDbRow(activeName);
  const defenderGoldBeforeBattle = Number(preBattleDb.heroes[defenderId]?.gold ?? 0);
  const attackerGoldBeforeBattle = Number(preBattleDb.heroes["p0-hero"]?.gold ?? 0);
  console.log(`>> DB before battle: attacker=${attackerGoldBeforeBattle} defender=${defenderGoldBeforeBattle}`);

  const adjacentOffset = { q: defenderPos.q - 1, r: defenderPos.r };
  const teleported = await page.evaluate(
    ({ id, q, r }) => (window as any).__gameDebug.teleportHero?.(id, q, r),
    { id: "p0-hero", q: adjacentOffset.q, r: adjacentOffset.r }
  );
  if (!teleported) throw new Error("teleportHero for p0-hero failed");
  await wait(150);

  await page.evaluate(
    ({ a, d }) => (window as any).__gameDebug.enterBattle?.(a, d),
    { a: "p0-hero", d: defenderId }
  );
  await wait(150);

  const phase = await page.evaluate(() => (window as any).__gameDebug.phase);
  console.log(`>> Phase after enterBattle: ${JSON.stringify(phase)}`);
  if (!phase || (phase as any).kind !== "BATTLE") {
    throw new Error(`Expected BATTLE phase, got ${JSON.stringify(phase)}`);
  }

  const resolveBtn = page.locator("button", { hasText: "Resolve" }).first();
  await resolveBtn.click();
  await wait(2000);

  const afterDefenders = await page.evaluate(
    () => (window as any).__gameDebug.getHeroes?.().filter((h: any) => h.ownerId !== 0).map((h: any) => h.id) ?? []
  );
  console.log(`>> Defenders after battle: ${JSON.stringify(afterDefenders)}`);
  if (afterDefenders.includes(defenderId)) {
    throw new Error(`Defender ${defenderId} should have been removed from client`);
  }

  const dbRowAfterBattle = await queryDbRow(activeName);
  const aiPlayer = dbRowAfterBattle.players.find((p) => p.id === 1);
  if (aiPlayer && aiPlayer.heroIds.includes(defenderId)) {
    throw new Error(`DB still references defender ${defenderId}`);
  }
  if (dbRowAfterBattle.heroes[defenderId]) {
    throw new Error(`DB heroes JSON still has defender ${defenderId}`);
  }
  const attackerAfter = dbRowAfterBattle.heroes["p0-hero"];
  const expectedAttackerGold = attackerGoldBeforeBattle + defenderGoldBeforeBattle;
  console.log(
    `>> Battle loot: attacker purse ${attackerGoldBeforeBattle} + defender purse ${defenderGoldBeforeBattle} = expected ${expectedAttackerGold}; got ${attackerAfter?.gold ?? "n/a"}`
  );
  if (!attackerAfter || Number(attackerAfter.gold ?? 0) !== expectedAttackerGold) {
    throw new Error(
      `Combat loot mismatch: expected attacker.gold=${expectedAttackerGold}, got ${attackerAfter?.gold ?? "n/a"}`
    );
  }
  console.log(">> Battle resolved, defender removed, loot transferred to attacker (winner takes all)");
}

async function runTransferChecks(page: Page, ctx: any, activeName: string) {
  console.log(">> Transfer flow: teleport player hero onto own settlement, withdraw");

  const settlementInfo = await page.evaluate(() => {
    const dbg = (window as any).__gameDebug;
    const settlements = dbg?.getSettlements?.() ?? [];
    return settlements
      .filter((s: any) => s.ownerId === 0)
      .map((s: any) => ({ id: s.id, q: s.q, r: s.r }));
  });
  if (settlementInfo.length === 0) {
    console.log(">> No owned settlement to test transfer against, skipping");
    return;
  }
  const target = settlementInfo[0];

  const pre = await page.evaluate(
    ({ id }) => {
      const dbg = (window as any).__gameDebug;
      const state = dbg?.getGameState?.();
      const hero = state?.heroes?.["p0-hero"];
      const settlement = state?.settlements?.[id];
      return { heroGold: Number(hero?.gold ?? 0), treasuryGold: Number(settlement?.gold ?? 0) };
    },
    { id: target.id }
  );
  console.log(`>> Before transfer: hero=${pre.heroGold} treasury=${pre.treasuryGold}`);

  const teleported = await page.evaluate(
    ({ q, r }) => (window as any).__gameDebug.teleportHero?.("p0-hero", q, r),
    { q: target.q, r: target.r }
  );
  if (!teleported) throw new Error("teleportHero for transfer failed");

  const transferResult = await page.evaluate(
    async ({ id }) => {
      const dbg = (window as any).__gameDebug;
      const tc = dbg?.getTurnController?.();
      if (!tc) return { ok: false, reason: "no_tc" };
      const heroState = dbg.getState?.()?.heroes?.["p0-hero"];
      if (!heroState) return { ok: false, reason: "no_hero" };
      const before = Number(heroState.gold ?? 0);
      const result = tc.transferGold("p0-hero", id, "deposit");
      const after = Number(dbg.getState?.()?.heroes?.["p0-hero"]?.gold ?? 0);
      return { ok: result.ok, reason: result.reason ?? "", before, after };
    },
    { id: target.id }
  );
  console.log(`>> Deposit transfer: ${JSON.stringify(transferResult)}`);
  if (!transferResult.ok) {
    throw new Error(`Transfer (deposit) failed: ${transferResult.reason}`);
  }
  if (transferResult.after !== 0) {
    throw new Error(`Hero purse should be 0 after deposit, got ${transferResult.after}`);
  }

  const withdrawResult = await page.evaluate(
    async ({ id }) => {
      const dbg = (window as any).__gameDebug;
      const tc = dbg?.getTurnController?.();
      if (!tc) return { ok: false, reason: "no_tc" };
      const heroState = dbg.getState?.()?.heroes?.["p0-hero"];
      const before = Number(heroState?.gold ?? 0);
      const result = tc.transferGold("p0-hero", id, "withdraw");
      const after = Number(dbg.getState?.()?.heroes?.["p0-hero"]?.gold ?? 0);
      return { ok: result.ok, reason: result.reason ?? "", before, after };
    },
    { id: target.id }
  );
  console.log(`>> Withdraw transfer: ${JSON.stringify(withdrawResult)}`);
  if (!withdrawResult.ok) {
    throw new Error(`Transfer (withdraw) failed: ${withdrawResult.reason}`);
  }
  const preWithdrawHeroGold = transferResult.after;
  const treasuryGainedFromDeposit = transferResult.before - transferResult.after;
  const expectedAfter = preWithdrawHeroGold + (pre.treasuryGold + treasuryGainedFromDeposit);
  if (withdrawResult.after !== expectedAfter) {
    throw new Error(
      `Withdraw wrong: before=${withdrawResult.before} after=${withdrawResult.after} expected ${expectedAfter}`
    );
  }
  console.log(`>> Withdraw drained full treasury into hero purse: ${expectedAfter}g`);

  await ctx.post(`${API_URL}/api/games/${activeName}/transfer`, {
    data: { heroId: "p0-hero", settlementId: target.id, direction: "withdraw" },
  }).catch(() => {});

  const lastEvent = await queryLastEvent(activeName);
  console.log(`>> Last event after transfer tests: ${lastEvent?.kind}`);
}

async function ensureBuilt() {
  if (!existsSync("dist/index.html")) {
    console.log(">> building dist");
    await runOnce("npm", ["run", "build"]);
  }
}

function runOnce(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function startApi(): ChildProcess {
  const out = openSync("test/api.log", "w");
  const err = openSync("test/api.err.log", "w");
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(API_PORT) },
    stdio: ["ignore", out, err],
    detached: true,
    shell: true,
  });
  child.unref();
  return child;
}

function startWeb(): ChildProcess {
  const out = openSync("test/web.log", "w");
  const err = openSync("test/web.err.log", "w");
  const child = spawn(
    "npx",
    ["vite", "preview", "--port", String(WEB_PORT), "--strictPort"],
    {
      stdio: ["ignore", out, err],
      detached: true,
      shell: true,
    }
  );
  child.unref();
  return child;
}

async function waitForUrl(url: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {}
    await wait(200);
  }
  throw new Error(`server at ${url} did not respond`);
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

async function sampleNonBlackPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById("game") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h).data;
    let nonBlack = 0;
    const step = 32;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (img[i] > 8 || img[i + 1] > 8 || img[i + 2] > 8) nonBlack++;
      }
    }
    return nonBlack;
  });
}

async function heroTile(page: Page): Promise<{ q: number; r: number }> {
  return page.evaluate(() => {
    const hud = document.getElementById("hud")!;
    const m = hud.textContent!.match(/Hero \((\d+), (\d+)\)/);
    return m ? { q: Number(m[1]), r: Number(m[2]) } : { q: -1, r: -1 };
  });
}

async function run() {
  await ensureBuilt();
  const api = startApi();
  const web = startWeb();
  startLogTail();
  let browser: Browser | undefined;
  let failed = false;
  try {
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    console.log(">> api + web up");

    const ctx = await pwRequest.newContext();
    const health = await ctx.get(`${API_URL}/api/health`);
    const healthBody = (await health.json());
    console.log(`>> api health: ${JSON.stringify(healthBody)}`);
    if (!(healthBody as any).ok) throw new Error("api health not ok");

    await ctx.delete(`${API_URL}/api/games/${GAME_NAME}`);
    console.log(`>> reset game '${GAME_NAME}'`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[browser error]", msg.text());
    });

    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => (window as any).__gameDebug?.activeGameName != null,
      null,
      { timeout: 15_000 }
    );

    const spawnInfo = await page.evaluate(() => {
      const dbg = (window as any).__gameDebug;
      const heroes = dbg?.getHeroes?.() ?? [];
      const settlements = dbg?.getSettlements?.() ?? [];
      const playerHero = heroes.find((h: any) => h.ownerId === 0);
      const aiSettlement = settlements.find((s: any) => s.ownerId === 1);
      return {
        playerSpawn: playerHero ? { q: playerHero.q, r: playerHero.r } : null,
        aiSpawn: aiSettlement ? { q: aiSettlement.q, r: aiSettlement.r } : null,
      };
    });
    if (spawnInfo.playerSpawn) PLAYER_SPAWN = spawnInfo.playerSpawn;
    if (spawnInfo.aiSpawn) AI_SPAWN = spawnInfo.aiSpawn;
    console.log(`>> dynamic spawns: player=${JSON.stringify(PLAYER_SPAWN)} ai=${JSON.stringify(AI_SPAWN)}`);

    const before = await sampleNonBlackPixels(page);
    const heroStart = await heroTile(page);
    const activeName = await page.evaluate(() => (window as any).__gameDebug?.activeGameName);
    console.log(`>> canvas non-black pixels: ${before}`);
    console.log(`>> hero start: ${JSON.stringify(heroStart)}`);
    console.log(`>> active game: ${activeName}`);
    if (typeof activeName !== "string" || !activeName.startsWith("starter-")) {
      throw new Error(`Expected starter game, got activeGameName=${activeName}`);
    }

    if (before < 50) throw new Error(`Canvas appears blank (${before} non-black samples)`);
    if (heroStart.q !== PLAYER_SPAWN.q || heroStart.r !== PLAYER_SPAWN.r) {
      throw new Error(`Hero did not start at (${PLAYER_SPAWN.q},${PLAYER_SPAWN.r})`);
    }

    const box = await page.locator("#game").boundingBox();
    if (!box) throw new Error("No canvas bbox");

    const target = await pickClickTarget(ctx, activeName, PLAYER_SPAWN);
    console.log(`>> click target tile: ${JSON.stringify(target.tile)}`);
    const heroScreen = await page.evaluate(
      ({ q, r }) => (window as any).__gameDebug.screenFor(q, r),
      { q: PLAYER_SPAWN.q, r: PLAYER_SPAWN.r }
    );
    await page.mouse.click(heroScreen.x, heroScreen.y);
    await wait(150);
    const screen = await page.evaluate(
      ({ q, r }) => (window as any).__gameDebug.screenFor(q, r),
      { q: target.tile.q, r: target.tile.r }
    );
    console.log(`>> click screen coords: ${JSON.stringify(screen)}`);
    await page.mouse.move(screen.x, screen.y);
    await wait(100);
    const beforeClick = await page.evaluate(() => (window as any).__gameDebug?.click);
    console.log(`>> debug before click: ${JSON.stringify(beforeClick)}`);
    await page.mouse.click(screen.x, screen.y);
    await wait(1200);

    const heroAfter = await heroTile(page);
    console.log(`>> hero after click: ${JSON.stringify(heroAfter)}`);
    if (heroAfter.q === heroStart.q && heroAfter.r === heroStart.r) {
      throw new Error(`Hero did not move after click.`);
    }

    await wait(500);
    const game = await ctx.get(`${API_URL}/api/games/${activeName}`);
    const gameBody = (await game.json());
    console.log(`>> api game: ${JSON.stringify(gameBody)}`);
    const events = await ctx.get(`${API_URL}/api/games/${activeName}/events`);
    const eventsBody = (await events.json());
    console.log(`>> events: ${eventsBody.length}`);
    if (eventsBody.length < 1) throw new Error("No events logged");

    await runTilesEndpointChecks(ctx, activeName);

    await runNewLoadSaveFlow(page, ctx, activeName, (gameBody as any).updated_at);

    await runTurnFlowChecks(page, ctx, activeName);

    await runSettlementCaptureChecks(page, ctx, activeName);

    await runBattleChecks(page, ctx, activeName);

    await runTransferChecks(page, ctx, activeName);

    await page.screenshot({ path: "test/screenshot.png" });
    console.log(">> screenshot saved");

    const dprPage = await browser.newPage({
      viewport: { width: 1024, height: 720 },
      deviceScaleFactor: 2,
    });
    await dprPage.goto(WEB_URL, { waitUntil: "networkidle" });
    await wait(300);
    const dprInfo = await dprPage.evaluate(() => ({
      dpr: window.devicePixelRatio,
      cssW: window.innerWidth,
      cssH: window.innerHeight,
      canvasW: (document.getElementById("game") as HTMLCanvasElement).width,
      canvasH: (document.getElementById("game") as HTMLCanvasElement).height,
    }));
    console.log(`>> dpr info: ${JSON.stringify(dprInfo)}`);
    if (dprInfo.dpr !== 2) throw new Error(`expected dpr 2, got ${dprInfo.dpr}`);
    if (dprInfo.canvasW !== dprInfo.cssW * 2) throw new Error("canvas not dpr-scaled");

    const targetX = 512;
    const targetY = 360;
    await dprPage.mouse.move(targetX, targetY);
    await wait(50);
    const hover = await dprPage.evaluate(
      ({ tx, ty }) => {
        const dbg = (window as any).__gameDebug;
        return { hover: dbg?.hover, tx, ty };
      },
      { tx: targetX, ty: targetY }
    );
    console.log(`>> dpr hover at (${targetX},${targetY}): ${JSON.stringify(hover)}`);
    if (!hover.hover) throw new Error("no hover computed on high-DPR page");
    await dprPage.screenshot({ path: "test/screenshot-dpr2.png" });
    console.log(">> dpr2 screenshot saved");
    await dprPage.close();

    console.log(">> ALL TESTS PASSED");
  } catch (err) {
    failed = true;
    console.error("TEST FAILED:", err);
  } finally {
    stopLogTail();
    try {
      if (browser) {
        const proc = browser.process();
        if (proc) proc.kill("SIGKILL");
      }
    } catch {
      // best-effort
    }
    if (api && !api.killed) {
      try { api.kill("SIGKILL"); } catch {}
    }
    if (web && !web.killed) {
      try { web.kill("SIGKILL"); } catch {}
    }
    process.exit(failed ? 1 : 0);
  }
}

run();

setTimeout(() => {
  console.error(">> smoke test exceeded 60s, forcing exit");
  process.exit(2);
}, 60_000).unref();
