import { test } from "node:test";
import assert from "node:assert/strict";
import { ARMY_STACK_SLOTS, settlementStacks, transferUnits } from "@heroes/engine";
import type { GameState, Platoon } from "@heroes/contracts";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

function platoons(entriesList: { unitTypeId: string; count: number }[][]): Platoon[] {
  const out = entriesList.map((entries) => ({ entries }));
  while (out.length < ARMY_STACK_SLOTS) out.push({ entries: [] });
  return out;
}

function transferState(
  opts: {
    heroStacks?: Platoon[];
    garrisonStacks?: Platoon[];
    heroQ?: number;
    heroR?: number;
    settlementOwnerId?: number | null;
  } = {},
): GameState {
  const settlement = {
    ...makeSettlement("s0", opts.settlementOwnerId ?? 0, 5, 5, { gold: 100 }),
    ...(opts.garrisonStacks ? { stacks: opts.garrisonStacks } : {}),
  };
  const hero = makeHero("h0", 0, opts.heroQ ?? 5, opts.heroR ?? 5, { stacks: opts.heroStacks ?? [] });
  return makeState({ settlements: [settlement], heroes: [hero] });
}

function move(opts: { direction: "toHero" | "toGarrison"; unitTypeId: string; count: number; toSlot?: number }) {
  return { heroId: "h0" as const, settlementId: "s0" as const, ...opts };
}

test("transferUnits toHero: default slot deposits into the hero's first platoon and empties the garrison", () => {
  const state = transferState({ garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }] });
  const result = transferUnits(state, move({ direction: "toHero", unitTypeId: "swordsman", count: 5 }));
  assert.equal(result.ok, true);
  assert.equal(result.state.dirty, true);
  const hero = result.state.heroes.h0;
  assert.equal(hero.stacks.length, ARMY_STACK_SLOTS);
  assert.deepEqual(hero.stacks[0].entries, [{ unitTypeId: "swordsman", count: 5 }]);
  assert.deepEqual(
    settlementStacks(result.state.settlements.s0).map((p) => p.entries),
    Array.from({ length: ARMY_STACK_SLOTS }, () => []),
    "garrison emptied by the transfer",
  );
});

test("transferUnits toHero: an explicit toSlot merges into an existing same-type entry", () => {
  const state = transferState({
    heroStacks: platoons([[], [], [{ unitTypeId: "swordsman", count: 3 }]]),
    garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }],
  });
  const result = transferUnits(state, move({ direction: "toHero", unitTypeId: "swordsman", count: 2, toSlot: 2 }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.heroes.h0.stacks[2].entries, [{ unitTypeId: "swordsman", count: 5 }]);
  assert.deepEqual(settlementStacks(result.state.settlements.s0)[0].entries, [{ unitTypeId: "swordsman", count: 3 }]);
});

test("transferUnits toHero: a toSlot carrying 3 distinct types is platoon_full; out-of-range slots are invalid_slot", () => {
  const fullEntries = [
    { unitTypeId: "pikeman", count: 1 },
    { unitTypeId: "archer", count: 1 },
    { unitTypeId: "mage", count: 1 },
  ];
  const state = transferState({
    heroStacks: platoons([[], fullEntries]),
    garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }],
  });

  const full = transferUnits(state, move({ direction: "toHero", unitTypeId: "swordsman", count: 1, toSlot: 1 }));
  assert.equal(full.ok, false);
  assert.equal(full.reason, "platoon_full");
  assert.deepEqual(full.state.heroes.h0.stacks[1].entries, fullEntries, "the full platoon is untouched");
  assert.deepEqual(settlementStacks(full.state.settlements.s0)[0].entries, [{ unitTypeId: "swordsman", count: 5 }]);

  for (const toSlot of [9, -1, 1.5]) {
    const bad = transferUnits(state, move({ direction: "toHero", unitTypeId: "swordsman", count: 1, toSlot }));
    assert.equal(bad.ok, false, `toSlot ${toSlot} must be refused`);
    assert.equal(bad.reason, "invalid_slot");
  }
});

test("transferUnits: refuses a hero away from the settlement tile and a foreign settlement", () => {
  const garrisonStacks = [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }];
  const away = transferUnits(
    transferState({ heroQ: 2, heroR: 2, garrisonStacks }),
    move({ direction: "toHero", unitTypeId: "swordsman", count: 1 }),
  );
  assert.equal(away.ok, false);
  assert.equal(away.reason, "hero_not_at_settlement");

  const foreign = transferUnits(
    transferState({ settlementOwnerId: 1, garrisonStacks }),
    move({ direction: "toHero", unitTypeId: "swordsman", count: 1 }),
  );
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, "not_owned_settlement");
});

test("transferUnits toGarrison: removes from the topmost slot first and lands in the garrison", () => {
  const state = transferState({
    heroStacks: platoons([
      [{ unitTypeId: "swordsman", count: 4 }],
      [],
      [],
      [],
      [],
      [{ unitTypeId: "swordsman", count: 3 }, { unitTypeId: "archer", count: 2 }],
    ]),
  });
  const result = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 6 }));
  assert.equal(result.ok, true);
  assert.equal(result.state.dirty, true);
  const hero = result.state.heroes.h0;
  assert.deepEqual(hero.stacks[0].entries, [{ unitTypeId: "swordsman", count: 1 }], "slot 5 drained first, slot 0 keeps 1");
  assert.deepEqual(hero.stacks[5].entries, [{ unitTypeId: "archer", count: 2 }]);
  assert.deepEqual(settlementStacks(result.state.settlements.s0)[0].entries, [{ unitTypeId: "swordsman", count: 6 }]);
});

test("transferUnits toGarrison: merges into an existing same-type garrison entry", () => {
  const state = transferState({
    heroStacks: platoons([[{ unitTypeId: "swordsman", count: 3 }]]),
    garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 2 }] }],
  });
  const result = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 3 }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.heroes.h0.stacks[0].entries, []);
  assert.deepEqual(settlementStacks(result.state.settlements.s0)[0].entries, [{ unitTypeId: "swordsman", count: 5 }]);
});

test("transferUnits: a count above the source pool is refused in both directions", () => {
  const garrisonSide = transferState({ garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 2 }] }] });
  const toHero = transferUnits(garrisonSide, move({ direction: "toHero", unitTypeId: "swordsman", count: 3 }));
  assert.equal(toHero.ok, false);
  assert.equal(toHero.reason, "not_enough_units");

  const heroSide = transferState({ heroStacks: platoons([[{ unitTypeId: "swordsman", count: 4 }]]) });
  const toGarrison = transferUnits(heroSide, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 6 }));
  assert.equal(toGarrison.ok, false);
  assert.equal(toGarrison.reason, "not_enough_units");
});
