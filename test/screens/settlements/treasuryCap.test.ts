import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, GameState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import { BASE_TREASURY, settlementTreasuryCap } from "@heroes/engine";
import {
  cappedSettlements,
  newlyCappedSettlements,
  TREASURY_CAP_AMBER,
  TREASURY_CAP_SUMMARY_OFFENDER_LIMIT,
  treasuryCapMessage,
  treasuryCapped,
  treasuryCapSummaryToastMessage,
  treasuryCapToastMessage,
} from "../../../src/screens/settlements/treasuryCap";

// Self-contained fixtures, matching upkeepWarnings.test.ts: the cap predicate
// only needs level/buildings/gold/ownerId, so a shared fixture builder is not
// worth the coupling.

const HOLD = "Blackrock Hold";

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
    name: id === "s0" ? HOLD : id,
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
    autoTrade: true,
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
    castleCount: 3,
    activeCharters: [],
    nextCharterId: 0,
    nextSettlementId: 100,
  };
}

test("below the cap is not capped", () => {
  assert.equal(treasuryCapped(settlement("s0", 0, { gold: 1499 })), false);
  assert.equal(treasuryCapped(settlement("s0", 0, { gold: 0 })), false);
});

test("exactly at the cap is capped -- headroom is already zero", () => {
  const atCap = settlement("s0", 0, { gold: BASE_TREASURY[1] });
  assert.equal(settlementTreasuryCap(atCap), 1500);
  assert.equal(treasuryCapped(atCap), true);
});

test("above the cap still counts: caps never claw gold back", () => {
  assert.equal(treasuryCapped(settlement("s0", 0, { gold: 5000 })), true);
});

test("the cap rises with level and with treasury/bank buildings", () => {
  const lvl1 = settlement("s0", 0, { level: 1, gold: 4000 });
  assert.equal(treasuryCapped(lvl1), true);

  const lvl2 = settlement("s0", 0, { level: 2, gold: 4000 });
  assert.equal(settlementTreasuryCap(lvl2), 4000);
  assert.equal(treasuryCapped(lvl2), true, "a bank/treasury that raises the cap must clear the row");

  const withTreasury = settlement("s0", 0, {
    level: 1,
    gold: 2000,
    buildings: [building("treasury")],
  });
  const cap = settlementTreasuryCap(withTreasury);
  assert.ok(cap > BASE_TREASURY[1], "treasury raises the cap");
  assert.equal(cap, 3500, "1500 base + 2000 per-level treasuryBonus");
  assert.equal(treasuryCapped(withTreasury), false, "a building that raises the cap must clear the row");
});

test("the message names the discarded income AND the remedy", () => {
  const msg = treasuryCapMessage(settlement("s0", 0, { name: HOLD, gold: 1500 }));
  assert.match(msg, /discarded/i);
  assert.match(msg, /Bank/);
  assert.match(msg, /Treasury/);
  assert.match(msg, /1,500g/);
  assert.match(msg, /income/);
});

test("the toast names the settlement; the summary names a count and up to the limit", () => {
  const one = settlement("s0", 0, { name: HOLD, gold: 1500 });
  assert.match(treasuryCapToastMessage(one), /^Blackrock Hold:/);

  const many = [
    settlement("a", 0, { name: "A", gold: 1500 }),
    settlement("b", 0, { name: "B", gold: 1500 }),
    settlement("c", 0, { name: "C", gold: 1500 }),
    settlement("d", 0, { name: "D", gold: 1500 }),
  ];
  const summary = treasuryCapSummaryToastMessage(many);
  assert.match(summary, /4/);
  assert.match(summary, /A, B, C/);
  assert.ok(!summary.includes("D"), "names at most TREASURY_CAP_SUMMARY_OFFENDER_LIMIT");
  assert.equal(TREASURY_CAP_SUMMARY_OFFENDER_LIMIT, 3);
});

test("the amber is the codebase's existing warning amber", () => {
  assert.equal(TREASURY_CAP_AMBER, "#ffb300");
});

test("foreign and neutral settlements are excluded", () => {
  const state = makeState([
    settlement("mine", 0, { gold: 1500 }),
    settlement("theirs", 1, { gold: 1500 }),
    settlement("neutral", null, { gold: 1500 }),
  ]);
  assert.deepEqual(cappedSettlements(state, 0).map((s) => s.id), ["mine"]);
  assert.deepEqual(cappedSettlements(state, null), [], "unknown seat warns about nothing");
});

test("transition: fires once on entry, not again while still capped", () => {
  const before = makeState([settlement("s0", 0, { gold: 1400 })]);
  const entered = makeState([settlement("s0", 0, { gold: 1500 })]);
  assert.deepEqual(newlyCappedSettlements(before, entered, 0).map((s) => s.id), ["s0"]);

  const stillCapped = makeState([settlement("s0", 0, { gold: 1500 })]);
  assert.deepEqual(newlyCappedSettlements(entered, stillCapped, 0), []);
  assert.deepEqual(newlyCappedSettlements(entered, stillCapped, 0), [], "and again next turn");
});

test("transition: un-cap then re-cap fires a second time", () => {
  const capped = makeState([settlement("s0", 0, { gold: 1500 })]);
  const uncapped = makeState([settlement("s0", 0, { gold: 1200 })]);
  assert.deepEqual(newlyCappedSettlements(capped, uncapped, 0), []);

  const reCapped = makeState([settlement("s0", 0, { gold: 1500 })]);
  assert.deepEqual(newlyCappedSettlements(uncapped, reCapped, 0).map((s) => s.id), ["s0"]);
});

test("transition: a settlement that drops out of the roster is not re-reported", () => {
  const before = makeState([settlement("s0", 0, { gold: 1500 })]);
  const lost = makeState([]);
  assert.deepEqual(newlyCappedSettlements(before, lost, 0), []);
});

test("transition: an unknown previous state counts every capped settlement", () => {
  const next = makeState([settlement("s0", 0, { gold: 1500 })]);
  assert.deepEqual(newlyCappedSettlements(null, next, 0).map((s) => s.id), ["s0"]);
});

test("transition: a failed end-turn that changed nothing reports nothing", () => {
  const state = makeState([settlement("s0", 0, { gold: 1500 })]);
  assert.deepEqual(newlyCappedSettlements(state, state, 0), []);
});

test("transition: foreign and neutral settlements never toast", () => {
  const before = makeState([settlement("theirs", 1, { gold: 0 }), settlement("neutral", null, { gold: 0 })]);
  const after = makeState([
    settlement("theirs", 1, { gold: 1500 }),
    settlement("neutral", null, { gold: 1500 }),
    settlement("mine", 0, { gold: 1500 }),
  ]);
  assert.deepEqual(newlyCappedSettlements(before, after, 0).map((s) => s.id), ["mine"]);
  assert.deepEqual(newlyCappedSettlements(before, after, null), []);
});

test("transition: a bank that raises the cap un-caps, then a refill re-caps", () => {
  // The clear case: building a cap-building mid-turn lifts the purse back under
  // the cap (colour clears, no toast), and filling the larger pot later is a
  // genuinely new crossing.
  const before = makeState([settlement("s0", 0, { level: 1, gold: 1500 })]);
  assert.equal(treasuryCapped(before.settlements.s0), true);

  const banked = makeState([
    settlement("s0", 0, { level: 1, gold: 1500, buildings: [building("bank")] }),
  ]);
  assert.equal(settlementTreasuryCap(banked.settlements.s0), 3500);
  assert.equal(treasuryCapped(banked.settlements.s0), false);
  assert.deepEqual(newlyCappedSettlements(before, banked, 0), [], "rising the cap is not a new cap");

  const refilled = makeState([
    settlement("s0", 0, { level: 1, gold: 3500, buildings: [building("bank")] }),
  ]);
  assert.deepEqual(newlyCappedSettlements(banked, refilled, 0).map((s) => s.id), ["s0"]);
});