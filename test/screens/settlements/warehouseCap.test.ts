import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, GameState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import { BASE_STORAGE, settlementResourceCap } from "@heroes/engine";
import {
  applyWarehouseCapSessionDedupe,
  cappedWarehouseResources,
  cappedWarehouseResourcesOf,
  capBuildingHint,
  newlyCappedWarehouseResources,
  resetWarehouseCapDedupe,
  warehouseCapMessage,
  warehouseCapSummaryToastMessage,
  warehouseCapToastMessage,
  warehouseResourceCapped,
  WAREHOUSE_CAP_AMBER,
  WAREHOUSE_CAP_SUMMARY_OFFENDER_LIMIT,
} from "../../../src/screens/settlements/warehouseCap";
import { TREASURY_CAP_AMBER } from "../../../src/screens/settlements/treasuryCap";

// E2 (playthrough round 2b): the warehouse cap discards production with no
// indicator, while the treasury's identical cap has an amber row, a tooltip
// sentence and a one-time toast. This module is the store half of that read
// side; the fixtures below are self-contained (the predicate only needs
// level/buildings/warehouse/ownerId), matching treasuryCap.test.ts.

beforeEach(() => {
  resetWarehouseCapDedupe();
});

function building(kind: BuildingDef["kind"], level = 1, gx = 0, gy = 0): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

function settlement(
  id: string,
  ownerId: number | null,
  overrides: Partial<SettlementState> = {},
): SettlementState {
  return {
    id,
    name: id === "s0" ? "Blackrock Hold" : id,
    ownerId,
    q: 3,
    r: 3,
    level: 1,
    population: 100,
    goldTax: 1,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: false,
    castleVariant: 0,
    buildings: [],
    ...overrides,
  };
}

function makePlayer(id: number): Player {
  return { id, faction: id === 0 ? "player" : "ai", name: `Player ${id + 1}`, color: "#000000", heroIds: [], settlementIds: [] };
}

function makeState(settlements: SettlementState[]): GameState {
  const byId: Record<SettlementId, SettlementState> = {};
  for (const s of settlements) byId[s.id] = s;
  return {
    round: 1,
    day: 1,
    activePlayerId: 0,
    players: [makePlayer(0), makePlayer(1)],
    heroes: {},
    settlements: byId,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: 0,
    tradeRoutes: [],
  } as unknown as GameState;
}

test("a store is capped at its cap and above it, never below", () => {
  assert.equal(BASE_STORAGE[1], 500, "fixture premise: a level-1 store cap is 500 per resource");
  const capped = settlement("s0", 0, { warehouse: { wood: 500, stone: 0, iron: 0, arcane: 0, food: 0 } });
  assert.equal(settlementResourceCap(capped).wood, 500);
  assert.equal(warehouseResourceCapped(capped, "wood"), true, "exactly on the cap already has zero headroom");
  assert.equal(warehouseResourceCapped(capped, "stone"), false);
  const over = settlement("s0", 0, { warehouse: { wood: 640, stone: 0, iron: 0, arcane: 0, food: 0 } });
  assert.equal(warehouseResourceCapped(over, "wood"), true, "stock above cap is a legacy shape and equally stuck");
});

test("the capped stores come back in the warehouse's own order", () => {
  const s = settlement("s0", 0, {
    warehouse: { wood: 0, stone: 500, iron: 0, arcane: 500, food: 501 },
  });
  assert.deepEqual(cappedWarehouseResources(s), ["stone", "arcane", "food"]);
});

test("a warehouse raises every store's cap and a granary raises food's -- read from the registry", () => {
  assert.match(capBuildingHint("wood"), /^a Warehouse \(\+600 per level, 500g each\)$/);
  assert.match(capBuildingHint("food"), /a Warehouse \(\+600 per level, 500g each\) or a Granary \(\+600 per level, 150g each\)/);
  // The hint is the registry's own numbers, so it cannot drift from the buildings.
  const s = settlement("s0", 0, { buildings: [building("warehouse"), building("granary")] });
  assert.equal(settlementResourceCap(s).wood, 500 + 600);
  assert.equal(settlementResourceCap(s).food, 500 + 1200);
});

test("the sentence names what is held, what is being discarded, and the way out", () => {
  const s = settlement("s0", 0, { warehouse: { wood: 500, stone: 0, iron: 0, arcane: 0, food: 0 } });
  const withRate = warehouseCapMessage(s, "wood", 12);
  assert.match(withRate, /^Wood is at its 500 store cap \(500 held\)/);
  assert.match(withRate, /the 12\/day it receives is being discarded/);
  assert.match(withRate, /until you spend some or raise the cap by building a Warehouse/);
  const withoutRate = warehouseCapMessage(s, "wood");
  assert.match(withoutRate, /anything more it receives is discarded/);
  assert.doesNotMatch(withoutRate, /day it receives/);
  assert.equal(warehouseCapToastMessage({ settlement: s, resource: "wood" }, 12).startsWith("Blackrock Hold: Wood is at its"), true);
});

test("only this player's own settlements' stores are reported", () => {
  const state = makeState([
    settlement("s0", 0, { warehouse: { wood: 500, stone: 0, iron: 0, arcane: 0, food: 500 } }),
    settlement("s1", 1, { warehouse: { wood: 500, stone: 0, iron: 0, arcane: 0, food: 0 } }),
    settlement("s2", null, { warehouse: { wood: 500, stone: 0, iron: 0, arcane: 0, food: 0 } }),
  ]);
  assert.deepEqual(
    cappedWarehouseResourcesOf(state, 0).map((row) => `${row.settlement.id}:${row.resource}`),
    ["s0:wood", "s0:food"],
    "own settlement only, warehouse order inside it",
  );
  assert.deepEqual(cappedWarehouseResourcesOf(state, null), [], "an unknown seat guesses nothing");
});

test("the transition is what toasts: staying pinned is silent, leaving and returning is not", () => {
  const pinned = settlement("s0", 0, { warehouse: { wood: 500, stone: 0, iron: 0, arcane: 0, food: 0 } });
  const below = settlement("s0", 0, { warehouse: { wood: 480, stone: 0, iron: 0, arcane: 0, food: 0 } });

  assert.deepEqual(
    newlyCappedWarehouseResources(makeState([below]), makeState([pinned]), 0).map((r) => r.resource),
    ["wood"],
    "the turn it arrived",
  );
  assert.deepEqual(newlyCappedWarehouseResources(makeState([pinned]), makeState([pinned]), 0), [], "still pinned, still silent");
  assert.deepEqual(
    newlyCappedWarehouseResources(makeState([pinned]), makeState([below]), 0),
    [],
    "the turn it drained",
  );
  assert.deepEqual(
    newlyCappedWarehouseResources(makeState([below]), makeState([pinned]), 0).map((r) => r.resource),
    ["wood"],
    "and again the next time it fills",
  );
});

test("the session dedupe toasts each store once while it stays capped, and re-arms below cap", () => {
  const empty = settlement("s0", 0, { warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } });
  const both = settlement("s0", 0, { warehouse: { wood: 500, stone: 500, iron: 0, arcane: 0, food: 0 } });
  const crossing = newlyCappedWarehouseResources(makeState([empty]), makeState([both]), 0);

  const first = applyWarehouseCapSessionDedupe("game-a", makeState([both]), 0, crossing);
  assert.deepEqual(first.map((r) => r.resource), ["wood", "stone"], "the crossing turn toasts both stores");
  assert.deepEqual(
    applyWarehouseCapSessionDedupe("game-a", makeState([both]), 0, crossing),
    [],
    "the same crossing does not toast twice in one session",
  );
  // A store observed BELOW its cap re-arms; one that never left its cap stays
  // suppressed.
  const stoneOnly = settlement("s0", 0, { warehouse: { wood: 0, stone: 500, iron: 0, arcane: 0, food: 0 } });
  applyWarehouseCapSessionDedupe("game-a", makeState([stoneOnly]), 0, []);
  const recross = newlyCappedWarehouseResources(makeState([stoneOnly]), makeState([both]), 0);
  assert.deepEqual(
    applyWarehouseCapSessionDedupe("game-a", makeState([both]), 0, recross).map((r) => r.resource),
    ["wood"],
    "stone never left its cap, so only wood re-arms",
  );
  // Another game in the same browser session does not suppress this one's first toast.
  assert.deepEqual(
    applyWarehouseCapSessionDedupe("game-b", makeState([both]), 0, crossing).map((r) => r.resource),
    ["wood", "stone"],
  );
});

test("the summary toast names up to three stores and then just counts", () => {
  assert.equal(WAREHOUSE_CAP_SUMMARY_OFFENDER_LIMIT, 3);
  const s = settlement("s0", 0, { warehouse: { wood: 500, stone: 500, iron: 500, arcane: 500, food: 500 } });
  const rows = cappedWarehouseResources(s).map((resource) => ({ settlement: s, resource }));
  const message = warehouseCapSummaryToastMessage(rows);
  assert.match(message, /^Store full at 5 of your stockpiles — Blackrock Hold wood, Blackrock Hold stone, Blackrock Hold iron\./);
  assert.match(message, /Production is being discarded; a Warehouse or Granary raises the cap\./);
});

test("the cap warning reuses the treasury's amber: one hue for a degraded readout", () => {
  assert.equal(WAREHOUSE_CAP_AMBER, TREASURY_CAP_AMBER);
});
