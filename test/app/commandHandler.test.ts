import { test } from "node:test";
import assert from "node:assert/strict";
import type { HeroId, HeroState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import { handleCommand, type CommandHandlerDeps } from "../../server/app/commandHandler";
import type { GameRow } from "../../server/persistence/repositories/gameRepo";
import { makeMockEventRepo, makeMockGameRepo } from "../helpers/mockRepos";

function makeHero(id: HeroId, ownerId: number, q: number, r: number, overrides: Partial<HeroState> = {}): HeroState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    movementRemaining: MOVEMENT_PER_TURN,
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

function makePlayer(id: number): Player {
  return { id, faction: "player", name: `p${id}`, color: "#000000", heroIds: [], settlementIds: [] };
}

function makeRow(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 1,
    name: "g1",
    seed: 0,
    hero_q: 0,
    hero_r: 0,
    turn: 1,
    gold: 0,
    enemy_positions: [],
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [makePlayer(0), makePlayer(1)],
    heroes: {},
    settlements: {},
    map_size: "small",
    lobby: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeDeps(rows: GameRow[]): { deps: CommandHandlerDeps; events: ReturnType<typeof makeMockEventRepo> } {
  const events = makeMockEventRepo();
  return {
    deps: {
      gameRepo: makeMockGameRepo(rows),
      eventRepo: events,
      ctx: { rng: () => 0, catalog: {} },
    },
    events,
  };
}

test("MoveHero rejects a move onto an occupied tile", async () => {
  const row = makeRow({
    heroes: {
      h0: makeHero("h0", 0, 2, 2),
      h1: makeHero("h1", 0, 5, 5),
    },
  });
  const { deps } = makeDeps([row]);
  const result = await handleCommand(deps, "g1", {
    kind: "MoveHero",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 5, r: 5 },
    cost: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "occupied");
});

test("MoveHero rejects a move by a chartering hero", async () => {
  const row = makeRow({
    heroes: {
      h0: makeHero("h0", 0, 2, 2, { isChartering: true }),
    },
  });
  const { deps } = makeDeps([row]);
  const result = await handleCommand(deps, "g1", {
    kind: "MoveHero",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "is_chartering");
});

test("MoveHero succeeds and appends a move_completed event", async () => {
  const row = makeRow({
    heroes: {
      h0: makeHero("h0", 0, 2, 2),
    },
  });
  const { deps, events } = makeDeps([row]);
  const result = await handleCommand(deps, "g1", {
    kind: "MoveHero",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.hero?.q, 3);
    assert.equal(result.hero?.r, 2);
    assert.equal(result.hero?.movementRemaining, MOVEMENT_PER_TURN - 1);
  }
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].kind, "move_completed");
});

test("MoveHero rejects a stale fromTile", async () => {
  const row = makeRow({
    heroes: {
      h0: makeHero("h0", 0, 2, 2),
    },
  });
  const { deps } = makeDeps([row]);
  const result = await handleCommand(deps, "g1", {
    kind: "MoveHero",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 9, r: 9 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "hero_not_at_fromTile");
});

test("MoveHero rejects when actor isn't the active player", async () => {
  const row = makeRow({
    active_player_id: 0,
    heroes: { h0: makeHero("h0", 0, 2, 2) },
  });
  const { deps } = makeDeps([row]);
  const result = await handleCommand(deps, "g1", {
    kind: "MoveHero",
    actor: 1,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.equal(result.reason, "forbidden_not_your_turn");
  }
});

test("TransferGold deposits hero gold into a friendly settlement and appends an event", async () => {
  const row = makeRow({
    heroes: { h0: makeHero("h0", 0, 2, 2, { gold: 50 }) },
    settlements: { s0: makeSettlement("s0", 0, 2, 2, { gold: 10 }) },
  });
  const { deps, events } = makeDeps([row]);
  const result = await handleCommand(deps, "g1", {
    kind: "TransferGold",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.hero?.gold, 0);
    assert.equal(result.settlement?.gold, 60);
  }
  assert.equal(events.events.length, 1);
  assert.deepEqual(events.events[0].payload, {
    kind: "transfer_gold",
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
    amount: 50,
  });
});

test("TransferGold rejects when actor isn't the active player (no engine-level check exists for this)", async () => {
  const row = makeRow({
    active_player_id: 0,
    heroes: { h0: makeHero("h0", 1, 2, 2, { gold: 50 }) },
    settlements: { s0: makeSettlement("s0", 1, 2, 2) },
  });
  const { deps } = makeDeps([row]);
  const result = await handleCommand(deps, "g1", {
    kind: "TransferGold",
    actor: 1,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.equal(result.reason, "forbidden_not_your_turn");
  }
});

test("unknown game name returns a not_found result", async () => {
  const { deps } = makeDeps([]);
  const result = await handleCommand(deps, "missing", {
    kind: "MoveHero",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 0, r: 0 },
    toTile: { q: 1, r: 0 },
    cost: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
  }
});
