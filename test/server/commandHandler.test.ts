import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Command,
  HeroId,
  HeroState,
  Player,
  PlayerId,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import { createMockEventRepo, createMockGameRepo } from "../helpers/mockRepos";

function makeHero(id: HeroId, ownerId: PlayerId, q: number, r: number, overrides: Partial<HeroState> = {}): HeroState {
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
  ownerId: PlayerId | null,
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

function makeRow(
  heroes: HeroState[],
  settlements: SettlementState[],
  overrides: Partial<HydratableGameRow> = {},
): HydratableGameRow {
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    ...overrides,
  };
}

function makeDeps(row: HydratableGameRow) {
  const gameRepo = createMockGameRepo({ [row.name as string]: row });
  const eventRepo = createMockEventRepo();
  return {
    gameRepo,
    eventRepo,
    deps: { gameRepo, eventRepo, ctx: { rng: () => 0.5, catalog: { unitTypes: [] } } },
  };
}

test("MoveHero succeeds, persists the new position, and emits HeroMoved", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.q, 3);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.movementRemaining, 6);
  assert.equal(eventRepo.events.length, 1);
  assert.equal(eventRepo.events[0].kind, "HeroMoved");
});

test("MoveHero rejects a move onto a tile already occupied by another hero", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 3, 2)],
    [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "occupied");
  assert.equal(result.events.length, 0);
});

test("MoveHero rejects a move by a hero that is currently chartering", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" })], [makeSettlement("s0", 0, 2, 2)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "is_chartering");
  assert.equal(result.events.length, 0);
});

test("MoveHero rejects a stale fromTile that doesn't match the hero's server-side position", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 5, r: 5 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_at_fromTile");
  assert.equal(result.events.length, 0);
});

test("MoveHero rejects a command whose actor is not the active player", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)], { active_player_id: 1 });
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_turn");
  assert.equal(result.events.length, 0);
});

test("TransferGold deposit moves gold from hero to settlement and emits GoldTransferred", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2, { gold: 50 })], [makeSettlement("s0", 0, 2, 2, { gold: 10 })]);
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "TransferGold",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.gold, 0);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 60);
  assert.equal(eventRepo.events.length, 1);
  assert.equal(eventRepo.events[0].kind, "GoldTransferred");
});

test("TransferGold rejects when the hero is not at the settlement", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2, { gold: 50 })], [makeSettlement("s0", 0, 9, 9)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "TransferGold",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_at_settlement");
});

const SOLO_PLAYER: Player[] = [
  { id: 0, faction: "player", name: "Human", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
];

test("EndTurn advances to the next player without wrapping the round", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { movementRemaining: 2 })],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "EndTurn", gameName: "test-game", actor: 0 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.activePlayerId, 1);
  assert.equal(result.round, 1);
  // Movement reset only applies to the ending player's own heroes
  // (applyEndOfTurnDetailed's resetHeroMovement(state.heroes, playerId)) --
  // h0 belongs to player 0, who just ended their turn.
  assert.equal(gameRepo.rows["test-game"].heroes.h0.movementRemaining, 7);
  assert.equal(gameRepo.rows["test-game"].active_player_id, 1);
  // turn_ended always fires; ai_turn_started also fires here because
  // PLAYERS[1] (the next player) is faction "ai" -- matching the old
  // /end-turn route's same check.
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "turn_ended,ai_turn_started");
  assert.equal((eventRepo.events[0].payload as { playerId: number }).playerId, 0);
});

test("EndTurn wraps the round, advances settlement upgrades, and applies weekly upkeep on day%7 -- closing the gaps the old /end-turn route left client-trusted", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { gold: 0, troops: 3 })],
    [
      makeSettlement("s0", 0, 2, 2, {
        population: 100,
        level: 1,
        // Large buffer so applyEndOfTurnDetailed's consumption step can't
        // exhaust it before applyPopulationGrowth's food check runs --
        // this test only needs to prove growth fires, not predict the
        // exact post-consumption remainder.
        warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 10_000 },
        upgrade: { kind: "townHall", targetLevel: 2, daysRemaining: 1 },
      }),
    ],
    { players: SOLO_PLAYER, day: 6 },
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "EndTurn", gameName: "test-game", actor: 0, growthRate: 0.1 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.round, 2);
  assert.equal(result.day, 7);
  assert.equal(result.activePlayerId, 0);

  const s0 = gameRepo.rows["test-game"].settlements.s0;
  // advanceSettlementUpgrades: gap #1. Old route never called this --
  // upgrade.daysRemaining (1) hits 0 and clears.
  assert.equal(s0.upgrade, undefined);
  // applyPopulationGrowth: gap #2. Old route never called this at all.
  assert.ok(s0.population > 100, `expected population growth, got ${s0.population}`);

  // applyHeroUpkeep (part of the same weekly-upkeep gap): troops=3, cost=3,
  // hero had 0 gold, so the shortfall branch sets gold:0, troops:<old gold>.
  const h0 = gameRepo.rows["test-game"].heroes.h0;
  assert.equal(h0.gold, 0);
  assert.equal(h0.troops, 0);

  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "turn_ended,round_ended,round_started");
});
