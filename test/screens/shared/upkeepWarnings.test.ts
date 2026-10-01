import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  GameState,
  HeroState,
  Player,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import {
  DESERTION_AFTER_WEEKS,
  evaluateUpkeepWarnings,
  upkeepSummaryToastMessage,
  upkeepToastMessage,
  UPKEEP_SUMMARY_OFFENDER_LIMIT,
} from "../../../src/screens/shared/upkeepWarnings";

// Self-contained fixtures: the upkeep fields are required on HeroState /
// SettlementState, and this suite must not depend on a shared fixture builder
// that is still being migrated.

function makePlayer(id: number, heroIds: string[], settlementIds: string[]): Player {
  return {
    id,
    faction: id === 0 ? "player" : "ai",
    name: id === 0 ? "Player 1" : `AI ${id + 1}`,
    color: "#000000",
    heroIds,
    settlementIds,
  };
}

function hero(
  id: string,
  ownerId: number,
  overrides: Partial<HeroState> = {},
): HeroState {
  return {
    id,
    name: id,
    ownerId,
    q: 2,
    r: 2,
    movementRemaining: 7,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [],
    gold: 0,
    troops: 1,
    stacks: [],
    isChartering: false,
    charterId: null,
    horseVariant: "bubbly",
    arcane: 5,
    intelligence: 5,
    heroMana: 25,
    heroMaxMana: 25,
    heroSpell: "magic_arrow",
    morale: 100,
    upkeepUnpaidSinceDay: null,
    upkeepUnpaidTroops: 0,
    upkeepUnpaidGold: 0,
    ...overrides,
  };
}

function settlement(
  id: string,
  ownerId: number | null,
  overrides: Partial<SettlementState> = {},
): SettlementState {
  return {
    id,
    name: id,
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

function makeState(opts: {
  day?: number;
  players?: Player[];
  heroes?: HeroState[];
  settlements?: SettlementState[];
}): GameState {
  const heroes: Record<string, HeroState> = {};
  for (const h of opts.heroes ?? []) heroes[h.id] = h;
  const settlements: Record<SettlementId, SettlementState> = {};
  for (const s of opts.settlements ?? []) settlements[s.id] = s;
  const activePlayerId = 0;
  return {
    round: 1,
    day: opts.day ?? 1,
    activePlayerId,
    players: opts.players ?? [makePlayer(0, [], [])],
    heroes,
    settlements,
    phase: { kind: "PLAYER_TURN", playerId: activePlayerId },
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

const HOLD = "Blackrock Hold";

test("nothing owed produces no rows", () => {
  const state = makeState({
    heroes: [hero("h0", 0)],
    settlements: [settlement("s0", 0, { name: HOLD })],
  });
  assert.deepEqual(evaluateUpkeepWarnings(state, 0), []);
});

test("an unknown seat produces no rows even when upkeep is unpaid", () => {
  const state = makeState({
    heroes: [hero("h0", 0, { upkeepUnpaidSinceDay: 1, upkeepUnpaidTroops: 4, upkeepUnpaidGold: 60 })],
    settlements: [settlement("s0", 0, { garrisonUnpaidSinceDay: 1 })],
  });
  assert.deepEqual(evaluateUpkeepWarnings(state, null), []);
});

test("an unpaid hero yields a hero row with the shortfall spelled out", () => {
  const state = makeState({
    day: 10,
    heroes: [hero("h0", 0, { morale: 92, upkeepUnpaidSinceDay: 1, upkeepUnpaidTroops: 4, upkeepUnpaidGold: 60 })],
  });
  const rows = evaluateUpkeepWarnings(state, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    key: "hero:h0",
    kind: "hero",
    label: "h0",
    daysUnpaid: 9,
    weeksUnpaid: 1,
    unfedTroops: 4,
    unpaidGold: 60,
    morale: 92,
    deserting: false,
    detail: "unfed 4 troops (worth 60g/wk) · 9 days unpaid · morale 92% · desertion in 1 more week",
  });
});

test("an unpaid settlement yields a settlement row", () => {
  const state = makeState({
    day: 8,
    settlements: [
      settlement("s0", 0, {
        name: HOLD,
        morale: 71,
        garrisonUnpaidSinceDay: 1,
        garrisonUnpaidTroops: 9,
        garrisonUnpaidGold: 45,
      }),
    ],
  });
  const rows = evaluateUpkeepWarnings(state, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "settlement");
  assert.equal(rows[0].key, "settlement:s0");
  assert.equal(rows[0].label, HOLD);
  assert.equal(rows[0].daysUnpaid, 7);
  assert.equal(rows[0].weeksUnpaid, 1);
  assert.equal(rows[0].unfedTroops, 9);
  assert.equal(rows[0].unpaidGold, 45);
  assert.equal(rows[0].morale, 71);
  assert.equal(rows[0].deserting, false);
});

test("foreign and neutral entities are excluded", () => {
  const state = makeState({
    players: [makePlayer(0, ["h0"], ["s0"]), makePlayer(1, ["h1"], ["s1"])],
    heroes: [hero("h0", 0, { upkeepUnpaidSinceDay: 1 }), hero("h1", 1, { upkeepUnpaidSinceDay: 1 })],
    settlements: [
      settlement("s0", 0, { garrisonUnpaidSinceDay: 1 }),
      settlement("s1", 1, { garrisonUnpaidSinceDay: 1 }),
      settlement("s2", null, { garrisonUnpaidSinceDay: 1 }),
    ],
  });
  const rows = evaluateUpkeepWarnings(state, 0);
  assert.deepEqual(rows.map((r) => r.key).sort(), ["hero:h0", "settlement:s0"]);
});

test("a second seat only sees its own entities", () => {
  const state = makeState({
    players: [makePlayer(0, ["h0"], ["s0"]), makePlayer(1, ["h1"], ["s1"])],
    heroes: [hero("h0", 0, { upkeepUnpaidSinceDay: 1 }), hero("h1", 1, { upkeepUnpaidSinceDay: 1 })],
    settlements: [settlement("s0", 0, { garrisonUnpaidSinceDay: 1 }), settlement("s1", 1, { garrisonUnpaidSinceDay: 1 })],
  });
  assert.deepEqual(
    evaluateUpkeepWarnings(state, 1).map((r) => r.key).sort(),
    ["hero:h1", "settlement:s1"],
  );
});

test("desertion flips at exactly two unpaid weeks", () => {
  assert.equal(DESERTION_AFTER_WEEKS, 2);
  const thirteen = evaluateUpkeepWarnings(
    makeState({ day: 14, heroes: [hero("h0", 0, { upkeepUnpaidSinceDay: 1 })] }),
    0,
  );
  const fourteen = evaluateUpkeepWarnings(
    makeState({ day: 15, heroes: [hero("h0", 0, { upkeepUnpaidSinceDay: 1 })] }),
    0,
  );
  assert.equal(thirteen[0].daysUnpaid, 13);
  assert.equal(thirteen[0].weeksUnpaid, 1);
  assert.equal(thirteen[0].deserting, false);
  assert.equal(fourteen[0].daysUnpaid, 14);
  assert.equal(fourteen[0].weeksUnpaid, 2);
  assert.equal(fourteen[0].deserting, true);
  assert.match(thirteen[0].detail, /desertion in 1 more week$/);
  assert.match(fourteen[0].detail, /desertion has started$/);
});

test("settlement desertion uses the same two-week threshold", () => {
  const before = evaluateUpkeepWarnings(
    makeState({ day: 14, settlements: [settlement("s0", 0, { garrisonUnpaidSinceDay: 1 })] }),
    0,
  );
  const after = evaluateUpkeepWarnings(
    makeState({ day: 15, settlements: [settlement("s0", 0, { garrisonUnpaidSinceDay: 1 })] }),
    0,
  );
  assert.equal(before[0].deserting, false);
  assert.equal(after[0].deserting, true);
});

test("a shortfall dated in the future clamps to zero days", () => {
  const rows = evaluateUpkeepWarnings(
    makeState({ day: 3, heroes: [hero("h0", 0, { upkeepUnpaidSinceDay: 9, upkeepUnpaidTroops: 2 })] }),
    0,
  );
  assert.equal(rows[0].daysUnpaid, 0);
  assert.equal(rows[0].weeksUnpaid, 0);
  assert.equal(rows[0].deserting, false);
});

test("detail text names troops, gold, days and morale", () => {
  const rows = evaluateUpkeepWarnings(
    makeState({
      day: 20,
      settlements: [
        settlement("s0", 0, { morale: 88, garrisonUnpaidSinceDay: 1, garrisonUnpaidTroops: 1, garrisonUnpaidGold: 15 }),
      ],
    }),
    0,
  );
  assert.equal(
    rows[0].detail,
    "unfed 1 troop (worth 15g/wk) · 19 days unpaid · morale 88% · desertion has started",
  );
});

test("rows sort deserting first, then longest-unpaid first", () => {
  // day 40: the desertion threshold is 14 days, so the >=14-day rows lead.
  const state = makeState({
    day: 40,
    players: [makePlayer(0, ["h0", "h1", "h2"], ["s0", "s1", "s2"])],
    heroes: [
      hero("h0", 0, { upkeepUnpaidSinceDay: 32 }), // 8 days
      hero("h1", 0, { upkeepUnpaidSinceDay: 1 }), // 39 days, deserting
      hero("h2", 0, { upkeepUnpaidSinceDay: 28 }), // 12 days
    ],
    settlements: [
      settlement("s0", 0, { garrisonUnpaidSinceDay: 12 }), // 28 days, deserting
      settlement("s1", 0, { garrisonUnpaidSinceDay: 39 }), // 1 day
      settlement("s2", 0, { garrisonUnpaidSinceDay: 30 }), // 10 days
    ],
  });
  const rows = evaluateUpkeepWarnings(state, 0);
  assert.deepEqual(
    rows.map((r) => [r.key, r.deserting, r.daysUnpaid]),
    [
      ["hero:h1", true, 39],
      ["settlement:s0", true, 28],
      ["hero:h2", false, 12],
      ["settlement:s2", false, 10],
      ["hero:h0", false, 8],
      ["settlement:s1", false, 1],
    ],
  );
});

test("hero and settlement toast copy names the entity and the consequence", () => {
  const state = makeState({
    day: 9,
    heroes: [
      hero("h0", 0, {
        name: "Warlord",
        morale: 88,
        upkeepUnpaidSinceDay: 1,
        upkeepUnpaidTroops: 12,
        upkeepUnpaidGold: 60,
      }),
    ],
    settlements: [
      settlement("s0", 0, {
        name: HOLD,
        garrisonUnpaidSinceDay: 1,
        garrisonUnpaidTroops: 4,
        garrisonUnpaidGold: 60,
      }),
    ],
  });
  // Equal daysUnpaid: heroes are collected before settlements and the sort is
  // stable, so the hero leads.
  const [heroRow, settlementRow] = evaluateUpkeepWarnings(state, 0);
  assert.equal(
    upkeepToastMessage(settlementRow),
    "Blackrock Hold: cannot pay garrison upkeep — 60g/wk short, 4 troops unfed for 8 days. Morale is falling.",
  );
  assert.equal(
    upkeepToastMessage(heroRow),
    "Warlord: 12 troops unfed (8 days) — morale 88%. Troops desert after 1 more week.",
  );
});

test("a deserting entity's toast says troops are leaving", () => {
  const rows = evaluateUpkeepWarnings(
    makeState({
      day: 30,
      heroes: [hero("h0", 0, { name: "Warlord", upkeepUnpaidSinceDay: 1, upkeepUnpaidTroops: 12 })],
      settlements: [
        settlement("s0", 0, { name: HOLD, garrisonUnpaidSinceDay: 1, garrisonUnpaidTroops: 4 }),
      ],
    }),
    0,
  );
  assert.equal(
    upkeepToastMessage(rows[1]),
    "Blackrock Hold: cannot pay garrison upkeep — 0g/wk short, 4 troops unfed for 29 days. Morale is falling and garrison troops are deserting.",
  );
  assert.equal(
    upkeepToastMessage(rows[0]),
    "Warlord: 12 troops unfed (29 days) — morale 100%. Troops are deserting.",
  );
});

test("the summary toast counts every offender and names the top three", () => {
  const state = makeState({
    day: 30,
    heroes: [
      hero("h0", 0, { name: "Alpha", upkeepUnpaidSinceDay: 1 }),
      hero("h1", 0, { name: "Bravo", upkeepUnpaidSinceDay: 2 }),
      hero("h2", 0, { name: "Charlie", upkeepUnpaidSinceDay: 3 }),
      hero("h3", 0, { name: "Delta", upkeepUnpaidSinceDay: 4 }),
    ],
  });
  const rows = evaluateUpkeepWarnings(state, 0);
  assert.equal(rows.length, 4);
  assert.equal(UPKEEP_SUMMARY_OFFENDER_LIMIT, 3);
  const message = upkeepSummaryToastMessage(rows);
  assert.match(message, /^Upkeep unpaid at 4 of your holdings — /);
  assert.match(message, /Alpha/);
  assert.match(message, /Bravo/);
  assert.match(message, /Charlie/);
  assert.ok(!message.includes("Delta"));
  assert.match(message, /Morale is falling; troops desert after 2 unpaid weeks\.$/);
});
