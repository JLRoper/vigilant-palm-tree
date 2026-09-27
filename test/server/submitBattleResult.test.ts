import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, HeroId, HeroState, Player, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { normalizePlatoons } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
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
// BattleResolved event derived from the submitted outcome. handleCommand is
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
  { id: 0, faction: "player", name: "Human", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
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

test("attackerWon loots the wiped defender's purse and applies survivor stacks, exactly like the auto-resolver's win path", async () => {
  const row = makeBattleRow();
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const result = await handleCommand(submitCommand(), deps);
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"].heroes;
  // Attacker: submitted survivors + the defender's looted gold.
  assert.equal(saved.h0.gold, 100 + 250);
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([stack("swordsman", 3)]));
  // Defender: wiped to no troops and no gold (loot zeroes the purse).
  assert.equal(saved.h1.gold, 0);
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([]));

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
    rewardGold: 250,
    rounds: 7,
    obstacleSeed: 42,
  });
  // The command's rounds/obstacleSeed ride the event verbatim -- the seed
  // must be the arena's real one for the future re-simulation consumer.
  assert.deepEqual(result.attackerHero, saved.h0);
  assert.deepEqual(result.defenderHero, saved.h1);
});

test("retreat restores submitted stacks to BOTH sides and cancels the attacker's move", async () => {
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
  // Attacker walked back to (2,2) with pre-move movement restored, keeping
  // the submitted (post-15%-loss) survivors.
  assert.equal(saved.h0.q, 2);
  assert.equal(saved.h0.r, 2);
  assert.equal(saved.h0.movementRemaining, 7);
  assert.equal(saved.h0.previousQ, null);
  assert.equal(saved.h0.gold, 100, "no loot on a retreat");
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([stack("swordsman", 3)]));
  // Defender keeps their survivors and purse untouched.
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([stack("swordsman", 2)]));
  assert.equal(saved.h1.gold, 250);

  const event = eventRepo.events[0];
  assert.equal(event.payload.winner, "defender");
  assert.equal(event.payload.attackerOutcome, "retreated_hero");
  assert.equal(event.payload.defenderOutcome, "won");
  assert.equal(event.payload.rewardGold, 0);
});

test("surrender deducts the paid gold from the CONCEDING hero and keeps both armies", async () => {
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
  // move cancelled, army kept whole (surrender skips the retreat loss).
  assert.equal(saved.h0.gold, 100 - 40);
  assert.equal(saved.h0.q, 2, "surrender cancels the attacker's move like a retreat");
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([stack("swordsman", 5)]));
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([stack("swordsman", 6)]));
  assert.equal(saved.h1.gold, 250);

  const event = eventRepo.events[0];
  assert.equal(event.payload.winner, "defender");
  assert.equal(event.payload.attackerOutcome, "retreated_hero");
  assert.equal(event.payload.rewardGold, 0);
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

test("surrender by a DEFENDER-side human debits the defender (conceding hero is derived from actor ownership)", async () => {
  // The "enemy moved onto me" case: seat 0's hero is the defender. The
  // arena's surrender is the human's action, so the deduction must land on
  // h0 (owned by the actor), not on the attacker role.
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
  assert.equal(saved.h0.gold, 300, "attacker keeps their purse");
  // The ATTACKER's move is the one cancelled (decision 3 applies to the
  // mover regardless of who conceded) -- h0 is the attacker role here even
  // though seat 1 owns it.
  assert.equal(saved.h0.q, 2, "attacker's move cancelled server-side");
  assert.equal(saved.h1.q, 3, "defender never moved -- position unchanged");
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
});

test("defenderWon empties the attacker and leaves the defender's purse alone (no reverse loot)", async () => {
  const row = makeBattleRow({ stacks: [stack("swordsman", 5)] }, { stacks: [stack("swordsman", 8)] });
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    submitCommand({ outcome: "defenderWon", attackerStacks: [], defenderStacks: [stack("swordsman", 8)] }),
    deps,
  );
  assert.equal(result.ok, true);
  const saved = gameRepo.rows["test-game"].heroes;
  assert.deepEqual(saved.h0.stacks, normalizePlatoons([]));
  assert.equal(saved.h0.gold, 100, "attacker keeps their purse -- loot only ever flows defender→attacker");
  assert.equal(saved.h1.gold, 250);
  assert.deepEqual(saved.h1.stacks, normalizePlatoons([stack("swordsman", 8)]));

  const event = eventRepo.events[0];
  assert.equal(event.payload.winner, "defender");
  assert.equal(event.payload.attackerOutcome, "lost_all_troops");
  assert.equal(event.payload.defenderOutcome, "won");
  assert.equal(event.payload.rewardGold, 0);
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
  assert.equal(gameRepo.rows["test-game"].heroes.h1.gold, 0);
});
