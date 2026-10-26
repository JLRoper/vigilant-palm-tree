import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, SettlementState } from "../../../src/state/gameState";
import { Hero } from "../../../src/entities/hero";
import { Castle } from "../../../src/entities/settlement";
import { GameMap, type TileRow } from "../../../src/map/gameMap";
import { pickupResource, WAGON_RESOURCE_CAPACITY } from "@heroes/engine";
import { describeTile } from "../../../src/screens/adventure/tileInfo";
import { tilePanelAction, tilePanelLines } from "../../../src/screens/adventure/tileInfoPanel";
import { makeHero } from "../../charter/_helpers";

// The tile panel's half of the pickup verb: the deposit line grows the
// remaining amount, the panel offers the action, a full hold gets a named
// refusal instead of a dead button -- and, the requirement that is PROVEN here
// rather than asserted, a pickup leaves the deposit's city-view contribution
// (resource type, workedBy, yield) reading exactly as it did before.

function mapWith(resource: string, q: number, r: number, width = 6, seed = 11): GameMap {
  const at = new Map([[`${q},${r}`, resource]]);
  const rows: TileRow[] = [];
  for (let i = 0; i < width; i++) {
    rows.push({ q: i, r: 0, terrain: "grass", resource: at.get(`${i},0`) ?? null });
  }
  return GameMap.fromTiles(rows, seed);
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    round: 1,
    day: 1,
    activePlayerId: 0,
    players: [
      { id: 0, faction: "player", name: "Player 1", color: "#d62828", heroIds: [], settlementIds: [] },
      { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: [], settlementIds: [] },
    ],
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: 0,
    castleCount: 0,
    activeCharters: [],
    nextCharterId: 0,
    nextSettlementId: 0,
    heroes: {},
    settlements: {},
    ...overrides,
  } as GameState;
}

function castleAt(id: string, q: number, r: number, level: 1 | 2 | 3, ownerId: number | null, name: string) {
  const settlement: SettlementState = {
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
  return { settlement, castle: Castle.fromGameState(settlement) };
}

test("deposit line grows the remaining amount and the panel offers the pickup", () => {
  const map = mapWith("iron", 3, 0);
  const { settlement, castle } = castleAt("s0", 2, 0, 2, 0, "Ironhold");
  const hero = makeHero("h0", 0, 3, 0, { wagons: 2 });
  let state = makeState({ heroes: { h0: hero }, settlements: { s0: settlement } });
  const clientHero = new Hero("h0", "Commander", 3, 0, "player", 0);

  const before = describeTile({ map, state, heroes: [clientHero], castles: [castle], viewPlayerId: 0, tile: { q: 3, r: 0 } })!;
  const pristine = map.resourceTileAt(3, 0)!.amount;
  assert.equal(before.deposit!.remaining, pristine);
  assert.equal(before.deposit!.pristine, pristine);
  // The city-view half the reader wants preserved.
  assert.equal(before.deposit!.resource, "iron");
  assert.equal(before.deposit!.yield, 8);
  assert.deepEqual(before.deposit!.workedBy, { name: "Ironhold", ownerId: 0 });
  const lineBefore = tilePanelLines(before).find((l) => l.text.includes("deposit"))!.text;
  assert.equal(lineBefore, `Iron deposit — worked by Ironhold (+8 iron/turn) · ${pristine} left`);

  // The action the panel offers: what would move, and what would stay.
  const action = tilePanelAction(before);
  assert.ok(action, "a viewer hero on a live deposit is offered the pickup");
  assert.equal(action!.disabled, false);
  assert.equal(action!.heroId, "h0");
  assert.equal(action!.label, `Pick up ${2 * WAGON_RESOURCE_CAPACITY} iron (${pristine} left)`);
  const actionTaken = 2 * WAGON_RESOURCE_CAPACITY;
  console.log(`[panel] before: "${lineBefore}" | button "${action!.label}" title "${action!.title}"`);
  console.log(`[panel] action("${lineBefore}") taken=${actionTaken} left=${pristine - actionTaken}`);

  // The pickup itself, through the engine -- the same reducer the button ends up
  // calling (GameActions.pickupResource -> TurnController.pickupResource).
  const result = pickupResource(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(result.ok, true);
  state = result.state;

  const after = describeTile({ map, state, heroes: [clientHero], castles: [castle], viewPlayerId: 0, tile: { q: 3, r: 0 } })!;
  // (c) PROVEN, not asserted: the deposit's type, workedBy and yield read the
  // same before and after. Only the quantity moved.
  assert.equal(after.deposit!.resource, before.deposit!.resource, "the resource type is unchanged by a pickup");
  assert.equal(after.deposit!.yield, before.deposit!.yield, "the city-view yield is unchanged by a pickup");
  assert.deepEqual(after.deposit!.workedBy, before.deposit!.workedBy, "the deposit is still worked by the same castle");
  assert.deepEqual(after.settlement, before.settlement, "the settlement's own reading is unaffected");
  assert.deepEqual(after.territory, before.territory, "the territory read is unaffected");
  // Only the amount moved.
  assert.equal(after.deposit!.remaining, pristine - actionTaken);
  assert.equal(after.deposit!.pristine, pristine, "the pristine amount is stable");
  const lineAfter = tilePanelLines(after).find((l) => l.text.includes("deposit"))!.text;
  console.log(`[panel] after:  "${lineAfter}"`);
  assert.equal(
    lineAfter,
    `Iron deposit — worked by Ironhold (+8 iron/turn) · ${pristine - actionTaken} left`,
    "the deposit line changed only in its trailing quantity",
  );
  // ...and the hero's cargo readout (heroInfoMenu's per-resource cells read
  // exactly this HeroState field) rose by the take.
  assert.equal(state.heroes.h0.resources!.iron, actionTaken, "the cargo readout has the gain");
});

test("a hero with no room gets a disabled button naming the refusal, not a silent no-op", () => {
  const map = mapWith("stone", 3, 0);
  const hero = makeHero("h0", 0, 3, 0, {
    wagons: 0,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: { h0: hero } });
  const clientHero = new Hero("h0", "Commander", 3, 0, "player", 0);
  const info = describeTile({ map, state, heroes: [clientHero], castles: [], viewPlayerId: 0, tile: { q: 3, r: 0 } })!;

  assert.equal(info.pickup!.ok, false);
  assert.equal(info.pickup!.reason, "not_enough_cargo_space");
  assert.equal(info.pickup!.room, 0);
  const action = tilePanelAction(info);
  assert.ok(action, "the offer is still shown -- it says why it cannot happen");
  assert.equal(action!.disabled, true);
  assert.equal(action!.title, "The hero's wagons are full — nothing fits on this trip");
  assert.equal(action!.label, `Stone pickup — ${map.resourceTileAt(3, 0)!.amount} left`);
  // The engine agrees with the panel: clicking would be refused with the same code.
  assert.equal(pickupResource(state, map, { heroId: "h0", q: 3, r: 0 }).reason, "not_enough_cargo_space");
});

test("a worked-out tile offers no pickup at all, and an unwatched tile offers none to a stranger", () => {
  const map = mapWith("wood", 3, 0);
  const hero = makeHero("h0", 0, 3, 0, { wagons: 5 });
  const clientHero = new Hero("h0", "Commander", 3, 0, "player", 0);

  // Drain the tile: the hero's five wagons (250) cannot hold everything at
  // once, so the fixture picks it out with a temporary oversized hold.
  const big = makeHero("h0", 0, 3, 0, { wagons: 20 });
  let state = makeState({ heroes: { h0: big } });
  const drained = pickupResource(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(drained.ok, true);
  assert.equal(drained.remaining, 0);
  const emptyInfo = describeTile({ map, state: drained.state, heroes: [clientHero], castles: [], viewPlayerId: 0, tile: { q: 3, r: 0 } })!;
  assert.equal(emptyInfo.deposit!.remaining, 0);
  assert.equal(
    tilePanelLines(emptyInfo).find((l) => l.text.includes("deposit"))!.text,
    "Wood deposit — unclaimed · worked out",
    "an emptied deposit still describes itself; it just offers nothing",
  );
  assert.equal(emptyInfo.pickup, null, "nothing left means no pickup offered");
  assert.equal(tilePanelAction(emptyInfo), null);

  // The viewer's OWN hero must be the one standing there.
  state = makeState({ heroes: { h0: hero } });
  const enemyTiled = describeTile({ map, state, heroes: [clientHero], castles: [], viewPlayerId: 1, tile: { q: 3, r: 0 } })!;
  assert.equal(enemyTiled.pickup, null, "another seat's hero is not the viewer's to pick with");
  // ...and a hero one hex away is not "on" the tile.
  const neighbour = describeTile({
    map,
    state: makeState({ heroes: { h0: { ...hero, q: 2 } } }),
    heroes: [clientHero],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 3, r: 0 },
  })!;
  assert.equal(neighbour.pickup, null, "a pickup needs the hero standing on the hex");
});
