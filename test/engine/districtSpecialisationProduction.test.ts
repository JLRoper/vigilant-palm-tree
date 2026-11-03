import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, DistrictState, SettlementState } from "@heroes/contracts";
import { produceSettlementResources, producerTurnOutput, settlementProductionRates } from "@heroes/engine";

// A district's specialisation must be a real, measured effect on the numbers a
// district pays -- and the numbers a mixed district pays must not move at all.
//
// This file deliberately imports ONLY symbols that already existed before
// district specialisation did (`producerTurnOutput`, `settlementProductionRates`,
// `produceSettlementResources`). A spec that imported the new derivation helpers
// would fail on the pre-change tree by IMPORT ERROR, which proves nothing about
// the arithmetic; expressed this way the same spec goes RED on the old engine by
// ASSERTION, because the old engine pays the plain sum of a district's producers
// no matter how lopsided the district is.
//
// The same arithmetic proves the other half: a district that is NOT specialised
// -- including every district the game seeds, which holds at most three distinct
// buildings, one short of the four-producer bar -- pays exactly the plain sum, so
// the change is neutral by default.
//
// The effect is applied to a district's TOTAL for each chain it has producers
// on, not to each producer: a level-1 producer pays 2-6 units and a fractional
// per-producer multiplier on those is swallowed whole by the payment loop's
// per-addition rounding. The expectations below are written the same way the
// engine computes them, on the aggregate.

const SEED = 4242;

function building(kind: BuildingDef["kind"], gx: number, gy: number, level = 1): BuildingDef {
  return { gx, gy, kind, level, style: "pixel" };
}

function settlement(districts: Record<string, DistrictState>): SettlementState {
  return {
    id: "s0",
    name: "s0",
    ownerId: 0,
    q: 2,
    r: 2,
    level: 3,
    population: 0,
    goldTax: 0,
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
    autoTrade: true,
    castleVariant: 0,
    buildings: [],
    districts,
  };
}

function district(q: number, r: number, buildings: BuildingDef[]): DistrictState {
  return { q, r, citySpots: [], buildings };
}

type Res = "food" | "stone" | "wood" | "iron" | "gold";

function rawAmount(b: BuildingDef, d: DistrictState): number {
  const out = producerTurnOutput(b, { q: d.q, r: d.r, citySpots: d.citySpots }, SEED);
  return out?.amount ?? 0;
}

/** A district's raw (unrounded) output on one chain -- the base the effect is sized on. */
function rawTotal(bs: BuildingDef[], d: DistrictState, resource: Res): number {
  return bs.reduce((total, b) => {
    const out = producerTurnOutput(b, { q: d.q, r: d.r, citySpots: d.citySpots }, SEED);
    return total + (out && out.resource === resource ? out.amount : 0);
  }, 0);
}

/** The plain sum a district pays on one resource, rounded once per producer, as the payment loop does. */
function plainRate(bs: BuildingDef[], d: DistrictState, resource: Res): number {
  return bs.reduce((total, b) => {
    const out = producerTurnOutput(b, { q: d.q, r: d.r, citySpots: d.citySpots }, SEED);
    return total + (out && out.resource === resource ? Math.round(out.amount) : 0);
  }, 0);
}

/** What the engine should pay a district on one resource: the plain lines, then the one adjustment line. */
function focusedRate(bs: BuildingDef[], d: DistrictState, resource: Res, chain: Res, effect: number): number {
  const adjustment = Math.round(Math.round(rawTotal(bs, d, resource) * (resource === chain ? effect : -effect) * 100) / 100);
  return plainRate(bs, d, resource) + adjustment;
}

function rateFor(s: SettlementState, resource: Res): number {
  return settlementProductionRates(s, SEED).rates.find((r) => r.resource === resource)?.perTurn ?? 0;
}

const FARMS: BuildingDef[] = [
  building("farmField", 0, 0),
  building("farmField", 2, 0),
  building("farmField", 0, 2),
  building("farmField", 2, 2),
];

test("a district of four farms on one chain pays MORE than the plain sum of its producers", () => {
  const d = district(3, 2, FARMS);
  const s = settlement({ "3,2": d });

  const plain = plainRate(FARMS, d, "food");
  const actual = rateFor(s, "food");
  assert.ok(plain > 0, "fixture: the farms must pay at least one food each");
  assert.equal(
    actual,
    focusedRate(FARMS, d, "food", "food", 0.25),
    `a fully food-specialised district pays its food output +25%: ${actual} against the plain ${plain}`,
  );
  assert.ok(actual > plain, `specialising a district on one chain must pay more than mixing it (${actual} > ${plain})`);
});

test("specialisation ramps: 4 farms + a house earns less than 4 farms alone, and 3 farms earns nothing", () => {
  const alone = district(3, 2, FARMS);
  const withHouse = district(3, 2, [...FARMS, building("house", 4, 4)]);
  const threeFarms = district(3, 2, [...FARMS.slice(0, 3), building("house", 4, 4)]);

  const aloneFood = rateFor(settlement({ "3,2": alone }), "food");
  const houseFood = rateFor(settlement({ "3,2": withHouse }), "food");
  const threeFood = rateFor(settlement({ "3,2": threeFarms }), "food");

  // 4 of 5 buildings = 0.8 share -> effect 0.125, against 0.25 at 4 of 4.
  assert.equal(houseFood, focusedRate(FARMS, withHouse, "food", "food", 0.125), "a 4-of-5 district pays +12.5%, not the full +25%");
  assert.ok(houseFood < aloneFood, `the more mixed the district, the smaller the bonus (${houseFood} < ${aloneFood})`);
  assert.ok(houseFood > plainRate(FARMS, alone, "food"), "4 of 5 is above the threshold, so it still pays");
  assert.equal(
    threeFood,
    plainRate(FARMS.slice(0, 3), threeFarms, "food"),
    "3 producers is one short of the bar, so the district is untouched",
  );
});

test("a MIXED district is neutral: three chains and a house pay exactly the plain producer sum", () => {
  const woodcutter = building("woodcutterHut", 0, 0);
  const mine = building("stoneMine", 2, 0);
  const farm = building("farmField", 0, 2);
  const house = building("house", 4, 4);
  const bs = [woodcutter, mine, farm, house];
  const d = district(5, 1, bs);
  const s = settlement({ "5,1": d });

  assert.equal(rateFor(s, "wood"), Math.round(rawAmount(woodcutter, d)), "the hut pays its plain output");
  assert.equal(rateFor(s, "stone"), Math.round(rawAmount(mine, d)), "the mine pays its plain output");
  assert.equal(rateFor(s, "food"), Math.round(rawAmount(farm, d)), "the single farm pays its plain output");
});

test("the specialised chain is paid out of what the district's OTHER producers give up", () => {
  const goldMine = building("goldMine", 4, 0);
  const bs = [...FARMS, goldMine];
  const d = district(7, 1, bs);
  const s = settlement({ "7,1": d });

  const rates = settlementProductionRates(s, SEED);
  const plainGold = Math.round(rawAmount(goldMine, d));

  // 4 of 5 buildings = 0.8 share -> effect 0.125: food +12.5% of the district's
  // own food, gold -12.5% of the district's own gold. A level-1 gold mine pays
  // ~45 gold, so this trade is visible in whole units on BOTH sides -- and it is
  // a losing trade on its face: +2 food for -6 gold. That is the point. A
  // district's specialisation is paid out of the district, and a district that
  // hosts a valuable off-chain producer is a bad place to specialise.
  assert.equal(rateFor(s, "food"), focusedRate(FARMS, d, "food", "food", 0.125));
  const rawGold = rawTotal(bs, d, "gold");
  const expectedGold = Math.round(rawGold + Math.round(rawGold * -0.125 * 100) / 100);
  assert.equal(rates.goldPerTurn, expectedGold);
  assert.ok(rates.goldPerTurn < plainGold, `the off-chain mine gives up gold: ${rates.goldPerTurn} against ${plainGold}`);
  assert.ok(rates.goldPerTurn > 0, "and still pays something -- specialising does not shut a building down");
});

test("produceSettlementResources pays the district exactly what settlementProductionRates advertises", () => {
  const bs = [...FARMS, building("goldMine", 4, 0)];
  const d = district(8, 1, bs);
  const s = settlement({ "8,1": d });

  const rates = settlementProductionRates(s, SEED);
  const after = produceSettlementResources({ s0: s }, SEED).s0;
  assert.ok(rates.rates.length >= 1, "fixture: the district pays at least one warehouse resource");
  for (const { resource, perTurn } of rates.rates) {
    assert.equal(after.warehouse[resource], perTurn, `${resource}: the turn pays the rate the panel shows`);
  }
  assert.equal(after.gold, rates.goldPerTurn, "gold: the turn pays the rate the panel shows");
});

test("a district occupied by an enemy hero still pays nothing, specialised or not", () => {
  const d = district(9, 1, FARMS);
  const s = settlement({ "9,1": d });
  const enemy = { ownerId: 1, q: 9, r: 1 };
  assert.deepEqual(settlementProductionRates(s, SEED, [enemy]), { rates: [], goldPerTurn: 0 });
  assert.equal(produceSettlementResources({ s0: s }, SEED, [enemy]).s0.warehouse.food, 0);
});
