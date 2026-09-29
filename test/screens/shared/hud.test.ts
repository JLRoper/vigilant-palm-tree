import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "@heroes/contracts";
import { updateHud, type PathCostReadout } from "../../../src/screens/shared/hud";
import { emptyWarehouse, makeHero, makeSettlement, makeState } from "../../charter/_helpers";

function render(state: ReturnType<typeof makeState>, readout: PathCostReadout | null = null) {
  const span = { textContent: "", title: "" } as unknown as HTMLSpanElement;
  updateHud({} as HTMLElement, state, null, { textSpan: span }, 0, readout);
  return { text: span.textContent, title: span.title };
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

test("hud: a reachable path preview appends the cost against max movement", () => {
  const { text } = render(economyState(), { costToSplit: 4.6, totalCost: 9.8, destinationReachable: true });
  assert.match(text, /· Path 4\.6\/7/);
});

test("hud: a clamped path preview appends the reachable share of the total cost", () => {
  const { text } = render(economyState(), { costToSplit: 4.6, totalCost: 9.8, destinationReachable: false });
  assert.match(text, /· Path 4\.6 of 9\.8/);
});

test("hud: no path preview means no Path segment", () => {
  const { text } = render(economyState(), null);
  assert.doesNotMatch(text, /· Path/);
  assert.match(text, /Movement:/);
});

test("hud: economy breakdown title explains income scaling, upkeep, and the next-turn gold inconsistency", () => {
  const { title } = render(economyState());
  const lines = title.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Income: settlements 1000g gross → morale 90% → 900g\/round to treasuries/);
  assert.match(lines[1], /Upkeep: troops 0g \+ 0 food\/wk \(hero purse & packs\) · buildings 1 wood \+ 1 stone\/wk · food 4\/10 → morale −6\/round/);
  assert.match(lines[2], /Building gold\/turn \+40g counts toward next-turn gold \(1040g\), not "Empire Income"/);
});

test("hud: stable morale reads as stable instead of a negative decay", () => {
  const state = makeState({
    settlements: [makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 2, morale: 100, warehouse: emptyWarehouse({ food: 10, wood: 5, stone: 5 }) })],
  });
  const { title } = render(state);
  assert.match(title, /food 10\/5 → morale stable/);
});

test("hud: no owned settlements degrades to a plain explanation", () => {
  const state = makeState({ settlements: [makeSettlement("s1", 1, 18, 4)] });
  const { title } = render(state);
  assert.equal(title, "Empire Income: 0g — you own no settlements.");
});
