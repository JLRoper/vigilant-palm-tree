import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, HeroId, HeroState, Player, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { normalizePlatoons } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import { createHeroRepo } from "../../server/persistence/repositories/heroRepo";
import type { Queryable } from "../../server/persistence/repositories/gameRepo";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";
import { makeCharter } from "../charter/_helpers";

// Server-side coverage for the SubmitBattleResult command
// (plan/2026-09-27-manual-battle-wiring.md, work item 4): the manual arena's
// played-out outcome, applied through the SAME shared post-battle helpers
// (buildPostBattleHeroes/persistBattleOutcome) the auto-resolver runs. The
// assertions below pin the parity that factoring was supposed to guarantee:
// loot-on-wipe identical to ResolveBattle's shape, survivor stacks restored
// verbatim, retreat/surrender cancelling the attacker's move, and the
// BattleResolved event derived from the submitted outcome. Since
// plan/2026-09-29-hero-outcomes.md (W2a) the post-battle rules extend with
// per-hero verdicts: a defeated side's hero is deleted outright (heroes
// record + owner heroIds + platoon rows), retreat relocates the conceder to
// the nearest OWNED settlement with emptied stacks (or keeps them put, D1),
// surrender relocates keeping stacks and the gold debit. handleCommand is
// called directly against test/helpers/mockRepos.ts (same harness as
// commandHandler.test.ts); the wire-shape half of the validation lives in
// parseCommand, which this harness never runs -- see commandsRoute.test.ts's
// header for why that split exists.

function makeHero(id: HeroId, ownerId: number, q: number, r: number, overrides: Partial<HeroState> = {}): HeroState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    movementRemaining: 7,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q, r }],
    gold: 0,
    troops: 1,
    stacks: [],
    isChartering: false,
    charterId: null,
    horseVariant: "bubbly",
    ...overrides,
  };
}

function makeSettlement(
  id: SettlementId,
  ownerId: number | null,
  q: number,
  r: number,
  overrides: Partial<SettlementState> = {},
): SettlementState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    level: 1,
    population: 0,
    goldTax: 0,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    autoTrade: true,
    castleVariant: 0,
    buildings: [],
    ...overrides,
  };
}

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
];

function makeRow(heroes: HeroState[], overrides: Partial<HydratableGameRow> = {}): HydratableGameRow {
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: { s0: makeSettlement("s0", 0, 0, 0) },
    ...overrides,
  };
}

const UNIT_TYPES: UnitType[] = [
  {
    id: "swordsman",
    name: "Swordsman",
    attack: 5,
    defence: 5,
    health: 20,
    speed: 3,
    description: "",
    advantageType: "infantry",
    specialty: "shield",
    specialtyPriority: 0,
  },
];

function makeDeps(row: HydratableGameRow, unitTypes: UnitType[] = UNIT_TYPES) {
  const gameRepo = createMockGameRepo({ [row.name as string]: row });
  const eventRepo = createMockEventRepo();
  const heroRepo = createMockHeroRepo({ [row.name as string]: row.heroes });
  const settlementRepo = createMockSettlementRepo({ [row.name as string]: row.settlements });
  const charterRepo = createMockCharterRepo();
  return {
    gameRepo,
    eventRepo,
    heroRepo,
    settlementRepo,
    charterRepo,
    deps: { gameRepo, eventRepo, heroRepo, settlementRepo, charterRepo, ctx: { rng: () => 0.5, catalog: { unitTypes } } },
  };
}

function stack(unitTypeId: string, count: number): Platoon {
  return { entries: [{ unitTypeId, count }] };
}

// The canonical collision fixture: h0 (the human's attacker, seat 0) walked
// from (2,2) into (3,2) where the AI's h1 stands -- previousQ/R/movement
// populated exactly like startMove leaves them, which is what the
// retreat/surrender cancel path restores.
function makeBattleRow(attackerOverrides: Partial<HeroState> = {}, defenderOverrides: Partial<HeroState> = {}): HydratableGameRow {
  return makeRow([
    makeHero("h0", 0, 3, 2, {
      gold: 100,
      stacks: [stack("swordsman", 5)],
      previousQ: 2,
      previousR: 2,
      previousMovementRemaining: 7,
      movementRemaining: 6,
      ...attackerOverrides,
    }),
    makeHero("h1", 1, 3, 3, { gold: 250, stacks: [], ...defenderOverrides }),
  ]);
}

function submitCommand(overrides: Partial<Extract<Command, { kind: "SubmitBattleResult" }>> = {}): Extract<Command, { kind: "SubmitBattleResult" }> {
  return {
    kind: "SubmitBattleResult",
    gameName: "test-game",
    actor: 0,
    attackerId: "h0",
    defenderId: "h1",
    outcome: "attackerWon",
    attackerStacks: [stack("swordsman", 3)],
    defenderStacks: [],
    rounds: 7,
    obstacleSeed: 42,
    ...overrides,
  };
}

test("attackerWon loots the wiped defender's purse, then REMOVES the defender (hero row, heroIds, platoons)", async () => {
  const row = makeBattleRow();
  const { gameRepo, eventRepo, heroRepo, deps } = makeDeps(row);
  const result = await handleCommand(submitCommand(), deps);
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  // Attacker: submitted survivors + the defender's looted gold (loot lands
  // BEFORE the removal -- the winner keeps the purse).
  assert.equal(saved.heroes.h0.gold, 100 + 250);
  assert.deepEqual(saved.heroes.h0.stacks, normalizePlatoons([stack("swordsman", 3)]));
  assert.equal(saved.heroes.h1, undefined, "the wiped defender's hero row is deleted");
  assert.deepEqual(
    saved.players.find((p) => p.id === 1)?.heroIds,
    [],
    "removed hero pruned from their owner's heroIds",
  );
  assert.equal("h1" in heroRepo.calls[0].value, false, "the granular heroes upsert is a full sync -- h1 is gone there too");

  const event = eventRepo.events[0];
  assert.equal(event.kind, "BattleResolved");
  assert.deepEqual(event.payload, {
    type: "BattleResolved",
    actor: 0,
    attackerId: "h0",
    defenderId: "h1",
    winner: "attacker",
    attackerOutcome: "won",
    defenderOutcome: "lost_all_troops",
    attackerVerdict: "stood",
    defenderVerdict: "defeated",
    rewardGold: 250,
    rounds: 7,
    obstacleSeed: 42,
  });
  // The command's rounds/obstacleSeed ride the event verbatim -- the seed
  // must be the arena's real one for the future re-simulation consumer.
  assert.deepEqual(result.attackerHero, saved.heroes.h0);
  assert.equal(result.defenderHero, undefined, "the removed defender is omitted from the result");
  assert.equal(result.attackerVerdict, "stood");
  assert.equal(result.defenderVerdict, "defeated");
});

test("retreat empties the conceding hero's stacks and relocates them to the nearest OWNED settlement", async () => {
  const row = makeBattleRow({ stacks: [stack("swordsman", 4)] }, { stacks: [stack("swordsman", 2)] });
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({
      outcome: "retreat",
      attackerStacks: [stack("swordsman", 3)],
      defenderStacks: [stack("swordsman", 2)],
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"].heroes;
  // s0 (0,0) is seat 0's only settlement: h0 respawns there regardless of
  // the submitted survivors -- retreat loses ALL troops server-side (the
  // arena's pre-submitted 15%-loss stacks are subsumed), and the
  // cancelMove-restored position is overwritten by the relocation.
  assert.equal(saved.h0.q, 0);
  assert.equal(saved.h0.r, 0);
  assert.equal(saved.h0.movementRemaining, MOVEMENT_PER_TURN);
  assert.equal(saved.h0.previousQ, null);
  assert.deepEqual(saved.h0.trail, [{ q: 0, r: 0 }]);
  assert.equal(saved.h0.gold, 100, "no loot on a retreat");
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([]));
  assert.equal(saved.h0.troops, 0, "the denormalized troops counter is zeroed along with the stacks");
  // The defender stood: survivors and purse untouched at the collision hex.
  assert.equal(saved.h1.q, 3);
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([stack("swordsman", 2)]));
  assert.equal(saved.h1.gold, 250);

  const event = eventRepo.events[0];
  assert.equal(event.payload.winner, "defender");
  assert.equal(event.payload.attackerOutcome, "retreated_hero");
  assert.equal(event.payload.defenderOutcome, "won");
  assert.equal(event.payload.attackerVerdict, "retreated");
  assert.equal(event.payload.defenderVerdict, "stood");
  assert.equal(event.payload.rewardGold, 0);
  assert.deepEqual(result.attackerHero, saved.h0);
  assert.deepEqual(result.defenderHero, saved.h1);
  assert.equal(result.attackerVerdict, "retreated");
});

test("retreat with no owned settlement keeps the hero at the cancelled position with empty stacks (D1)", async () => {
  const row = makeBattleRow({ stacks: [stack("swordsman", 4)] }, { stacks: [stack("swordsman", 2)] });
  // Seat 0 holds nothing: s0 belongs to the AI, so relocation has nothing to
  // respawn to -- the hero stays where cancelMove put it, troops still lost.
  row.settlements = { s0: makeSettlement("s0", 1, 0, 0) };
  row.players = [
    { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: [] },
    { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s0"] },
  ];
  const { gameRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({
      outcome: "retreat",
      attackerStacks: [stack("swordsman", 3)],
      defenderStacks: [stack("swordsman", 2)],
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"].heroes;
  assert.equal(saved.h0.q, 2, "stays at the cancelMove-restored position");
  assert.equal(saved.h0.r, 2);
  assert.equal(saved.h0.previousQ, null, "the cancel itself still applies");
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([]), "troops still lost without a relocation target");
  assert.equal(saved.h0.troops, 0, "troops counter zeroed even on the D1 stay-put edge");
});

test("surrender deducts the paid gold from the CONCEDING hero and relocates them, keeping their army", async () => {
  const row = makeBattleRow({ stacks: [stack("swordsman", 5)] }, { stacks: [stack("swordsman", 6)] });
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({
      outcome: "surrender",
      attackerStacks: [stack("swordsman", 5)],
      defenderStacks: [stack("swordsman", 6)],
      surrenderedGold: 40,
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"].heroes;
  // The actor (seat 0) owns h0, so h0 is the conceding hero: purse debited,
  // relocated to s0 (0,0) with the submitted army kept whole (surrender skips
  // the retreat loss, unlike a retreat's stack wipe).
  assert.equal(saved.h0.gold, 100 - 40);
  assert.equal(saved.h0.q, 0, "surrender relocates like a retreat");
  assert.equal(saved.h0.r, 0);
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([stack("swordsman", 5)]));
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([stack("swordsman", 6)]));
  assert.equal(saved.h1.gold, 250);

  const event = eventRepo.events[0];
  assert.equal(event.payload.winner, "defender");
  assert.equal(event.payload.attackerOutcome, "retreated_hero");
  assert.equal(event.payload.attackerVerdict, "surrendered");
  assert.equal(event.payload.defenderVerdict, "stood");
  assert.equal(event.payload.rewardGold, 0);
  assert.equal(result.attackerVerdict, "surrendered");
  assert.deepEqual(result.attackerHero, saved.h0);
});

test("surrender is rejected when the paid gold exceeds the conceding hero's purse", async () => {
  const row = makeBattleRow();
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({ outcome: "surrender", surrenderedGold: 40_000 }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "surrender_gold_exceeds_purse");
  assert.equal(eventRepo.events.length, 0);
  // Nothing was persisted.
  assert.equal(gameRepo.rows["test-game"].heroes.h0.gold, 100);
});

test("surrender by a DEFENDER-side human debits and relocates the defender (conceding hero is derived from actor ownership)", async () => {
  // The "enemy moved onto me" case: seat 0's hero is the defender. The
  // arena's surrender is the human's action, so the deduction and the
  // relocation must land on h1 (owned by the actor), not on the attacker role.
  const row = makeBattleRow(
    { ownerId: 1, gold: 300, stacks: [stack("swordsman", 4)] },
    { ownerId: 0, gold: 90, stacks: [stack("swordsman", 7)] },
  );
  const { gameRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({
      actor: 0,
      outcome: "surrender",
      attackerStacks: [stack("swordsman", 4)],
      defenderStacks: [stack("swordsman", 7)],
      surrenderedGold: 30,
    }),
    deps,
  );
  assert.equal(result.ok, true);
  const saved = gameRepo.rows["test-game"].heroes;
  assert.equal(saved.h1.gold, 90 - 30, "defender-side concession debits the defender (h1 is owned by the actor)");
  assert.equal(saved.h1.q, 0, "the conceding defender relocates to their seat's settlement");
  assert.equal(saved.h1.r, 0);
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([stack("swordsman", 7)]), "surrender keeps the submitted stacks");
  assert.equal(saved.h0.gold, 300, "attacker keeps their purse");
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([stack("swordsman", 4)]), "the stood attacker keeps their survivors");
  // The ATTACKER's move is the one cancelled (decision 3 applies to the
  // mover regardless of who conceded), and with no concession the attacker
  // keeps that cancelled position -- h0 is the attacker role here even
  // though seat 1 owns it.
  assert.equal(saved.h0.q, 2, "attacker's move cancelled server-side");
  assert.equal(saved.h0.r, 2);
});

test("draw keeps both armies and loots nobody", async () => {
  const row = makeBattleRow({ stacks: [stack("swordsman", 5)] }, { stacks: [stack("swordsman", 5)] });
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({ outcome: "draw", attackerStacks: [stack("swordsman", 5)], defenderStacks: [stack("swordsman", 5)] }),
    deps,
  );
  assert.equal(result.ok, true);
  const saved = gameRepo.rows["test-game"].heroes;
  assert.equal(saved.h0.gold, 100, "stalemate loots nobody");
  assert.equal(saved.h1.gold, 250);
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([stack("swordsman", 5)]));
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([stack("swordsman", 5)]));
  // No move cancellation on a draw -- nobody conceded, the attacker stands
  // where the collision happened, same as a win/loss.
  assert.equal(saved.h0.q, 3);
  assert.equal(saved.h0.previousQ, 2, "draw does NOT cancel the attacker's move");

  const event = eventRepo.events[0];
  assert.equal(event.payload.winner, "draw");
  assert.equal(event.payload.attackerOutcome, "survived");
  assert.equal(event.payload.defenderOutcome, "survived");
  assert.equal(event.payload.attackerVerdict, "stood");
  assert.equal(event.payload.defenderVerdict, "stood");
});

test("defenderWon REMOVES the wiped attacker entirely; no reverse loot", async () => {
  const row = makeBattleRow({ stacks: [stack("swordsman", 5)] }, { stacks: [stack("swordsman", 8)] });
  const { gameRepo, eventRepo, heroRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({ outcome: "defenderWon", attackerStacks: [], defenderStacks: [stack("swordsman", 8)] }),
    deps,
  );
  assert.equal(result.ok, true);
  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.heroes.h0, undefined, "the wiped attacker is deleted from the heroes record");
  assert.deepEqual(
    saved.players.find((p) => p.id === 0)?.heroIds,
    [],
    "attacker pruned from seat 0's heroIds",
  );
  assert.equal("h0" in heroRepo.calls[0].value, false);
  assert.equal(saved.heroes.h1.gold, 250, "loot only ever flows defender→attacker -- no reverse loot");
  assert.deepEqual(saved.heroes.h1.stacks, normalizePlatoons([stack("swordsman", 8)]));

  const event = eventRepo.events[0];
  assert.equal(event.payload.winner, "defender");
  assert.equal(event.payload.attackerOutcome, "lost_all_troops");
  assert.equal(event.payload.defenderOutcome, "won");
  assert.equal(event.payload.attackerVerdict, "defeated");
  assert.equal(event.payload.defenderVerdict, "stood");
  assert.equal(event.payload.rewardGold, 0);
  assert.equal(result.attackerHero, undefined, "the removed attacker is omitted from the result");
  assert.deepEqual(result.defenderHero, saved.heroes.h1);
  assert.equal(result.attackerVerdict, "defeated");
});

test("non-adjacent heroes are rejected -- the server-side equivalent of 'phase is BATTLE for this pair'", async () => {
  // The server never persists a BATTLE phase (hydration always derives
  // PLAYER_TURN/AI_TURN), so the handler re-derives the live-collision
  // precondition via detectAdjacentEnemy, the same adjacency check the
  // ResolveBattle case runs.
  const row = makeRow([
    makeHero("h0", 0, 3, 2, { stacks: [stack("swordsman", 5)] }),
    makeHero("h1", 1, 20, 20, { stacks: [] }),
  ]);
  const { deps } = makeDeps(row);
  const result = await handleCommand(submitCommand(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_adjacent");
});

test("survivor stacks naming a unit outside the server's catalog are rejected", async () => {
  const row = makeBattleRow();
  const { deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({ attackerStacks: [stack("dragon", 3)] }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_unit_type");
});

test("a wiped chartering defender gets their charters cleaned up, same as the auto-resolver", async () => {
  const row = makeBattleRow({}, { isChartering: true, charterId: "c-traveling" });
  const { gameRepo, deps } = makeDeps(row);
  // The defender was chartering: the granular path loads their outstanding
  // charter, and the wipe must remove it from the charters table exactly
  // like ResolveBattle's own cleanup does.
  const seeded = createMockCharterRepo({
    "test-game": [makeCharter({ id: "c-traveling", heroId: "h1", ownerId: 1 })],
  });
  deps.charterRepo = seeded;
  const result = await handleCommand(submitCommand(), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(seeded.rows["test-game"], [], "the wiped hero's outstanding charter is gone");
  assert.equal(gameRepo.rows["test-game"].heroes.h1, undefined, "the wiped chartering defender is removed outright");
});

test("heroRepo.upsertMany sweeps hero_platoons rows for heroes absent from the record (defeat cleanup)", async () => {
  // The mock heroRepo doubles don't model the platoon table, so this pins the
  // REAL repo's full-sync sweep against a recording fake Queryable: a hero
  // missing from the upsert record (a defeated hero) must lose its
  // hero_platoons rows via the same NOT-IN delete shape the heroes table
  // already uses -- the per-hero delete at the bottom of the loop only ever
  // covers heroes still present.
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.trim() === "SELECT id FROM games WHERE name = $1") {
        return { rows: [{ id: 7 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = createHeroRepo(db as unknown as Queryable);
  await repo.upsertMany("test-game", { h0: makeHero("h0", 0, 2, 2) });
  const sweep = queries.find((q) => q.sql.includes("DELETE FROM hero_platoons"));
  assert.ok(sweep, "a platoon delete is issued in the same upsert path");
  assert.match(sweep.sql, /NOT \(hero_id = ANY\(\$2::text\[\]\)\)/, "the sweep is the NOT-IN form that covers REMOVED heroes");
  assert.deepEqual(sweep.params, [7, ["h0"]]);
});
