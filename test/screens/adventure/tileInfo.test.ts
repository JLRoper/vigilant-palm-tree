import { test } from "node:test";
import assert from "node:assert/strict";
import type { CharterState, GameState, SettlementState } from "../../../src/state/gameState";
import { Hero } from "../../../src/entities/hero";
import { Castle } from "../../../src/entities/settlement";
import { GameMap, type TileRow } from "../../../src/map/gameMap";
import { RESOURCE_YIELD } from "../../../src/map/resourceTiles";
import { describeTile } from "../../../src/screens/adventure/tileInfo";
import { computeVision, isTileVisibleTo, isVisible } from "../../../src/render/fog";

function makeGrassMap(width: number, height: number, resources: Array<{ q: number; r: number; resource: string }> = []): GameMap {
  const resourceAt = new Map(resources.map((r) => [`${r.q},${r.r}`, r.resource]));
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({ q, r, terrain: "grass", resource: resourceAt.get(`${q},${r}`) ?? null });
    }
  }
  return GameMap.fromTiles(rows);
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    round: 1,
    day: 1,
    activePlayerId: 0,
    players: [
      { id: 0, faction: "player", name: "Human", color: "#d62828", heroIds: [], settlementIds: [] },
      { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: [], settlementIds: [] },
    ],
    heroes: {},
    settlements: {},
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: 0,
    castleCount: 0,
    activeCharters: [],
    nextCharterId: 0,
    nextSettlementId: 0,
    ...overrides,
  };
}

function makeSettlement(
  id: string,
  q: number,
  r: number,
  level: 1 | 2 | 3,
  ownerId: number | null,
  name: string,
): { state: SettlementState; castle: Castle } {
  const state: SettlementState = {
    id,
    name,
    ownerId,
    q,
    r,
    level,
    population: 100,
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
  };
  return { state, castle: Castle.fromGameState(state) };
}

test("empty grass tile: terrain only, passable, cost 1", () => {
  const map = makeGrassMap(3, 3);
  // Hero stands elsewhere so the inspected tile itself is empty; VISION_RANGE=4 easily reaches it on this 3x3 map.
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const info = describeTile({ map, state: makeState(), heroes: [hero], castles: [], viewPlayerId: 0, tile: { q: 1, r: 1 } });

  assert.ok(info);
  assert.equal(info!.fogged, false);
  assert.deepEqual(info!.terrain, { kind: "grass", label: "Grass", cost: 1, passable: true });
  assert.equal(info!.deposit, null);
  assert.equal(info!.settlement, null);
  assert.deepEqual(info!.heroes, []);
  assert.equal(info!.charter, null);
  assert.equal(info!.territory, null);
});

test("water and mountain terrain report passable: false", () => {
  const rows: TileRow[] = [
    { q: 0, r: 0, terrain: "water", resource: null },
    { q: 1, r: 0, terrain: "mountain", resource: null },
    { q: 2, r: 0, terrain: "grass", resource: null },
  ];
  const map = GameMap.fromTiles(rows);
  const hero = new Hero("h0", "Hero", 2, 0, "player", 0);

  const water = describeTile({ map, state: makeState(), heroes: [hero], castles: [], viewPlayerId: 0, tile: { q: 0, r: 0 } });
  assert.equal(water!.terrain.kind, "water");
  assert.equal(water!.terrain.passable, false);

  const mountain = describeTile({ map, state: makeState(), heroes: [hero], castles: [], viewPlayerId: 0, tile: { q: 1, r: 0 } });
  assert.equal(mountain!.terrain.kind, "mountain");
  assert.equal(mountain!.terrain.passable, false);
});

test("resource deposit reports workedBy only within the settlement's rate radius", () => {
  // Level-2 settlement -> settlementRateRadius(2) = 1.
  const map = makeGrassMap(6, 1, [
    { q: 3, r: 0, resource: "iron" }, // hex-distance 1 from the settlement -> worked
    { q: 4, r: 0, resource: "iron" }, // hex-distance 2 -> one hex outside the radius, unclaimed
  ]);
  const { state: settlementState, castle } = makeSettlement("s0", 2, 0, 2, 0, "Ironhold");
  const hero = new Hero("h0", "Hero", 2, 0, "player", 0);
  const state = makeState({ settlements: { s0: settlementState } });

  const worked = describeTile({ map, state, heroes: [hero], castles: [castle], viewPlayerId: 0, tile: { q: 3, r: 0 } });
  assert.ok(worked!.deposit);
  assert.equal(worked!.deposit!.yield, RESOURCE_YIELD.iron);
  assert.deepEqual(worked!.deposit!.workedBy, { name: "Ironhold", ownerId: 0 });

  const unclaimed = describeTile({ map, state, heroes: [hero], castles: [castle], viewPlayerId: 0, tile: { q: 4, r: 0 } });
  assert.ok(unclaimed!.deposit);
  assert.equal(unclaimed!.deposit!.workedBy, null);
});

test("fogged tile: terrain still reported; deposit/charter suppressed; enemy hero and settlement hidden", () => {
  const map = makeGrassMap(10, 1, [{ q: 9, r: 0, resource: "gold" }]);
  // Owned hero far from (9,0) -- hex-distance 9, well outside VISION_RANGE=4 -- so (9,0) is fogged for player 0.
  const ownHero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const enemyHero = new Hero("h-enemy", "Enemy", 9, 0, "enemy", 1);
  const { state: enemySettlementState, castle: enemyCastle } = makeSettlement("s-enemy", 9, 0, 1, 1, "Ravenhold");
  const charter: CharterState = {
    id: "c0", heroId: "h-enemy", ownerId: 1, targetQ: 9, targetR: 0,
    settlementName: "New Town", phase: "traveling", daysRemaining: 3,
    settlementId: "s-new", resourceRates: {}, foundedOnResource: null, citySpots: [],
  };
  const state = makeState({ settlements: { "s-enemy": enemySettlementState }, activeCharters: [charter] });

  const info = describeTile({
    map, state, heroes: [ownHero, enemyHero], castles: [enemyCastle], viewPlayerId: 0, tile: { q: 9, r: 0 },
  });

  assert.ok(info);
  assert.equal(info!.fogged, true);
  assert.equal(info!.terrain.kind, "grass", "terrain is drawn even under fog, so it's still reported");
  assert.equal(info!.deposit, null);
  assert.equal(info!.charter, null);
  assert.equal(info!.settlement, null, "enemy settlement is suppressed under fog");
  assert.deepEqual(info!.heroes, [], "enemy hero is suppressed under fog");
});

test("out-of-bounds tile returns null", () => {
  const map = makeGrassMap(3, 3);
  const hero = new Hero("h0", "Hero", 1, 1, "player", 0);
  assert.equal(describeTile({ map, state: makeState(), heroes: [hero], castles: [], viewPlayerId: 0, tile: { q: 5, r: 5 } }), null);
  assert.equal(describeTile({ map, state: makeState(), heroes: [hero], castles: [], viewPlayerId: 0, tile: { q: -1, r: 0 } }), null);
});

test("isTileVisibleTo agrees with computeVision(...).has(...) across a small map", () => {
  const map = makeGrassMap(9, 9);
  const heroes = [
    new Hero("h0", "Hero", 4, 4, "player", 0),
    new Hero("h1", "Enemy", 7, 7, "enemy", 1),
  ];
  const { castle } = makeSettlement("s0", 1, 1, 2, 0, "Ironhold");
  const castles = [castle];

  const visible = computeVision(heroes, castles, 0);
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      assert.equal(
        isTileVisibleTo(heroes, castles, 0, q, r),
        isVisible(visible, q, r),
        `mismatch at (${q},${r})`,
      );
    }
  }
});
