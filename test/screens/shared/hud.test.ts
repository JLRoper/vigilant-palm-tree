import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "@heroes/contracts";
import {
  buildingSettlementEffects,
  effectiveSettlementIncome,
  playerEffectiveSettlementIncome,
} from "@heroes/engine";
import { updateHud, type PathCostReadout } from "../../../src/screens/shared/hud";
import { emptyWarehouse, makeHero, makeSettlement, makeState } from "../../charter/_helpers";

function fakeEl() {
  return { textContent: "", title: "" } as unknown as HTMLElement;
}

function render(state: ReturnType<typeof makeState>, readout: PathCostReadout | null = null, lastSavedAt: string | null = null) {
  const handles = {
    root: fakeEl(),
    round: fakeEl(),
    wealth: fakeEl(),
    income: fakeEl(),
    population: fakeEl(),
    upkeepGold: fakeEl(),
    upkeepFood: fakeEl(),
    morale: fakeEl(),
    context: fakeEl(),
  };
  updateHud(state, lastSavedAt, handles, 0, readout);
  return handles;
}

function economyState() {
  const market: BuildingDef = { gx: 1, gy: 1, kind: "market", level: 1 };
  return makeState({
    selectedHeroId: "h0",
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        population: 1000,
        goldTax: 1,
        morale: 90,
        warehouse: emptyWarehouse({ food: 4, wood: 5, stone: 5 }),
        buildings: [market],
      }),
      makeSettlement("s1", 1, 18, 4),
    ],
    heroes: [makeHero("h0", 0, 2, 2)],
  });
}

test("hud: economy pills carry round, wealth, income, population, upkeep and morale", () => {
  const h = render(economyState());
  assert.equal(h.round.textContent, "1");
  assert.equal(h.wealth.textContent, "0");
  assert.equal(h.income.textContent, "940");
  assert.equal(h.population.textContent, "1000");
  assert.equal(h.upkeepGold.textContent, "0");
  assert.equal(h.upkeepFood.textContent, "0");
  assert.equal(h.morale.textContent, "90%");
});

test("hud: a reachable path preview appends the cost against max movement", () => {
  const h = render(economyState(), { costToSplit: 4.6, totalCost: 9.8, destinationReachable: true });
  assert.match(h.context.textContent ?? "", /Movement 7\/7 · Path 4\.6\/7/);
});

test("hud: a clamped path preview appends the reachable share of the total cost", () => {
  const h = render(economyState(), { costToSplit: 4.6, totalCost: 9.8, destinationReachable: false });
  assert.match(h.context.textContent ?? "", /Movement 7\/7 · Path 4\.6 of 9\.8/);
});

test("hud: no path preview means no Path segment", () => {
  const h = render(economyState(), null);
  assert.doesNotMatch(h.context.textContent ?? "", /Path/);
  assert.match(h.context.textContent ?? "", /Movement 7\/7/);
});

test("hud: last saved rides the context segment (the smoke suite reads #hud for it)", () => {
  const h = render(economyState(), null, "2026-10-11T12:00:00Z");
  assert.match(h.context.textContent ?? "", /^Movement 7\/7 · Last saved /);
});

test("hud: economy breakdown title explains income scaling, upkeep, and the next-turn gold inconsistency", () => {
  const { title } = render(economyState()).root;
  const lines = title.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Income: settlements 1000g pop-tax \+ 40g buildings → morale 90% on tax → 940g\/round to treasuries/);
  assert.match(
    lines[1],
    /Upkeep: troops 0g \+ 0 food\/wk \(hero purse; larder first, then your own settlements' food while standing on one\) · buildings 1 wood \+ 1 stone\/wk · food 4\/10 → morale −6\/round/,
  );
  assert.match(lines[2], /40g building gold is morale-stable and counted in both Empire Income \(940g\) and next-turn gold \(1040g\)/);
  assert.match(lines[3], /^Wealth: 0g — 0g on heroes \+ 0g in settlement treasuries$/);
});

test("hud: the wealth tooltip line splits the hero purse from the settlement treasuries", () => {
  const state = makeState({
    settlements: [makeSettlement("s0", 0, 2, 2, { population: 1000, goldTax: 1, gold: 300 })],
    heroes: [makeHero("h0", 0, 2, 2, { gold: 120 })],
  });
  const h = render(state);
  assert.equal(h.wealth.textContent, "420");
  assert.match(h.root.title, /Wealth: 420g — 120g on heroes \+ 300g in settlement treasuries/);
});

test("hud: stable morale reads as stable instead of a negative decay", () => {
  const state = makeState({
    settlements: [makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 2, morale: 100, warehouse: emptyWarehouse({ food: 10, wood: 5, stone: 5 }) })],
  });
  const { title } = render(state).root;
  assert.match(title, /food 10\/5 → morale stable/);
});

test("hud: no owned settlements degrades to a plain explanation", () => {
  const state = makeState({ settlements: [makeSettlement("s1", 1, 18, 4)] });
  const h = render(state);
  assert.equal(h.income.textContent, "0");
  assert.equal(h.population.textContent, "0");
  assert.equal(h.morale.textContent, "n/a");
  assert.equal(
    h.root.title,
    "Empire Income: 0g — you own no settlements.\n" +
      "Upkeep: troops 0g + 0 food/wk (hero purse; larder first, then your own settlements' food while standing on one)\n" +
      "Wealth: 0g — 0g on heroes + 0g in settlement treasuries",
  );
});

// ── C-POLISH-3: the INCOME pill must be a function of the loaded state ──
//
// A playthrough reported the HUD's INCOME "moving 40g with no intervening
// command" (3540 -> 3500 after selecting a hero). It was not a recomputation
// artefact: 3540 was the client's boot/starter world (500x1 + 1500x2 pop-tax
// plus a district market's 40g) and 3500 was the game the player then created
// (the same two seats, whose district holds a granary and a house instead).
// The two renders below pin both halves of that: the pill cannot drift while
// the state stands still, and the 40g really does belong to a building in the
// state, so any future move of that number is attributable to the state.

const SEAT_TAX_TOTAL = 500 * 1 + 1500 * 2;

function twoSeatState(overrides: Parameters<typeof makeState>[0] = {}) {
  return makeState({
    settlements: [
      makeSettlement("castle-1-11-8", 0, 11, 8, { population: 500, goldTax: 1 }),
      makeSettlement("castle-2-18-13", 0, 18, 13, { population: 1500, goldTax: 2 }),
    ],
    heroes: [makeHero("p0-hero", 0, 11, 8)],
    ...overrides,
  });
}

test("hud: two consecutive renders with no command in between are identical, and match the engine's income", () => {
  const state = twoSeatState();
  const first = render(state);
  const second = render(state);
  assert.equal(first.income.textContent, String(SEAT_TAX_TOTAL));
  assert.equal(second.income.textContent, first.income.textContent, "an idle state must not move the income pill");

  // Same world, different object (the reducer's normal shape): still the same
  // figure, i.e. the pill reads the state and not a hidden accumulator.
  const copy = JSON.parse(JSON.stringify(state)) as ReturnType<typeof makeState>;
  assert.equal(render(copy).income.textContent, first.income.textContent);
  assert.equal(
    first.income.textContent,
    String(playerEffectiveSettlementIncome(state, 0)),
    "the pill is the engine's own figure for the loaded state",
  );
});

test("hud: the pill is the empire total, so it never equals one settlement's own Income/turn row", () => {
  const state = twoSeatState();
  const h = render(state);
  const ownRow = effectiveSettlementIncome(state.settlements["castle-1-11-8"], state.heroes);
  assert.equal(h.income.textContent, String(SEAT_TAX_TOTAL));
  assert.equal(ownRow, 500, "the settlement panel's Income/turn row is that settlement alone");
  assert.notEqual(h.income.textContent, String(ownRow), "the HUD sums every owned settlement");
});

test("hud: the 40g a district market adds is the state's, and the pill follows it", () => {
  const market = buildingSettlementEffects("market", 1).goldPerTurn;
  const withMarket = twoSeatState({
    settlements: [
      makeSettlement("castle-1-11-8", 0, 11, 8, { population: 500, goldTax: 1 }),
      {
        ...makeSettlement("castle-2-18-13", 0, 18, 13, { population: 1500, goldTax: 2 }),
        districts: { "18,12": { q: 18, r: 12, citySpots: [], buildings: [{ gx: 0, gy: 0, kind: "market", level: 1, style: "classic" }] } },
      },
    ],
  });
  const plain = render(twoSeatState());
  const district = render(withMarket);
  assert.equal(Number(district.income.textContent) - Number(plain.income.textContent), market);
  assert.equal(district.income.textContent, String(SEAT_TAX_TOTAL + market));
});

test("hud: a round advance re-reads the state, so a real income change does show", () => {
  const before = render(twoSeatState());
  const after = render(twoSeatState({ round: 2, day: 1, selectedHeroId: "p0-hero" }));
  assert.equal(after.income.textContent, before.income.textContent, "moving the selection is not an economy change");

  const taxed = render(
    twoSeatState({
      round: 2,
      settlements: [
        makeSettlement("castle-1-11-8", 0, 11, 8, { population: 500, goldTax: 2 }),
        makeSettlement("castle-2-18-13", 0, 18, 13, { population: 1500, goldTax: 2 }),
      ],
    }),
  );
  assert.equal(taxed.income.textContent, String(500 * 2 + 1500 * 2), "a real tax change is reported");
});
