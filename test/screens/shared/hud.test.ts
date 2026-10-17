import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "@heroes/contracts";
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
    "Empire Income: 0g — you own no settlements.\nWealth: 0g — 0g on heroes + 0g in settlement treasuries",
  );
});
