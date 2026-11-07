import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "@heroes/contracts";
import {
  applyEndOfTurnDetailed,
  buildingSettlementEffects,
  playerEffectiveSettlementIncome,
  projectedSettlementIncome,
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
  // This fixture's settlement is SHORT of food (4 of 10), so the next day tick
  // decays its morale 90 -> 84 before it pays the tax: 1,000 pop-tax x 0.84 =
  // 840, plus the market's 40g. Ledger #9's disagreement, measured: the pill is
  // what the tick will credit, not what the current morale would pay.
  assert.equal(h.income.textContent, "880");
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

// The toolbar is the panel's sibling: it renders the SAME movement price through
// the same ONE rule (`formatMoveCost`). Before it, the toolbar used a bare
// `.toFixed(1)`, so a whole-point price read "Path 6.0/7" while the movement pill
// beside it read "Movement 7/7"; and a roaded forest's 1.2 * 0.75 arrived as
// 0.8999999999999999, which `.toFixed(1)` happened to hide only because it had
// been written to round. Both halves are pinned here so neither can drift.
test("hud: the path readout renders a whole-point price whole, like the movement pill beside it", () => {
  const h = render(economyState(), { costToSplit: 6, totalCost: 6, destinationReachable: true });
  assert.match(h.context.textContent ?? "", /Movement 7\/7 · Path 6\/7/);
});

test("hud: the path readout renders a roaded hex's discounted price as one exact decimal", () => {
  const roadedForest = 1.2 * 0.75;
  const h = render(economyState(), { costToSplit: roadedForest, totalCost: roadedForest, destinationReachable: true });
  assert.match(h.context.textContent ?? "", /Movement 7\/7 · Path 0\.9\/7/);
  assert.doesNotMatch(h.context.textContent ?? "", /0\.8999999/);
});

test("hud: last saved rides the context segment (the smoke suite reads #hud for it)", () => {
  const h = render(economyState(), null, "2026-10-11T12:00:00Z");
  assert.match(h.context.textContent ?? "", /^Movement 7\/7 · Last saved /);
});

test("hud: economy breakdown title explains income scaling, upkeep, and the next-turn gold inconsistency", () => {
  const { title } = render(economyState()).root;
  const lines = title.split("\n");
  assert.equal(lines.length, 4);
  assert.match(
    lines[0],
    /Income: settlements 1000g pop-tax \+ 40g buildings → 880g\/round to treasuries \(the tax is paid at the morale this turn's step leaves behind/,
  );
  assert.match(
    lines[1],
    /Upkeep: troops 0g \+ 0 food\/wk \(hero purse; larder first, then your own settlements' food while standing on one\) · buildings 1 wood \+ 1 stone\/wk · food 4\/10 → morale −6\/round/,
  );
  assert.match(lines[2], /40g building gold is morale-stable and counted in both Empire Income \(880g\) and next-turn gold \(1040g\)/);
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
  // Fed settlements (a stocked larder): this fixture is about the pill reading
  // the LOADED state, and a settlement with no food at all is a starving one
  // whose next-day projection is legitimately below its pop-tax. The projection
  // that applies the tick's morale step is pinned separately below.
  const fed = () => emptyWarehouse({ food: 100, wood: 50, stone: 50 });
  return makeState({
    settlements: [
      makeSettlement("castle-1-11-8", 0, 11, 8, { population: 500, goldTax: 1, warehouse: fed() }),
      makeSettlement("castle-2-18-13", 0, 18, 13, { population: 1500, goldTax: 2, warehouse: fed() }),
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
  // The panel's row is the SAME projection for one settlement (they cannot
  // disagree); the pill is the sum across the seat.
  const ownRow = projectedSettlementIncome(state, state.settlements["castle-1-11-8"]);
  assert.equal(h.income.textContent, String(SEAT_TAX_TOTAL));
  assert.equal(ownRow, 500, "the settlement panel's Income/turn row is that settlement alone");
  assert.notEqual(h.income.textContent, String(ownRow), "the HUD sums every owned settlement");
});

test("hud: the 40g a district market adds is the state's, and the pill follows it", () => {
  const market = buildingSettlementEffects("market", 1).goldPerTurn;
  const fed = () => emptyWarehouse({ food: 100, wood: 50, stone: 50 });
  const withMarket = twoSeatState({
    settlements: [
      makeSettlement("castle-1-11-8", 0, 11, 8, { population: 500, goldTax: 1, warehouse: fed() }),
      {
        ...makeSettlement("castle-2-18-13", 0, 18, 13, { population: 1500, goldTax: 2, warehouse: fed() }),
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

  const fed = () => emptyWarehouse({ food: 100, wood: 50, stone: 50 });
  const taxed = render(
    twoSeatState({
      round: 2,
      settlements: [
        makeSettlement("castle-1-11-8", 0, 11, 8, { population: 500, goldTax: 2, warehouse: fed() }),
        makeSettlement("castle-2-18-13", 0, 18, 13, { population: 1500, goldTax: 2, warehouse: fed() }),
      ],
    }),
  );
  assert.equal(taxed.income.textContent, String(500 * 2 + 1500 * 2), "a real tax change is reported");
});

// ── Ledger #9, measured: the pill is the CREDIT, not one morale step of it ──
//
// The ledger's four playthrough passes all saw the HUD's INCOME disagree with
// the gold a settlement was actually credited, by exactly the morale step the
// day tick takes before it pays the tax. These two runs run the ENGINE's own
// payment pass over the fixture and compare it with the pill, so the claim is
// measured rather than argued.

test("hud: the INCOME pill equals what the next End Turn actually credits (a starving settlement)", () => {
  // popTax 500 at morale 100, short of food: the tick decays to 90 first, so it
  // pays 450. Population is under 100, so the daily wage is 0 and the whole gold
  // delta IS the income half.
  const state = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        population: 50,
        goldTax: 10,
        morale: 100,
        warehouse: emptyWarehouse({ food: 0 }),
      }),
    ],
    heroes: [makeHero("h0", 0, 2, 2)],
  });
  const before = state.settlements["s0"].gold;
  const after = applyEndOfTurnDetailed(state).state.settlements["s0"];
  const credited = after.gold - before;
  assert.equal(credited, 450, "the tick pays the tax at the morale its own step leaves behind");
  assert.equal(
    render(state).income.textContent,
    String(credited),
    "the pill must be the credit, not one morale step of it",
  );
});

test("hud: …and the projection produces FIRST, so a farm-fed settlement is not projected a decay it never takes", () => {
  // The larder is empty AT THE MOMENT OF READING, but the settlement's own food
  // rate covers its mouths on the tick (production runs before the morale step),
  // so the tick is fully supplied and pays the pop-tax in full. A projection
  // that skipped production would invent a 10-point decay and read 450.
  const state = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        population: 50,
        goldTax: 10,
        morale: 100,
        resourceRates: { food: 1 },
        warehouse: emptyWarehouse({ food: 0 }),
      }),
    ],
    heroes: [makeHero("h0", 0, 2, 2)],
  });
  const before = state.settlements["s0"].gold;
  const after = applyEndOfTurnDetailed(state).state.settlements["s0"];
  // Wage is 0 at population 50, so the whole delta is the income half again.
  assert.equal(after.gold - before, 500, "the tick produced its own food, so morale held and the tax paid in full");
  assert.equal(
    render(state).income.textContent,
    String(after.gold - before),
    "the projection must not read the pre-production larder as a deficit",
  );
});
