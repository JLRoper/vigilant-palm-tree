import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEndOfTurn,
  buildingSettlementEffects,
  buildingUpkeep,
  CELL_MULTIPLIER_PEAK,
  cellMultiplier,
  isProducerKind,
  produceSettlementResources,
  producerBasePerTurn,
  producerResource,
  producerTurnOutput,
  SPOT_MULTIPLIER_PEAK,
} from "@heroes/engine";
import { emptyWarehouse, makeSettlement, makeState } from "../charter/_helpers";

const GOLD_SPOT = { cell: { x: 2, y: 2 }, resource: "gold" as const };
const IRON_SPOT = { cell: { x: 3, y: 3 }, resource: "iron" as const };

test("isProducerKind recognizes the producer buildings", () => {
  assert.equal(isProducerKind("goldMine"), true);
  assert.equal(isProducerKind("woodcutterHut"), true);
  assert.equal(isProducerKind("stoneMine"), true);
  assert.equal(isProducerKind("ironMine"), true);
  assert.equal(isProducerKind("mine"), true);
  assert.equal(isProducerKind("arcaneFont"), true);
  assert.equal(isProducerKind("house"), false);
  assert.equal(isProducerKind("townHall"), false);
});

test("producerResource: dedicated mines are fixed; legacy mine follows the spot under it", () => {
  const spots = [GOLD_SPOT, IRON_SPOT];
  assert.equal(producerResource("stoneMine", spots, 3, 3), "stone");
  assert.equal(producerResource("stoneMine", spots, 2, 2), "stone", "a gold spot does not change a stone mine");
  assert.equal(producerResource("ironMine", spots, 2, 2), "iron");
  assert.equal(producerResource("ironMine", spots, 9, 9), "iron", "an iron mine produces iron off-spot too");
  assert.equal(producerResource("mine", spots, 3, 3), "iron", "legacy mine on an iron spot produces iron");
  assert.equal(producerResource("mine", spots, 2, 2), "stone", "a gold spot does not make a legacy mine produce gold");
  assert.equal(producerResource("mine", spots, 9, 9), "stone", "off-spot legacy mines default to stone");
  assert.equal(producerResource("goldMine", spots, 3, 3), "gold");
  assert.equal(producerResource("woodcutterHut", [], 0, 0), "wood");
  assert.equal(producerResource("arcaneFont", [], 0, 0), "arcane");
});

test("producerBasePerTurn reads the registry: goldMine 40 gold, +3 magnitudes elsewhere", () => {
  assert.equal(producerBasePerTurn("goldMine", 1, "gold"), 40);
  assert.equal(producerBasePerTurn("goldMine", 2, "gold"), 80);
  assert.equal(producerBasePerTurn("woodcutterHut", 1, "wood"), 3);
  assert.equal(producerBasePerTurn("stoneMine", 1, "stone"), 3);
  assert.equal(producerBasePerTurn("ironMine", 1, "iron"), 3);
  assert.equal(producerBasePerTurn("mine", 1, "stone"), 3);
  assert.equal(producerBasePerTurn("mine", 1, "iron"), 3);
  assert.equal(producerBasePerTurn("arcaneFont", 1, "arcane"), 3);
});

// resourceYieldBonus used to be copied out of the registry unscaled, so a
// woodcutter hut made the SAME 3 wood at L3 as at L1 while upkeepPerLevel
// charged 3x the wood -- every upgrade was strictly negative ROI. It now
// scales xlevel, like goldPerTurn/foodPerTurn.
const LEVEL_SCALED_PRODUCERS: { kind: Parameters<typeof producerBasePerTurn>[0]; resource: Parameters<typeof producerBasePerTurn>[2] }[] = [
  { kind: "woodcutterHut", resource: "wood" },
  { kind: "stoneMine", resource: "stone" },
  { kind: "ironMine", resource: "iron" },
  { kind: "mine", resource: "stone" },
  { kind: "mine", resource: "iron" },
  { kind: "arcaneFont", resource: "arcane" },
];

test("resourceYieldBonus scales xlevel, so L2 > L1 and L3 > L2 output", () => {
  for (const { kind, resource } of LEVEL_SCALED_PRODUCERS) {
    const l1 = producerBasePerTurn(kind, 1, resource);
    const l2 = producerBasePerTurn(kind, 2, resource);
    const l3 = producerBasePerTurn(kind, 3, resource);
    assert.ok(l2 > l1, `${kind}/${resource}: L2 (${l2}) must beat L1 (${l1})`);
    assert.ok(l3 > l2, `${kind}/${resource}: L3 (${l3}) must beat L2 (${l2})`);
    assert.equal(l2, l1 * 2, `${kind}/${resource}: L2 is exactly x2`);
    assert.equal(l3, l1 * 3, `${kind}/${resource}: L3 is exactly x3`);
  }
});

test("resourceYieldBonus scaling matches goldPerTurn/foodPerTurn (one rule, not two)", () => {
  // goldMine's goldPerTurn already scaled (40/80/120) and the farm kinds'
  // foodPerTurn already scaled (5/10/15). All five effect families must now
  // share the L1 -> L2 -> L3 ratios, or the registry grows a second convention.
  const ratios = (l1: number, l2: number, l3: number): string => `${l2 / l1}:${l3 / l1}`;
  assert.equal(ratios(40, producerBasePerTurn("goldMine", 2, "gold"), producerBasePerTurn("goldMine", 3, "gold")), "2:3");
  assert.equal(ratios(5, producerBasePerTurn("farmField", 2, "food"), producerBasePerTurn("farmField", 3, "food")), "2:3");
  assert.equal(
    ratios(3, producerBasePerTurn("woodcutterHut", 2, "wood"), producerBasePerTurn("woodcutterHut", 3, "wood")),
    "2:3",
  );
  assert.equal(
    buildingSettlementEffects("woodcutterHut", 3).resourceYieldBonus?.wood,
    producerBasePerTurn("woodcutterHut", 3, "wood"),
    "the registry effect and the producer read agree at every level",
  );
});

test("upkeep still scales xlevel, unchanged by the yield fix", () => {
  for (const { kind, resource } of LEVEL_SCALED_PRODUCERS) {
    void resource;
    const u1 = buildingUpkeep(kind, 1);
    const u2 = buildingUpkeep(kind, 2);
    const u3 = buildingUpkeep(kind, 3);
    assert.equal(u2.wood, u1.wood * 2, `${kind}: wood upkeep x2`);
    assert.equal(u3.wood, u1.wood * 3, `${kind}: wood upkeep x3`);
    assert.equal(u2.stone, u1.stone * 2, `${kind}: stone upkeep x2`);
    assert.equal(u3.stone, u1.stone * 3, `${kind}: stone upkeep x3`);
  }
});

test("net-of-upkeep output still rises with level: the L3 upgrade pays for itself", () => {
  // The defect was a strictly negative ROI: output flat, upkeep rising. Net
  // output (yield minus upkeep, the resources actually banked) must rise.
  for (const { kind, resource } of LEVEL_SCALED_PRODUCERS) {
    const net = [1, 2, 3].map((level) => {
      const u = buildingUpkeep(kind, level);
      return producerBasePerTurn(kind, level, resource) - u.wood - u.stone;
    });
    assert.ok(net[1] > net[0], `${kind}: net L2 (${net[1]}) > net L1 (${net[0]})`);
    assert.ok(net[2] > net[1], `${kind}: net L3 (${net[2]}) > net L2 (${net[1]})`);
  }
});

test("a 3x spot at L1 exactly matches the same building at L3 on a plain cell", () => {
  // Worth stating as a designed consequence rather than a coincidence: the
  // level curve (x3) and the spot peak (SPOT_MULTIPLIER_PEAK = 3.0) are the
  // same number, so a lucky L1 placement equals a fully-upgraded L3. That is
  // NOT new imbalance -- goldMine's xlevel goldPerTurn (40/80/120) has the
  // same tie today (120 vs 120), and the shipped farmField food path does too
  // (5x3 = 15 vs 15). The spot stays a permanent x3, so an L3 spot producer
  // (27) still dominates either alternative -- the placement decision, not the
  // level grind, is what spots are for.
  for (const { kind, resource } of LEVEL_SCALED_PRODUCERS) {
    const l1OnSpot = producerBasePerTurn(kind, 1, resource) * SPOT_MULTIPLIER_PEAK;
    const l3Plain = producerBasePerTurn(kind, 3, resource) * CELL_MULTIPLIER_PEAK;
    assert.equal(l1OnSpot, l3Plain, `${kind}/${resource}: L1 on a 3.0x spot equals L3 plain`);
    const l3OnSpot = producerBasePerTurn(kind, 3, resource) * SPOT_MULTIPLIER_PEAK;
    assert.ok(
      l3OnSpot > l1OnSpot && l3OnSpot > l3Plain,
      `${kind}/${resource}: an L3 spot producer (${l3OnSpot}) must beat both the L1 spot (${l1OnSpot}) and the L3 plain (${l3Plain})`,
    );
  }
});

test("producerTurnOutput scales the base by the cell multiplier", () => {
  const settlement = { q: 5, r: 5, citySpots: [GOLD_SPOT] };
  const building = { gx: 2, gy: 2, kind: "goldMine" as const, level: 1 };
  const out = producerTurnOutput(building, settlement, 42);
  assert.ok(out);
  const m = cellMultiplier({
    seed: 42,
    q: 5,
    r: 5,
    gx: 2,
    gy: 2,
    resource: "gold",
    spots: [GOLD_SPOT],
  });
  assert.equal(out.multiplier, m);
  assert.equal(out.basePerTurn, 40);
  assert.equal(out.amount, Math.round(40 * m * 100) / 100);
});

test("producerTurnOutput returns null for non-producers", () => {
  const settlement = { q: 5, r: 5, citySpots: [] };
  assert.equal(producerTurnOutput({ gx: 0, gy: 0, kind: "house", level: 1 }, settlement, 1), null);
});

test("producerTurnOutput returns null while the building is under construction", () => {
  const settlement = { q: 5, r: 5, citySpots: [GOLD_SPOT] };
  const constructing = producerTurnOutput(
    { gx: 2, gy: 2, kind: "goldMine", level: 1, construction: { daysRemaining: 3 } },
    settlement,
    42,
  );
  assert.equal(constructing, null, "a building under construction produces nothing");
  assert.notEqual(producerTurnOutput({ gx: 2, gy: 2, kind: "goldMine", level: 1 }, settlement, 42), null);
});

test("produceSettlementResources adds producer outputs to warehouse and treasury", () => {
  const before = cellMultiplier({ seed: 7, q: 2, r: 2, gx: 2, gy: 2, resource: "gold", spots: [GOLD_SPOT] });
  const woodMult = cellMultiplier({ seed: 7, q: 2, r: 2, gx: 4, gy: 4, resource: "wood", spots: [GOLD_SPOT] });
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 100,
    warehouse: emptyWarehouse(),
    citySpots: [GOLD_SPOT],
    buildings: [
      { gx: 2, gy: 2, kind: "goldMine", level: 1 },
      { gx: 4, gy: 4, kind: "woodcutterHut", level: 1 },
    ],
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, 7));
  assert.equal(after.gold, 100 + Math.round(40 * before * 100) / 100);
  assert.equal(after.warehouse.wood, Math.round(3 * woodMult * 100) / 100);
  assert.equal(after.warehouse.food, 0);
});

test("settlements without producers produce only their tile rates, unchanged", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    resourceRates: { wood: 15 },
    warehouse: emptyWarehouse({ wood: 10 }),
    buildings: [{ gx: 0, gy: 0, kind: "house", level: 1 }],
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, 99));
  assert.equal(after.warehouse.wood, 25);
  assert.equal(after.gold, 0);
});

test("EndTurn pays producer gold into the treasury (server tick parity via the same reducer)", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    citySpots: [GOLD_SPOT],
    buildings: [{ gx: 2, gy: 2, kind: "goldMine", level: 1 }],
  });
  const state = makeState({ settlements: [settlement], activePlayerId: 0 });
  const next = applyEndOfTurn(state);
  const expectedGold = Math.round(40 * cellMultiplier({
    seed: 0,
    q: 2,
    r: 2,
    gx: 2,
    gy: 2,
    resource: "gold",
    spots: [GOLD_SPOT],
  }) * 100) / 100;
  assert.equal(next.settlements.s0.gold, expectedGold);
});
