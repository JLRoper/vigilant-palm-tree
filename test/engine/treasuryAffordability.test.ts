import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingKind } from "@heroes/contracts";
import {
  BASE_TREASURY,
  SETTLEMENT_UPGRADE_COSTS,
  STARTER_BUILDING_KINDS,
  TOWN_HALL_COSTS,
  applyEffectiveIncome,
  buildingFootprintFromRegistry,
  buildingLevelAllowed,
  buildingRequiredLevel,
  buildingPlacementCost,
  buildingSettlementEffects,
  buildingUpgradeCost,
  cityViewSizeFor,
  getBuildingEffect,
  settlementTreasuryCap,
  startSettlementUpgrade,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

// THE CAP MUST HOLD WHAT THE LEVEL IS OFFERED.
//
// A settlement pays for its own upgrades out of its own treasury, and every
// gold addition lands clamped by `treasuryHeadroom(current, settlementTreasuryCap(s))`
// (produceResources / applyEffectiveIncome / matureBankWithdrawals). So a price
// ABOVE the cap the settlement can REACH is not a shortfall the player can close
// by waiting -- it is an offer that can never be accepted, and a refusal line
// that tells them to save for it is asking for the impossible.
//
// Measured on github/main 120626c (0.51.1), across every gold price the engine
// offers: exactly one is unreachable at any build-out -- the settlement tier's
// L1->L2 upgrade at 5,000g, against a level-1 cap that is hard 1,500g because
// no treasury-building kind is placeable before settlement level 2
// (warehouse / bank / treasury are the only three kinds with a `treasuryBonus`,
// all `requiredLevel: 2`).
//
// The other three prices above their level's BASE cap are deliberately NOT
// cap-blocked: at settlement level 2 a Bank or Treasury is placeable and adds
// +2,000g of cap per level, so the level-2 offers are reachable through the
// design's own capacity path (that is what the refusal's "Build a Bank or
// Treasury" names). Level 1 has no such path, so the level-1 base must carry it.

/** Every kind in the union (packages/contracts/src/buildings.ts) -- a literal, because the union is a type. */
const ALL_KINDS: BuildingKind[] = [
  "townHall", "house", "tower", "mageGuild", "mine", "stoneMine", "ironMine", "market",
  "barracks", "smithy", "apartment", "farmField", "farmhouse", "archeryRange", "granary",
  "warehouse", "bank", "treasury", "goldMine", "woodcutterHut", "arcaneFont", "shipyard",
  "stables", "huntingLodge", "eyrie", "crypt", "ossuary", "wraithBarrows", "spireOfAsh",
  "forgeHall", "gunnersRedoubt", "golemFoundry", "deepAnvil", "groveSanctum", "warrenLodge",
  "sylvanStables", "worldrootGrove", "blackChapel", "dragonBoneyard", "delversHall",
  "hearthTemple", "ramPens", "seedlingGrove", "druidCircle",
];

function cellsOf(kind: BuildingKind, level = 1): number {
  const fp = buildingFootprintFromRegistry(kind, level);
  return Math.max(1, Math.ceil(fp.w)) * Math.max(1, Math.ceil(fp.h));
}

/** The cap-building kinds a settlement of this level may place, best bonus first. */
function capKindsFor(level: 1 | 2 | 3): Array<{ kind: BuildingKind; bonus: number }> {
  const out: Array<{ kind: BuildingKind; bonus: number }> = [];
  for (const kind of ALL_KINDS) {
    if (!buildingLevelAllowed(kind, level)) continue;
    const bonus = buildingSettlementEffects(kind, 1).treasuryBonus ?? 0;
    if (bonus > 0) out.push({ kind, bonus });
  }
  return out.sort((a, b) => b.bonus - a.bonus);
}

/**
 * The highest treasury cap a settlement of this level can actually reach: the
 * level base plus every cap-building the level may place, filling the free cells
 * of its city grid (the starter set already stands on the rest). Read from the
 * registry, so a new cap-building or a moved level gate moves this with it.
 */
function reachableTreasuryCap(level: 1 | 2 | 3): number {
  const grid = cityViewSizeFor(level) ** 2;
  let free = grid - STARTER_BUILDING_KINDS.reduce((n, k) => n + cellsOf(k), 0);
  let cap = BASE_TREASURY[level];
  for (const { kind, bonus } of capKindsFor(level)) {
    const area = cellsOf(kind);
    while (free >= area) {
      cap += bonus;
      free -= area;
    }
  }
  return cap;
}

interface GoldOffer {
  what: string;
  offeredAt: 1 | 2 | 3;
  gold: number;
}

/** Every gold price the engine offers a settlement, with the level it is offered at. */
function goldOffers(): GoldOffer[] {
  const offers: GoldOffer[] = [];
  for (const [from, cost] of Object.entries(TOWN_HALL_COSTS)) {
    offers.push({ what: `town hall L${from}->L${Number(from) + 1}`, offeredAt: Number(from) as 1, gold: cost.gold });
  }
  for (const [from, cost] of Object.entries(SETTLEMENT_UPGRADE_COSTS)) {
    offers.push({ what: `settlement L${from}->L${Number(from) + 1}`, offeredAt: Number(from) as 1, gold: cost.gold });
  }
  for (const kind of ALL_KINDS) {
    for (const lvl of [1, 2] as const) {
      if (!buildingLevelAllowed(kind, lvl)) continue;
      const cost = buildingUpgradeCost(kind, lvl);
      if (cost) offers.push({ what: `${kind} L${lvl}->L${lvl + 1}`, offeredAt: lvl, gold: cost.gold });
    }
  }
  for (const kind of ALL_KINDS) {
    const required = buildingRequiredLevel(kind);
    for (const recruit of getBuildingEffect(kind).recruits ?? []) {
      offers.push({
        what: `recruit ${recruit.unitTypeId} at ${kind}`,
        offeredAt: Math.max(required, recruit.minLevel ?? 1) as 1 | 2 | 3,
        gold: recruit.goldCost,
      });
    }
  }
  return offers;
}

// ---------------------------------------------------------------------------
// The pin the card is about: one literal value, and the relationship it obeys.
// ---------------------------------------------------------------------------

test("the level-1 base cap holds the level-1 tier upgrade's price", () => {
  const tierPrice = SETTLEMENT_UPGRADE_COSTS[1].gold;
  assert.equal(tierPrice, 5000, "fixture premise: the settlement L1->L2 tier upgrade costs 5,000g");
  assert.equal(BASE_TREASURY[1], 5000, "BASE_TREASURY[1] must be able to hold it");
  assert.ok(
    BASE_TREASURY[1] >= tierPrice,
    `a level-1 vault of ${BASE_TREASURY[1]}g cannot hold the ${tierPrice}g its own tier upgrade costs`,
  );
});

test("every gold price the engine offers is reachable at the level it is offered", () => {
  const offers = goldOffers();
  assert.ok(offers.length > 50, `fixture premise: the sweep sees the whole table, got ${offers.length}`);
  const unreachable = offers
    .filter((o) => o.gold > reachableTreasuryCap(o.offeredAt))
    .map((o) => `${o.what}: ${o.gold}g at settlement level ${o.offeredAt}, whose highest reachable cap is ${reachableTreasuryCap(o.offeredAt)}g`);
  assert.deepEqual(unreachable, [], "an offer above the cap it can reach is a refusal no amount of waiting can clear");
});

// ---------------------------------------------------------------------------
// The real-refusal proof: the gold must be able to ARRIVE, not just to be paid.
// ---------------------------------------------------------------------------

test("a level-1 settlement can save up to its tier price and start the upgrade", () => {
  const tierPrice = SETTLEMENT_UPGRADE_COSTS[1].gold;
  let settlement = makeSettlement("s0", 0, 2, 2, {
    level: 1,
    population: 500,
    goldTax: 1,
    gold: 0,
    warehouse: { wood: 40, stone: 30, iron: 20, arcane: 0, food: 0 },
    buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 2, style: "classic" }],
  });

  // Twenty turns of a level-1 keep's own income (500 pop x tax 1 = 500g/turn).
  // Before the fix this parks on 1,500g -- every turn after that discards the
  // whole income at the cap -- so the price below can never be met.
  for (let turn = 0; turn < 20; turn++) settlement = applyEffectiveIncome(settlement);
  assert.ok(
    settlement.gold >= tierPrice,
    `income stalled at ${settlement.gold}g, below the ${tierPrice}g tier upgrade`,
  );
  assert.equal(settlementTreasuryCap(settlement), BASE_TREASURY[1], "fixture premise: no cap-building stands at level 1");

  const state = makeState({ settlements: [settlement] });
  const result = startSettlementUpgrade(state, "s0", 2, {}, []);
  assert.equal(result.ok, true, `the cap-reachable price must be payable, got ${result.ok ? "" : result.reason}`);
  assert.equal(result.state.settlements.s0.gold, settlement.gold - tierPrice, "the price is paid from the treasury");
});

// ---------------------------------------------------------------------------
// What deliberately did NOT move: the prices, and the levels that have a capacity path.
// ---------------------------------------------------------------------------

test("no price changed -- the fix is the cap, not the cost", () => {
  assert.equal(TOWN_HALL_COSTS[1].gold, 1500);
  assert.equal(TOWN_HALL_COSTS[2].gold, 5000);
  assert.equal(SETTLEMENT_UPGRADE_COSTS[1].gold, 5000);
  assert.equal(SETTLEMENT_UPGRADE_COSTS[2].gold, 15000);
});

test("the levels with a capacity path keep their base caps -- the gate is still a gate", () => {
  assert.equal(BASE_TREASURY[2], 4000, "level 2 reaches its 15,000g tier price with six cap-buildings, not a raised base");
  assert.equal(BASE_TREASURY[3], 10000);
  assert.equal(capKindsFor(2).map((c) => c.kind).sort().join(","), "bank,treasury,warehouse");
  assert.equal(capKindsFor(1).length, 0, "level 1 has no capacity path at all -- that is why its base carries the price");
});

test("the level-2 offers still exceed the level-2 BASE cap, and a Bank closes that gap", () => {
  const bare = makeSettlement("s0", 0, 2, 2, { level: 2, gold: BASE_TREASURY[2] });
  assert.equal(settlementTreasuryCap(bare), 4000);
  assert.ok(SETTLEMENT_UPGRADE_COSTS[2].gold > settlementTreasuryCap(bare));

  const bankCost = buildingPlacementCost("bank").gold ?? 0;
  assert.equal(bankCost, 400);
  const withSixBanks = makeSettlement("s0", 0, 2, 2, {
    level: 2,
    gold: SETTLEMENT_UPGRADE_COSTS[2].gold,
    buildings: Array.from({ length: 6 }, (_, i) => ({ gx: i, gy: 0, kind: "bank" as BuildingKind, level: 1, style: "classic" as const })),
  });
  assert.ok(
    settlementTreasuryCap(withSixBanks) >= SETTLEMENT_UPGRADE_COSTS[2].gold,
    `six level-1 banks must lift the level-2 cap past 15,000g, got ${settlementTreasuryCap(withSixBanks)}`,
  );
});
