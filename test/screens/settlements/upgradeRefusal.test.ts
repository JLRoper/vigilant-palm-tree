import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import { BASE_TREASURY, TOWN_HALL_COSTS, SETTLEMENT_UPGRADE_COSTS, settlementTreasuryCap } from "@heroes/engine";
import {
  upgradeBlocked,
  upgradeRefusalReasons,
  upgradeRefusalTitle,
  upgradeShortfallLines,
} from "../../../src/screens/settlements/upgradeRefusal";
import { capBuildingHint, treasuryCapBlockerMessage, treasuryCapBlocksGold } from "../../../src/screens/settlements/treasuryCap";

// F-2 and F-6 (the round-2 city-view card): the town hall's `L3: 5000g 40w 25s
// / 12d` offer was rendered with a DISABLED `Upgrade` button carrying an EMPTY
// `title`, so a player at a level-1 settlement (treasury cap 1,500g) saw a dead
// control and no sentence anywhere saying why -- and the reason was not the
// income: the price is above the cap, and income is discarded at the cap, so no
// amount of waiting reaches it. F-6 is the same coin at settlement level 2,
// where the cap is 4,000g and the price is still 5,000g.
//
// Self-contained fixtures, matching treasuryCap.test.ts: these rules only read
// level/gold/warehouse/buildings/population.

function building(kind: BuildingDef["kind"], level = 1, gx = 0, gy = 0): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

function settlement(overrides: Partial<SettlementState> = {}): SettlementState {
  return {
    id: "s0",
    name: "Dragon spire",
    ownerId: 0,
    q: 3,
    r: 3,
    level: 1,
    population: 500,
    goldTax: 1,
    resourceRates: {},
    foundedOnResource: null,
    gold: 1500,
    warehouse: { wood: 300, stone: 300, iron: 300, arcane: 300, food: 30 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: false,
    castleVariant: 0,
    buildings: [building("townHall", 2)],
    ...overrides,
  };
}

const TH_L3 = TOWN_HALL_COSTS[2];
const TH_L2 = TOWN_HALL_COSTS[1];

test("the town hall's price list is the engine's own, so the panel cannot quote a price the reducer does not charge", () => {
  assert.deepEqual(TH_L3, { gold: 5000, wood: 40, stone: 25, days: 12 });
  assert.deepEqual(TH_L2, { gold: 1500, wood: 15, stone: 10, days: 7 });
});

test("F-2: the blocked L3 offer at settlement level 1 states the shortfall in the build palette's own words", () => {
  const s = settlement({ level: 1, gold: BASE_TREASURY[1], buildings: [building("townHall", 2)] });
  assert.equal(settlementTreasuryCap(s), 1500, "fixture premise: a level-1 cap is exactly 1,500g");

  const reasons = upgradeRefusalReasons({ settlement: s, cost: TH_L3 });
  assert.equal(upgradeBlocked({ settlement: s, cost: TH_L3 }), true, "the control is dead");
  assert.equal(reasons[0], "Not enough gold (need 5000, have 1500)", "the palette's own line, verbatim");
  assert.equal(
    reasons.some((r) => r.startsWith("Not enough wood")),
    false,
    "300 wood covers a 40 wood price -- only the resources actually short are named",
  );
});

test("F-2: the empty title is gone -- the reason names what is missing, one line per missing resource", () => {
  const s = settlement({ gold: 1500, warehouse: { wood: 12, stone: 300, iron: 0, arcane: 0, food: 0 } });
  const reasons = upgradeRefusalReasons({ settlement: s, cost: TH_L3 });
  assert.deepEqual(reasons.slice(0, 2), [
    "Not enough gold (need 5000, have 1500)",
    "Not enough wood (need 40, have 12)",
  ]);
  assert.equal(upgradeShortfallLines(s, TH_L3).length, 2, "only the resources actually short are named");
});

test("F-2: where the cap is the real blocker the title says so and names the way out", () => {
  const s = settlement({ level: 1, gold: BASE_TREASURY[1] });
  assert.equal(treasuryCapBlocksGold(s, TH_L3.gold), true, "5,000g does not fit under a 1,500g cap");

  const title = upgradeRefusalTitle({ settlement: s, cost: TH_L3 });
  assert.match(title, /Costs 5,000g, more than this settlement's 1,500g treasury cap/);
  assert.match(title, /income is discarded at the cap, so the gold can never be held/);
  assert.match(title, /Build a Bank or Treasury \(\+2,000g of cap per level, 400g each\) first\./);
  assert.equal(capBuildingHint(), "a Bank or Treasury (+2,000g of cap per level, 400g each)");
});

test("F-6: the same offer at settlement level 2 is cap-blocked too -- 4,000g of cap against a 5,000g price", () => {
  const s = settlement({ level: 2, gold: BASE_TREASURY[2], buildings: [building("townHall", 2)] });
  assert.equal(settlementTreasuryCap(s), 4000, "fixture premise: a level-2 cap is 4,000g");
  assert.equal(treasuryCapBlocksGold(s, TH_L3.gold), true, "the level-2 cap cannot hold the L3 price either");

  const title = upgradeRefusalTitle({ settlement: s, cost: TH_L3 });
  assert.match(title, /Not enough gold \(need 5000, have 4000\)/);
  assert.match(title, /more than this settlement's 4,000g treasury cap/);
});

test("F-6: the settlement's own L3 upgrade is cap-blocked as well -- 15,000g against a 4,000g cap", () => {
  const cost = SETTLEMENT_UPGRADE_COSTS[2];
  assert.equal(cost.gold, 15000, "fixture premise");
  const s = settlement({ level: 2, gold: BASE_TREASURY[2] });
  const title = upgradeRefusalTitle({ settlement: s, cost });
  assert.match(title, /Not enough gold \(need 15000, have 4000\)/);
  assert.match(title, /more than this settlement's 4,000g treasury cap/);
});

test("the way out works: a Bank raises the cap past the price and the control goes live", () => {
  const withoutBank = settlement({ level: 2, gold: BASE_TREASURY[2], warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 } });
  const withBank = settlement({
    level: 2,
    gold: 5000,
    warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 },
    buildings: [building("townHall", 2), building("bank", 1, 1, 1)],
  });
  assert.equal(settlementTreasuryCap(withBank), 6000, "a level-1 bank adds its 2,000g");
  assert.equal(upgradeBlocked({ settlement: withBank, cost: TH_L3 }), false, "affordable AND holdable");
  assert.equal(upgradeRefusalTitle({ settlement: withBank, cost: TH_L3 }), "", "a live control carries no refusal");
  assert.equal(upgradeBlocked({ settlement: withoutBank, cost: TH_L3 }), true, "the same gold without the bank is not");
});

test("the cap sentence is not noise: it appears only when the gold is what is missing", () => {
  // Gold already in hand (a legacy over-cap purse): the cap is not the blocker,
  // so the refusal is the resource line alone.
  const rich = settlement({ level: 1, gold: 9000, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } });
  const reasons = upgradeRefusalReasons({ settlement: rich, cost: TH_L3 });
  assert.deepEqual(reasons, ["Not enough wood (need 40, have 0)", "Not enough stone (need 25, have 0)"]);
  assert.equal(reasons.some((r) => r.includes("treasury cap")), false);
});

test("a running upgrade and a building still under construction each say so", () => {
  const upgrading = settlement({ level: 1, gold: 1500, upgrade: { kind: "settlement", targetLevel: 2, daysRemaining: 8 } });
  const title = upgradeRefusalTitle({ settlement: upgrading, cost: TH_L3, inProgress: true });
  assert.match(title, /An upgrade is already in progress/);

  const constructing = settlement({ level: 1, gold: 1500 });
  const buildingTitle = upgradeRefusalTitle({
    settlement: constructing,
    cost: TH_L3,
    extra: ["Still under construction"],
  });
  assert.match(buildingTitle, /Still under construction/);
});

test("an affordable, holdable upgrade has no refusal at all", () => {
  const s = settlement({
    level: 2,
    gold: 5000,
    warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 },
    buildings: [building("townHall", 2), building("treasury")],
  });
  assert.equal(upgradeRefusalTitle({ settlement: s, cost: TH_L3 }), "");
  assert.equal(upgradeBlocked({ settlement: s, cost: TH_L3 }), false);
});

test("the cap sentence is one sentence, shared by every control that can be cap-blocked", () => {
  const s = settlement({ level: 1, gold: 1500 });
  assert.equal(
    treasuryCapBlockerMessage(s, TH_L3.gold),
    "Costs 5,000g, more than this settlement's 1,500g treasury cap — income is discarded at the cap, " +
      "so the gold can never be held. Build a Bank or Treasury (+2,000g of cap per level, 400g each) first.",
  );
});
