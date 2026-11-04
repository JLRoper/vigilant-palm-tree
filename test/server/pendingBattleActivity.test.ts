import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GameMap, normalizePlatoons } from "@heroes/engine";
import { HEX_DIRECTIONS, hexDistance } from "@heroes/contracts";
import type { Axial, HeroId, HeroState, Platoon } from "@heroes/contracts";
import { initSchema, pool } from "../../server/db";
import {
  createLiveCommandDeps,
  handleCommandTransactional,
  type LiveCommandDeps,
} from "../../server/app/commandHandler";
import {
  AI_DEFENDER_WAIT_EXPIRED_AUDIT_KIND,
  AI_DEFENDER_WAIT_TIMEOUT_MS,
  configureAiDriver,
  resetAiDriver,
  scanOnce,
} from "../../server/app/aiDriver";
import { makeHero, makePlayer } from "../charter/_helpers";

// The manual fight the player is winning must not be force-resolved out from
// under them (the reader's card). Real Express-free but REAL pipeline: the
// live command handler (server/app/commandHandler.ts) against real Postgres,
// then the real scanner pass (server/app/aiDriver.ts's scanOnce with its
// default hydration, dispatch, audit and advisory lock; only candidate
// DISCOVERY is scoped to the game under test so the pass cannot drive the
// other flagged games sharing this database).
//
// The defect this file pins, measured on github/main (see the report):
// the deadline was measured from the offer alone
// (cfg.now() - pending.since), so an arena the player was still fighting in
// was force-resolved the moment the offer was 300s old -- the server wrote
// its own BattleResolved, cleared lobby.pendingBattle, and the human's own
// SubmitBattleResult then answered 409 battle_not_pending while the world
// kept the server's troops. The fix measures the IDLE gap instead: the offer
// stays live while a battle_actions row for the pair (a played action, or the
// arena's own heartbeat) is fresh, and the deadline still fires when nothing
// has touched the fight for the whole window.

const SEED = 424242;
const MAP_SIZE = "small" as const;
const HUMAN: HeroId = "p0-hero";
const ATTACKER: HeroId = "p1-hero";
const HUMAN_TROOPS = 24;
const ATTACKER_TROOPS = 15;

// The reader's reproduction numbers: the offer was 306779ms old against a
// 300000ms deadline, with the arena's own traffic inside that window.
const TOTAL_ELAPSED_MS = 306_779;
const IDLE_GAP_MS = 6_779;

let deps: LiveCommandDeps;

before(async () => {
  await initSchema();
  deps = await createLiveCommandDeps();
  assert.equal(AI_DEFENDER_WAIT_TIMEOUT_MS, 300_000, "the product deadline is 300s");
});

after(async () => {
  await pool.end();
});

function uniqueName(): string {
  return `pb-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function troopStacks(count: number): Platoon[] {
  return count > 0
    ? normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count }] }])
    : normalizePlatoons([{ entries: [] }]);
}

function troopCount(hero: HeroState | undefined): number {
  if (!hero) return 0;
  return hero.stacks.reduce((sum, platoon) => sum + platoon.entries.reduce((n, e) => n + e.count, 0), 0);
}

// Two ADJACENT passable tiles on the fixture seed: detectAdjacentEnemy() (the
// handler's own live-collision precondition) is pure hex adjacency, and the
// driver's GameMap reconstruction wants real terrain under both heroes.
function adjacentPassablePair(): { human: Axial; attacker: Axial } {
  const map = new GameMap(SEED, MAP_SIZE);
  const tiles: Axial[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (map.isPassable(q, r)) tiles.push({ q, r });
    }
  }
  for (const human of tiles) {
    for (const dir of HEX_DIRECTIONS) {
      const candidate = { q: human.q + dir.q, r: human.r + dir.r };
      if (tiles.some((t) => t.q === candidate.q && t.r === candidate.r)) {
        return { human, attacker: candidate };
      }
    }
  }
  throw new Error(`no adjacent passable pair on seed ${SEED}`);
}

// The fixture: seat 0 is the human defender standing next to an AI seat-1
// attacker, on the AI's turn, in a server-driven game -- the exact shape the
// driver's EnterBattle offer arrives in. The attacker's movement is spent so
// the pass cannot wander off and re-offer after it resolves the pair.
async function seedOfferableGame(name: string): Promise<void> {
  const { human, attacker } = adjacentPassablePair();
  assert.equal(hexDistance(human, attacker), 1, "the fixture heroes must be adjacent");
  const heroes: Record<HeroId, HeroState> = {
    [HUMAN]: makeHero(HUMAN, 0, human.q, human.r, {
      movementRemaining: 0,
      troops: HUMAN_TROOPS,
      stacks: troopStacks(HUMAN_TROOPS),
    }),
    [ATTACKER]: makeHero(ATTACKER, 1, attacker.q, attacker.r, {
      movementRemaining: 0,
      troops: ATTACKER_TROOPS,
      stacks: troopStacks(ATTACKER_TROOPS),
    }),
  };
  const players = [makePlayer(0, "player", [HUMAN], []), makePlayer(1, "ai", [ATTACKER], [])];
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, round, day, players, heroes, settlements, map_size, lobby)
     VALUES ($1, $2, $3, $4, 1, 1, 1, $5::jsonb, $6::jsonb, '{}'::jsonb, 'small', '{"aiDriver":"server"}'::jsonb)`,
    [name, SEED, human.q, human.r, JSON.stringify(players), JSON.stringify(heroes)],
  );
}

// The offer itself, through the real handler -- the same EnterBattle the AI
// driver dispatches when its hero walks into a human.
async function offerBattle(name: string): Promise<void> {
  const offered = await handleCommandTransactional(
    { kind: "EnterBattle", gameName: name, actor: 1, attackerId: ATTACKER, defenderId: HUMAN },
    deps,
  );
  assert.equal(offered.ok, true, `EnterBattle refused: ${offered.reason}`);
  const marker = await pendingMarker(name);
  assert.equal(marker?.attackerId, ATTACKER, "the offer stamped the pending marker for this pair");
  assert.equal(marker?.defenderId, HUMAN);
}

async function pendingMarker(name: string): Promise<{ attackerId: string; defenderId: string; since: number } | null> {
  const r = await pool.query<{ pending: { attackerId: string; defenderId: string; since: number } | null }>(
    `SELECT lobby->'pendingBattle' AS pending FROM games WHERE name = $1`,
    [name],
  );
  return r.rows[0]?.pending ?? null;
}

// Age the offer without waiting 300 real seconds: the marker's own `since` is
// what the driver measures against.
async function ageOffer(name: string, ageMs: number): Promise<void> {
  await pool.query(
    `UPDATE games SET lobby = jsonb_set(lobby, '{pendingBattle,since}', to_jsonb($2::bigint)) WHERE name = $1`,
    [name, Date.now() - ageMs],
  );
}

// One arena row for the pair (a played action, the seed row, or the arena's
// own heartbeat) as the client's fire-and-forget stream writes it.
async function arenaRow(name: string, phase: string, ageMs: number, seq = 0): Promise<void> {
  await pool.query(
    `INSERT INTO battle_actions (game_name, seat, attacker_id, defender_id, seq, phase, payload, created_at)
     VALUES ($1, 0, $2, $3, $4, $5, '{}'::jsonb, to_timestamp($6::bigint / 1000.0))`,
    [name, ATTACKER, HUMAN, seq, phase, Date.now() - ageMs],
  );
}

async function battleResolvedRows(
  name: string,
): Promise<Array<{ id: string; actor_seat: number | null; payload: Record<string, unknown> }>> {
  const r = await pool.query(
    `SELECT e.id, e.actor_seat, e.payload
       FROM game_events e JOIN games g ON g.id = e.game_id
      WHERE g.name = $1 AND e.kind = 'BattleResolved'
      ORDER BY e.id`,
    [name],
  );
  return r.rows;
}

async function auditRows(name: string, kind: string): Promise<Array<Record<string, unknown>>> {
  const r = await pool.query(
    `SELECT e.payload FROM game_events e JOIN games g ON g.id = e.game_id
      WHERE g.name = $1 AND e.kind = $2 ORDER BY e.id`,
    [name, kind],
  );
  return r.rows.map((row) => row.payload);
}

async function heroes(name: string): Promise<Record<string, HeroState>> {
  const r = await pool.query<{ heroes: Record<string, HeroState> }>(
    `SELECT heroes FROM games WHERE name = $1`,
    [name],
  );
  return r.rows[0].heroes;
}

// Candidate discovery is scoped; everything else in the pass is the real
// thing (default hydration, dispatch through handleCommandTransactional, the
// per-game advisory lock, the audit append).
function configureDriverFor(name: string, id: number): void {
  resetAiDriver();
  configureAiDriver({
    loadCandidates: async () => [{ name, id, active_player_id: 1 }],
  });
}

async function gameId(name: string): Promise<number> {
  const r = await pool.query<{ id: number }>(`SELECT id FROM games WHERE name = $1`, [name]);
  return r.rows[0].id;
}

async function deleteGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

// The player's own played-out result: the human defender stood and kept all
// 24 platoons; the AI attacker was wiped.
async function submitPlayedResult(
  name: string,
): Promise<{ ok: boolean; reason?: string }> {
  return handleCommandTransactional(
    {
      kind: "SubmitBattleResult",
      gameName: name,
      actor: 0,
      attackerId: ATTACKER,
      defenderId: HUMAN,
      outcome: "defenderWon",
      attackerStacks: troopStacks(0),
      defenderStacks: troopStacks(HUMAN_TROOPS),
      rounds: 3,
      obstacleSeed: 20261103,
    },
    deps,
  );
}

test("an ACTIVELY fought battle stays live: the played result lands and the server writes no forced resolution", async () => {
  const name = uniqueName();
  await seedOfferableGame(name);
  try {
    await offerBattle(name);
    // 306779ms since the offer), but the arena is alive: its own row for this
    // pair landed 6779ms ago.
    await ageOffer(name, TOTAL_ELAPSED_MS);
    await arenaRow(name, "heartbeat", IDLE_GAP_MS, 12);
    configureDriverFor(name, await gameId(name));

    await scanOnce();

    const forced = await battleResolvedRows(name);
    const markerAfterScan = await pendingMarker(name);
    const audits = await auditRows(name, AI_DEFENDER_WAIT_EXPIRED_AUDIT_KIND);
    console.log(
      `>> [active fight] offer age ${TOTAL_ELAPSED_MS}ms, idle gap ${IDLE_GAP_MS}ms -> ` +
        `BattleResolved=${forced.length} wait-expired audits=${audits.length} marker=${JSON.stringify(markerAfterScan)}`,
    );
    assert.equal(
      forced.length,
      0,
      `the driver force-resolved a battle the arena was still playing (${JSON.stringify(forced.map((r) => r.payload))})`,
    );
    assert.ok(markerAfterScan, "the pending marker must survive while the fight is live");
    assert.equal(audits.length, 0, "a live fight appends no wait-expired audit");

    // The result the player actually played is the one that lands.
    const submitted = await submitPlayedResult(name);
    assert.equal(submitted.ok, true, `the played result was refused: ${submitted.reason}`);
    const after = await heroes(name);
    assert.equal(troopCount(after[HUMAN]), HUMAN_TROOPS, "the world kept the player's surviving troops");
    assert.equal(after[ATTACKER], undefined, "the player's win removed the attacker");
    const rows = await battleResolvedRows(name);
    assert.equal(rows.length, 1, "exactly one BattleResolved for this battle");
    assert.equal(rows[0].actor_seat, 0, "the resolution is the human's own submission");
    assert.equal(rows[0].payload.winner, "defender");
    assert.equal(await pendingMarker(name), null, "resolving cleared the offer");
  } finally {
    resetAiDriver();
    await deleteGame(name);
  }
});

test("a genuinely idle offer still expires: ONE server resolution, the offer cleared, the world keeps the server's troops", async () => {
  const name = uniqueName();
  await seedOfferableGame(name);
  try {
    await offerBattle(name);
    // The arena opened once (its seed row), then the browser went away: no row
    // for the pair inside the whole window.
    await ageOffer(name, TOTAL_ELAPSED_MS + 100_000);
    await arenaRow(name, "start", TOTAL_ELAPSED_MS + 1_000);
    configureDriverFor(name, await gameId(name));

    await scanOnce();

    const forced = await battleResolvedRows(name);
    console.log(
      `>> [idle fight] nowhere touched the pair for ${TOTAL_ELAPSED_MS + 1_000}ms -> ` +
        `BattleResolved=${forced.length} actor=${forced[0]?.actor_seat} payload=${JSON.stringify(forced[0]?.payload)}`,
    );
    assert.equal(forced.length, 1, "the deadline must still fire on a genuinely idle offer");
    assert.equal(forced[0].actor_seat, 1, "the resolution is the server's own (the AI seat resolves)");
    assert.equal(await pendingMarker(name), null, "the forced resolution cleared the offer");

    // The human's own submission can no longer land: the world already holds
    // the server's outcome, and that is what the client must adopt.
    const submitted = await submitPlayedResult(name);
    console.log(`>> [idle fight] the human's SubmitBattleResult answered: ok=${submitted.ok} reason=${submitted.reason}`);
    assert.equal(submitted.ok, false);
    assert.equal(submitted.reason, "battle_not_pending");
    assert.equal((await battleResolvedRows(name)).length, 1, "the refusal wrote no second resolution");
    assert.notEqual(await heroes(name).then((h) => h[HUMAN]), undefined, "the server's resolution left the defender alive");
  } finally {
    resetAiDriver();
    await deleteGame(name);
  }
});

test("the deadline counts the IDLE gap, not the total elapsed since the offer", async () => {
  const name = uniqueName();
  await seedOfferableGame(name);
  try {
    await offerBattle(name);
    await ageOffer(name, TOTAL_ELAPSED_MS);
    await arenaRow(name, "move", IDLE_GAP_MS, 4);
    configureDriverFor(name, await gameId(name));

    await scanOnce();

    const audits = await auditRows(name, AI_DEFENDER_WAIT_EXPIRED_AUDIT_KIND);
    assert.equal(audits.length, 0, "inside the idle window there is nothing to expire");
    const after = await heroes(name);
    assert.equal(troopCount(after[HUMAN]), 24, "an arena action inside the window keeps the fight live");
    assert.ok(await pendingMarker(name), "the offer is still pending");
  } finally {
    resetAiDriver();
    await deleteGame(name);
  }
});
