import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import { GameMap, hexDistance } from "@heroes/engine";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

// AI chartering (B3) end-to-end, browser CLOSED -- the Phase 1 headline
// guarantee: the server-side AI driver (server/app/aiDriver.ts, for games
// flagged lobby.aiDriver === "server") drives an AI seat's whole turn with no
// client attached. This suite is the proof for the charter path specifically
// (B3 ruling: "Yes, AI charters with human-parity gating"):
//
//   setup   a flagged game (enemySlots > 0) where the HUMAN seat funds the AI
//           hero to the human charter gate: the AI keep's treasury is given
//           gold and the human seat withdraws it into the AI hero's purse
//           through the real TransferGold command, so the hero reaches exactly
//           CHARTER_GOLD_COST. The keep's warehouse already carries the game's
//           own seeded 300 wood / 300 stone, so no resource tampering is
//           needed for the human-parity gate.
//   browser one real page is opened (and asserted error-free) purely to prove
//           the human seat's client saw the funded AI hero; it is then CLOSED
//           for the rest of the run.
//   drive   every remaining turn is driven as the human seat over the plain
//           HTTP command bus (POST /commands EndTurn) -- no browser, no engine
//           client, nothing but the API. The AI seat is driven in-process.
//   assert  the driver founds the settlement (charter row + CharterStarted
//           event + hero purse / keep warehouse debits), advances the charter
//           travel over subsequent turns (CharterTravelAdvanced steps, never a
//           MoveHero for the chartering hero), completes the 10 construction
//           days with the new settlement owned by the AI seat, and leaves the
//           human seat's charter-relevant state untouched.
//
// Every assertion reads server state (the games row, the charters table, the
// game_events log), because the browser is closed by design.
//
// Seed 7 puts the AI hero's best charter target 7 hexes / 12 movement away, so
// travel needs two AI turns -- enough to prove multi-turn advancement instead
// of a single-turn hop. The fixture's original seed 777 no longer does: the
// brain's own choice for it is now 4 hexes / 4 movement away (reachable inside
// one turn's 7), so the "travel costs two turns" assertion at the end of
// section B failed there. That is a stale premise, not a rule change -- the
// same probe of `pickCharterAction` prints hero 16,8 -> target 16,4 / cost 4
// both at github/main 9506422 and at this branch. The replacement was picked
// from a sweep of seeds 1..400 by the brain's own target choice, keeping the
// travel cost above MOVEMENT_PER_TURN.

// Env-first ports: the prescribed direct command loads .env (fresh after
// allocate-ports); tools/run-test.mjs additionally exports API_PORT/CLIENT_PORT
// to the child. The shared .test-request.json contract behind getApiPort is
// only the fallback -- a stale file from a crashed run would point this suite
// at dead ports while the Vite child (inheriting .env) still proxies /api to
// the .env API port.
const API_PORT = Number(process.env.API_PORT) || getApiPort(3001);
const WEB_PORT = Number(process.env.CLIENT_PORT) || getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_SEED = 7;
const HUMAN_SEAT = 0;
const AI_SEAT = 1;
const AI_HERO_ID = "p1-hero";
const HUMAN_HERO_ID = "p0-hero";
const CHARTER_GOLD_COST = 2500;
const CHARTER_WAREHOUSE_COST = { wood: 20, stone: 15 };
const CHARTER_CONSTRUCTION_DAYS = 10;
// Enough treasury to fill the purse to its cap (treasuryWagons 5 x 500) in one
// withdraw; the rest stays in the keep and is asserted on the way through.
const SEEDED_TREASURY_GOLD = 5000;
// 2 travel turns + 10 construction days + slack for the driver's 5s scan cadence.
const MAX_AI_TURNS = 26;
const AI_TURN_TIMEOUT_MS = 45_000;

interface Axial { q: number; r: number }
interface HeroRow { ownerId: number; q: number; r: number; gold: number; isChartering: boolean; charterId: string | null }
interface SettlementRow {
  ownerId: number | null; q: number; r: number; name: string; level: number;
  gold: number; warehouse: { wood?: number; stone?: number };
}
interface PlayerRow { id: number; settlementIds: string[] }
interface GameRow {
  id: number; seed: number; map_size: string;
  players: PlayerRow[];
  heroes: Record<string, HeroRow>;
  settlements: Record<string, SettlementRow>;
  round: number; day: number; active_player_id: number;
  lobby: { aiDriver?: string } | null;
}
interface CharterRow {
  id: string; hero_id: string; owner_id: number; target_q: number; target_r: number;
  settlement_name: string; phase: "traveling" | "constructing"; days_remaining: number; settlement_id: string;
}
interface TurnSnap {
  round: number;
  day: number;
  /** state right after the HUMAN's EndTurn, read off that command's response. */
  humanSideWood: number;
  humanSideStone: number;
  humanSideHeroGold: number;
  /** state after the driver finished the AI's whole turn (server read). */
  aiSideWood: number;
  aiSideStone: number;
  aiSideHeroGold: number;
  heroQ: number;
  heroR: number;
  heroChartering: boolean;
  charter: CharterRow | null;
  newAiSettlement: { id: string; name: string; q: number; r: number; level: number } | null;
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
setTimeout(() => { console.error(">> aiCharter.e2e exceeded 420s, forcing exit"); cleanup(); process.exit(2); }, 420_000).unref();

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

async function command(name: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  return api("POST", `/api/games/${name}/commands`, { ...body, gameName: name });
}

async function serverRow(name: string): Promise<GameRow> {
  const r = await db.query(
    `SELECT id, seed, map_size, players, heroes, settlements, round, day, active_player_id, lobby
       FROM games WHERE name = $1`,
    [name],
  );
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0] as GameRow;
}

async function charterRow(name: string): Promise<CharterRow | null> {
  const r = await db.query(
    `SELECT id, hero_id, owner_id, target_q, target_r, settlement_name, phase, days_remaining, settlement_id
       FROM charters WHERE game_id = (SELECT id FROM games WHERE name = $1)`,
    [name],
  );
  return (r.rows[0] as CharterRow) ?? null;
}

async function eventCount(name: string, kind: string): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM game_events e JOIN games g ON g.id = e.game_id
      WHERE g.name = $1 AND e.kind = $2`,
    [name, kind],
  );
  return r.rows[0].n as number;
}

async function eventId(name: string, kind: string): Promise<number | null> {
  const r = await db.query(
    `SELECT e.id FROM game_events e JOIN games g ON g.id = e.game_id
      WHERE g.name = $1 AND e.kind = $2 ORDER BY e.id LIMIT 1`,
    [name, kind],
  );
  return r.rows[0] ? (r.rows[0].id as number) : null;
}

async function eventCountAfter(name: string, kind: string, afterId: number, heroId?: string): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM game_events e JOIN games g ON g.id = e.game_id
      WHERE g.name = $1 AND e.kind = $2 AND e.id > $3 AND ($4::text IS NULL OR e.payload->>'heroId' = $4)`,
    [name, kind, afterId, heroId ?? null],
  );
  return r.rows[0].n as number;
}

/** Polls `fn` until it returns something truthy, with a hard, bounded deadline. */
async function pollUntil<T>(what: string, timeoutMs: number, fn: () => Promise<T | null | false>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const got = await fn();
    if (got) return got as T;
    await wait(400);
  }
  assert.fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
}

async function freshGame(name: string): Promise<{ id: string }> {
  await api("DELETE", `/api/games/${name}`);
  const res = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 1 });
  assert.equal(res.status, 201, `create ${name} -> ${res.status} ${JSON.stringify(res.json)}`);
  const got = await api("GET", `/api/games/${name}`);
  assert.equal(got.status, 200, `GET ${name} -> ${got.status}`);
  assert.equal(got.json?.lobby?.aiDriver, "server",
    `lobby.aiDriver=${JSON.stringify(got.json?.lobby?.aiDriver)}, expected "server" (the game must be server-driven)`);
  return res.json;
}

async function deleteGame(name: string): Promise<void> {
  await api("DELETE", `/api/games/${name}`);
}

function attachErrorCollectors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
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
  // Bounded retries: the home view hydrates asynchronously and a single click
  // can land before the modal's list is populated. Three attempts, each with
  // its own wait, keeps this suite from flaking on view timing.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const loadBtn = page.locator("button").filter({ hasText: /^Load Game$/ }).first();
    if ((await loadBtn.count()) === 0) { await wait(1000); continue; }
    await loadBtn.click({ timeout: 15000 }).catch(() => {});
    const listed = await page.locator("button", { hasText: "Open" }).first()
      .waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    if (!listed) continue;
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
    if (clicked) {
      await wait(700);
      await page.keyboard.press("Escape").catch(() => {});
      await wait(300);
      return;
    }
    await wait(500);
  }
  // One more chance: the debug API may already carry the game even if the
  // click path never rendered the list (keeps the browser phase about the
  // charter proof, not menu plumbing).
  await page.waitForFunction((n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === n, name, { timeout: 30000 });
}

/** The AI keep: the AI-owned settlement the AI hero starts on (the charter's provisioning city). */
function keepOf(row: GameRow): { id: string; s: SettlementRow } {
  const hero = row.heroes[AI_HERO_ID];
  const hit = Object.entries(row.settlements).find(([, s]) =>
    s.q === hero.q && s.r === hero.r && s.ownerId === hero.ownerId);
  assert(hit, `AI hero ${AI_HERO_ID} does not stand on an AI-owned settlement (at ${hero.q},${hero.r})`);
  return { id: hit[0], s: hit[1] };
}

/** The keep's warehouse, addressed by id (the chartering hero walks away from it). */
function keepStock(row: GameRow, keepId: string): { wood: number; stone: number } {
  const keep = row.settlements[keepId];
  assert(keep, `keep ${keepId} vanished from the settlements record`);
  return { wood: keep.warehouse.wood ?? 0, stone: keep.warehouse.stone ?? 0 };
}

async function snapshot(name: string, keepId: string, baseline: Record<string, SettlementRow>): Promise<TurnSnap> {
  const row = await serverRow(name);
  const charter = await charterRow(name);
  const hero = row.heroes[AI_HERO_ID];
  const stock = keepStock(row, keepId);
  const grown = Object.entries(row.settlements).find(([id, s]) => s.ownerId === AI_SEAT && !baseline[id]);
  return {
    round: row.round,
    day: row.day,
    humanSideWood: 0,
    humanSideStone: 0,
    humanSideHeroGold: 0,
    aiSideWood: stock.wood,
    aiSideStone: stock.stone,
    aiSideHeroGold: hero.gold,
    heroQ: hero.q,
    heroR: hero.r,
    heroChartering: hero.isChartering,
    charter,
    newAiSettlement: grown ? { id: grown[0], name: grown[1].name, q: grown[1].q, r: grown[1].r, level: grown[1].level } : null,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 2dp, the engine's own production precision -- keeps binary float noise out of exact deltas. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  const name = "ai-charter-e2e";
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);
    console.log(">> api + web up");

    const game = await freshGame(name);
    const fresh = await serverRow(name);
    assert.equal(fresh.active_player_id, HUMAN_SEAT,
      `a fresh game starts on the human seat, got active_player_id=${fresh.active_player_id}`);
    const aiHero = fresh.heroes[AI_HERO_ID];
    assert.equal(aiHero.ownerId, AI_SEAT, `${AI_HERO_ID} is not owned by the AI seat`);
    const keep = keepOf(fresh);
    console.log(`>> AI hero ${AI_HERO_ID} at ${aiHero.q},${aiHero.r} on ${keep.id} ` +
      `(treasury ${keep.s.gold}g, warehouse wood ${keep.s.warehouse.wood ?? 0} / stone ${keep.s.warehouse.stone ?? 0})`);
    // The human-parity warehouse half of the gate is already satisfied by the
    // game's own seeded stock -- no resource tampering is needed, only the purse.
    assert((keep.s.warehouse.wood ?? 0) >= CHARTER_WAREHOUSE_COST.wood
      && (keep.s.warehouse.stone ?? 0) >= CHARTER_WAREHOUSE_COST.stone,
      `the AI keep must already hold ${CHARTER_WAREHOUSE_COST.wood} wood / ${CHARTER_WAREHOUSE_COST.stone} stone for the human-parity gate`);
    // A freshly created game is JSONB-sourced (no granular rows yet), so
    // seeding the treasury through the blob is honest -- and the first command
    // dual-writes the granular rows StartCharter's source gate requires.
    const granular = await db.query(
      `SELECT (SELECT count(*) FROM heroes WHERE game_id = $1) AS heroes,
              (SELECT count(*) FROM settlements WHERE game_id = $1) AS settlements`,
      [fresh.id],
    );
    assert.equal(Number(granular.rows[0].heroes), 0, "a fresh game unexpectedly has granular hero rows");
    assert.equal(Number(granular.rows[0].settlements), 0, "a fresh game unexpectedly has granular settlement rows");
    await db.query(
      `UPDATE games SET settlements = jsonb_set(settlements, ARRAY[$2, 'gold'], to_jsonb($3::numeric)), updated_at = now()
         WHERE name = $1`,
      [name, keep.id, SEEDED_TREASURY_GOLD],
    );

    // The HUMAN seat funds the AI hero through the real command bus:
    // TransferGold withdraws the keep's treasury into the hero's purse,
    // clamped by heroGoldCap (treasuryWagons 5 x 500). This is the exact
    // human-side withdrawal flow, not a state poke.
    const funded = await command(name, {
      kind: "TransferGold", actor: HUMAN_SEAT, heroId: AI_HERO_ID, settlementId: keep.id, direction: "withdraw",
    });
    assert.equal(funded.status, 200, `TransferGold withdraw -> ${funded.status} ${JSON.stringify(funded.json)}`);
    assert.equal(funded.json?.hero?.gold, CHARTER_GOLD_COST,
      `AI hero purse=${funded.json?.hero?.gold}, expected exactly ${CHARTER_GOLD_COST}`);
    // The withdraw is clamped by the purse headroom (heroGoldCap = 5 treasury
    // carts x 500), so the hero's own starting purse rides along and only the
    // difference leaves the treasury -- the 5-cart <-> CHARTER_GOLD_COST pairing.
    const purseHeadroom = CHARTER_GOLD_COST - aiHero.gold;
    assert.equal(funded.json?.settlement?.gold, SEEDED_TREASURY_GOLD - purseHeadroom,
      `keep treasury=${funded.json?.settlement?.gold}, expected ` +
      `${SEEDED_TREASURY_GOLD - purseHeadroom} (seeded ${SEEDED_TREASURY_GOLD} minus the ${purseHeadroom} withdraw)`);
    console.log(`>> funded: ${AI_HERO_ID} purse ${funded.json.hero.gold}g (at its 5-cart cap), ` +
      `${keep.id} treasury ${funded.json.settlement.gold}g (still no browser)`);

    const gated = await serverRow(name);
    assert.equal(gated.heroes[AI_HERO_ID].gold, CHARTER_GOLD_COST, "the funding did not persist");
    assert.equal(gated.active_player_id, HUMAN_SEAT, "funding moved the active seat off the human");

    // --- the human seat's browser, opened and then CLOSED ------------------
    const browser: Browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = attachErrorCollectors(page);
    await openGame(page, name, game.id);
    const seen = await page.evaluate(() => {
      const st = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.();
      if (!st) return null;
      const ai = st.heroes?.["p1-hero"];
      return {
        phase: st.phase?.kind ?? "(none)",
        activePlayerId: st.activePlayerId,
        aiGold: ai?.gold ?? null,
        aiTile: ai ? { q: ai.q, r: ai.r } : null,
      };
    });
    assert.equal(seen?.phase, "PLAYER_TURN", `client phase=${JSON.stringify(seen?.phase)}, expected PLAYER_TURN`);
    assert.equal(seen?.activePlayerId, HUMAN_SEAT, `client activePlayerId=${seen?.activePlayerId}, expected ${HUMAN_SEAT}`);
    assert.equal(seen?.aiGold, CHARTER_GOLD_COST,
      `the human seat's client must see the funded AI hero (purse ${seen?.aiGold}, expected ${CHARTER_GOLD_COST})`);
    assert.deepEqual(seen?.aiTile, { q: aiHero.q, r: aiHero.r },
      `client AI hero tile ${JSON.stringify(seen?.aiTile)}, expected ${aiHero.q},${aiHero.r}`);
    console.log(`>> browser saw the funded AI hero (purse ${seen?.aiGold}) with zero console/page errors`);
    assert.equal(consoleErrors.length, 0, `console/page errors before closing the browser:\n${consoleErrors.join("\n")}`);

    // THE POINT OF THIS SUITE: from here on there is no browser at all. Every
    // remaining turn is a plain HTTP EndTurn from the human seat; the AI seat
    // is driven entirely in-process by the server-side driver.
    await browser.close();
    console.log(">> browser CLOSED -- everything after this line is server-driven");

    // --- drive the game to completion over the API -------------------------
    const baseline = (await serverRow(name)).settlements;
    const snaps: TurnSnap[] = [];
    let founded: TurnSnap["newAiSettlement"] = null;
    for (let turn = 1; turn <= MAX_AI_TURNS && !founded; turn++) {
      const before = await serverRow(name);
      assert.equal(before.active_player_id, HUMAN_SEAT,
        `turn ${turn}: the human seat must be active to end its turn (active_player_id=${before.active_player_id})`);
      const ended = await command(name, { kind: "EndTurn", actor: HUMAN_SEAT });
      assert.equal(ended.status, 200, `EndTurn #${turn} -> ${ended.status} ${JSON.stringify(ended.json)}`);
      assert.equal(ended.json?.activePlayerId, AI_SEAT,
        `EndTurn #${turn} handed the turn to ${ended.json?.activePlayerId}, expected the AI seat ${AI_SEAT}`);
      // State immediately after the human's turn, from that command's own
      // response -- the "before" side of every per-round delta below.
      const side = ended.json;
      const humanSide = {
        wood: side?.settlements?.[keep.id]?.warehouse?.wood ?? -1,
        stone: side?.settlements?.[keep.id]?.warehouse?.stone ?? -1,
        heroGold: side?.heroes?.[AI_HERO_ID]?.gold ?? -1,
      };
      assert(humanSide.wood >= 0 && humanSide.stone >= 0 && humanSide.heroGold >= 0,
        `EndTurn #${turn} response did not carry the AI keep/hero: ${JSON.stringify(humanSide)}`);

      // The driver now plays the whole AI turn with no client attached.
      await pollUntil(
        `the server driver to finish AI turn #${turn}`, AI_TURN_TIMEOUT_MS,
        async () => {
          const row = await serverRow(name);
          return row.active_player_id === HUMAN_SEAT && row.round > before.round ? row : null;
        },
      );
      const snap = await snapshot(name, keep.id, baseline);
      snap.humanSideWood = humanSide.wood;
      snap.humanSideStone = humanSide.stone;
      snap.humanSideHeroGold = humanSide.heroGold;
      snaps.push(snap);
      const charterBit = snap.charter
        ? `charter ${snap.charter.id} ${snap.charter.phase} d${snap.charter.days_remaining} @${snap.charter.target_q},${snap.charter.target_r}`
        : "no charter";
      const grownBit = snap.newAiSettlement ? ` | founded ${snap.newAiSettlement.name}` : "";
      console.log(`>> round ${snap.round} (day ${snap.day}): hero ${snap.heroQ},${snap.heroR} purse ${snap.aiSideHeroGold} | ` +
        `keep w${snap.humanSideWood}->${snap.aiSideWood} s${snap.humanSideStone}->${snap.aiSideStone} | ${charterBit}${grownBit}`);
      founded = snap.newAiSettlement;
    }
    assert(founded, `no AI-owned settlement appeared within ${MAX_AI_TURNS} AI turns (the charter never completed)`);

    // --- A. the driver FOUNDED the charter ---------------------------------
    const startedCount = await eventCount(name, "CharterStarted");
    assert.equal(startedCount, 1, `expected exactly one CharterStarted event, got ${startedCount}`);
    const startedId = await eventId(name, "CharterStarted");
    assert(startedId !== null, "the CharterStarted event row is missing");
    const foundingIdx = snaps.findIndex((s) => s.charter !== null);
    assert(foundingIdx >= 0, "no charter row was ever observed");
    const charter = snaps[foundingIdx].charter!;
    assert.equal(charter.hero_id, AI_HERO_ID, `charter hero=${charter.hero_id}`);
    assert.equal(charter.owner_id, AI_SEAT, `charter owner=${charter.owner_id}, expected the AI seat`);
    assert(charter.settlement_name.length > 0, "the charter has no settlement name");
    // The hero is funded up front, so the driver founds the charter on the very
    // first AI turn it ever drives -- snapshots[0] is that turn, read after the
    // round wrap it caused (its `round` is therefore the round that FOLLOWED
    // the founding turn).
    assert.equal(foundingIdx, 0,
      `the charter was first observed on snapshot ${foundingIdx} (round ${snaps[foundingIdx].round}) -- this fixture ` +
      `funds the hero before the browser closes, so the founding turn must be the driver's first AI turn`);

    // Founding-turn debits, measured against the AI keep's OWN steady
    // per-turn production (the later turns' human-side -> ai-side deltas):
    // exactly CHARTER_GOLD_COST off the hero purse and the warehouse cost out
    // of the founding settlement's stock. Round the deltas to 2dp -- the
    // columns are NUMERIC and the engine's own production is 2dp, so any
    // residual here is binary float noise, not state.
    const foundSnap = snaps[0];
    const later = snaps.slice(1);
    assert.equal(foundSnap.humanSideHeroGold, CHARTER_GOLD_COST,
      `the hero entered the founding turn with purse ${foundSnap.humanSideHeroGold}, expected ${CHARTER_GOLD_COST}`);
    assert.equal(foundSnap.aiSideHeroGold, 0,
      `the hero left the founding turn with purse ${foundSnap.aiSideHeroGold}, expected 0 (2500 spent)`);
    const woodDeltas = later.map((s) => round2(s.aiSideWood - s.humanSideWood));
    const stoneDeltas = later.map((s) => round2(s.aiSideStone - s.humanSideStone));
    const baselineWood = median(woodDeltas);
    const baselineStone = median(stoneDeltas);
    const woodNet = round2(foundSnap.aiSideWood - foundSnap.humanSideWood);
    const stoneNet = round2(foundSnap.aiSideStone - foundSnap.humanSideStone);
    assert.equal(woodNet, round2(baselineWood - CHARTER_WAREHOUSE_COST.wood),
      `the founding turn's net wood change was ${woodNet}, expected the keep's own ${baselineWood}/turn production ` +
      `minus exactly ${CHARTER_WAREHOUSE_COST.wood} (AI-turn deltas: ${JSON.stringify(woodDeltas)})`);
    assert.equal(stoneNet, round2(baselineStone - CHARTER_WAREHOUSE_COST.stone),
      `the founding turn's net stone change was ${stoneNet}, expected the keep's own ${baselineStone}/turn production ` +
      `minus exactly ${CHARTER_WAREHOUSE_COST.stone} (AI-turn deltas: ${JSON.stringify(stoneDeltas)})`);
    console.log(`>> founding debits exact: purse -${CHARTER_GOLD_COST}g ` +
      `(${foundSnap.humanSideHeroGold} -> ${foundSnap.aiSideHeroGold}), keep wood ${foundSnap.humanSideWood} -> ` +
      `${foundSnap.aiSideWood} (= ${baselineWood} production - ${CHARTER_WAREHOUSE_COST.wood}), stone ` +
      `${foundSnap.humanSideStone} -> ${foundSnap.aiSideStone} (= ${baselineStone} production - ${CHARTER_WAREHOUSE_COST.stone})`);

    // The target obeys the same human-parity placement rule the client's
    // overlay enforces (passable, >= 4 hexes from every settlement that
    // existed when the charter was founded -- the baseline set, not the final
    // one that already contains the settlement founded ON the target).
    const row = await serverRow(name);
    const map = new GameMap(Number(row.seed), row.map_size as "small" | undefined);
    const target: Axial = { q: charter.target_q, r: charter.target_r };
    assert(map.isPassable(target.q, target.r), `the charter target ${target.q},${target.r} is impassable`);
    for (const [sid, s] of Object.entries(baseline)) {
      assert(hexDistance(target, s) >= 4,
        `the charter target is only ${hexDistance(target, s)} hexes from settlement ${sid} (rule: >= 4)`);
    }
    assert(hexDistance(target, { q: aiHero.q, r: aiHero.r }) > 0,
      "the charter target must not be the founding hero's own tile");
    assert(founded.q === target.q && founded.r === target.r,
      `the settlement was founded at ${founded.q},${founded.r}, expected the charter target ${target.q},${target.r}`);
    assert.equal(founded.name, charter.settlement_name, "the founded settlement's name differs from the charter");
    assert.equal(founded.level, 1, `the founded settlement's level=${founded.level}, expected 1`);
    const aiPlayer = row.players.find((p) => p.id === AI_SEAT);
    assert(aiPlayer?.settlementIds.includes(founded.id),
      `players[${AI_SEAT}].settlementIds (${JSON.stringify(aiPlayer?.settlementIds)}) lacks ${founded.id}`);
    console.log(`>> target ${target.q},${target.r} is passable and >= 4 hexes from every settlement; ` +
      `${founded.name} founded there and rostered to seat ${AI_SEAT}`);

    // --- B. travel advanced over subsequent turns --------------------------
    const advanced = await eventCount(name, "CharterTravelAdvanced");
    assert(advanced >= 2, `expected >= 2 CharterTravelAdvanced steps for a multi-turn travel, got ${advanced}`);
    const movedWhileChartering = await eventCountAfter(name, "HeroMoved", startedId!, AI_HERO_ID);
    assert.equal(movedWhileChartering, 0,
      `a chartering hero must never MoveHero (${movedWhileChartering} HeroMoved events for ${AI_HERO_ID} after CharterStarted)`);
    const dists = [hexDistance({ q: aiHero.q, r: aiHero.r }, target),
      ...snaps.map((s) => hexDistance({ q: s.heroQ, r: s.heroR }, target))];
    for (let i = 1; i < dists.length; i++) {
      assert(dists[i] <= dists[i - 1],
        `the hero moved away from its charter target on round ${snaps[i - 1].round}: distance ${dists[i - 1]} -> ${dists[i]}`);
    }
    assert(dists[0] > 0, "the charter target must not be the hero's own tile");
    assert(dists.length >= 3 && dists[1] < dists[0],
      `travel must advance during the founding turn itself (distances ${JSON.stringify(dists)})`);
    assert.equal(dists[dists.length - 1], 0,
      `the hero never arrived at its charter target (final distance ${dists[dists.length - 1]}); distances ${JSON.stringify(dists)}`);
    const constructing = snaps.find((s) => s.charter?.phase === "constructing");
    assert(constructing, "the charter never flipped to constructing");
    assert.equal(constructing.heroQ, target.q, "the charter flipped to constructing off the target tile (q)");
    assert.equal(constructing.heroR, target.r, "the charter flipped to constructing off the target tile (r)");
    assert(constructing.round >= 3,
      `travel finished inside the founding turn (round ${constructing.round}) -- this fixture must need two turns`);
    console.log(`>> travel: distance ${dists[0]} -> 0 across rounds ${snaps[0].round}..${constructing.round} ` +
      `(${advanced} CharterTravelAdvanced steps, 0 MoveHero); the charter flipped to constructing on the target tile`);

    // --- C. construction ran its full course -------------------------------
    const daySequence = snaps.filter((s) => s.charter).map((s) => s.charter!.days_remaining);
    assert.equal(daySequence[0], CHARTER_CONSTRUCTION_DAYS,
      `a new charter starts with ${CHARTER_CONSTRUCTION_DAYS} construction days, got ${daySequence[0]}`);
    for (let i = 1; i < daySequence.length; i++) {
      assert(daySequence[i] <= daySequence[i - 1], `days_remaining went backwards: ${daySequence[i - 1]} -> ${daySequence[i]}`);
    }
    assert.equal(daySequence[0] - daySequence[daySequence.length - 1], CHARTER_CONSTRUCTION_DAYS - 1,
      `days_remaining should fall from ${CHARTER_CONSTRUCTION_DAYS} to 1 before completion, saw ${JSON.stringify(daySequence)}`);
    const foundingRound = snaps.find((s) => s.newAiSettlement)!.round;
    // Snapshot rounds lag the AI turn that produced them by one (a snapshot is
    // read after that turn's round wrap), so the observed gap between the
    // constructing flip and completion is CHARTER_CONSTRUCTION_DAYS - 1: the
    // flip's own wrap is the first decrement and the last wrap is the founding.
    assert.equal(foundingRound - constructing.round, CHARTER_CONSTRUCTION_DAYS - 1,
      `construction completed ${foundingRound - constructing.round} snapshot rounds after the flip, expected ` +
      `${CHARTER_CONSTRUCTION_DAYS - 1} (snapshots ${constructing.round}..${foundingRound})`);
    const afterRow = await serverRow(name);
    assert.equal(await charterRow(name), null, "the completed charter still has an active row");
    console.log(`>> construction: days_remaining ${daySequence[0]} -> ${daySequence[daySequence.length - 1]} observed over ` +
      `snapshot rounds ${constructing.round}..${foundingRound - 1}, then ${founded.name} was founded and its charter row retired`);

    // --- D. the human seat is untouched by the AI's chartering -------------
    const humanHero = afterRow.heroes[HUMAN_HERO_ID];
    assert.equal(humanHero.ownerId, HUMAN_SEAT, "the human hero changed owner");
    assert.equal(humanHero.isChartering, false, "the AI's chartering leaked onto the human hero");
    assert.equal(humanHero.charterId, null, "the human hero carries a charterId");
    const humanNow = Object.entries(afterRow.settlements).filter(([, s]) => s.ownerId === HUMAN_SEAT);
    const humanBefore = Object.entries(baseline).filter(([, s]) => s.ownerId === HUMAN_SEAT);
    assert.deepEqual(
      humanNow.map(([id, s]) => `${id}:${s.q},${s.r}:${s.name}`).sort(),
      humanBefore.map(([id, s]) => `${id}:${s.q},${s.r}:${s.name}`).sort(),
      "the human seat's settlement set changed",
    );
    const charterRowsLeft = await db.query(
      `SELECT id, owner_id FROM charters WHERE game_id = (SELECT id FROM games WHERE name = $1)`, [name]);
    assert.equal(charterRowsLeft.rowCount ?? 0, 0, "a charter row outlived the completed charter");
    assert.equal(snaps.filter((s) => s.charter && s.charter.owner_id === HUMAN_SEAT).length, 0,
      "a charter was ever attributed to the human seat");
    assert.equal(await eventCount(name, "CharterStarted"), 1, "a second charter was started (seat leakage?)");
    console.log(`>> human seat untouched: hero ${HUMAN_HERO_ID} not chartering, ` +
      `${humanBefore.length} settlements unchanged in place/owner, zero seat-0 charters`);

    console.log(">> aiCharter.e2e: ALL TESTS PASSED");
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
