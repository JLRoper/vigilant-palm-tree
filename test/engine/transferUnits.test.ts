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
    heroStacks: platoons([[{ unitTypeId: "swordsman", count: 4 }]]),
    garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 2 }] }],
  });
  const result = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 3 }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.heroes.h0.stacks[0].entries, [{ unitTypeId: "swordsman", count: 1 }]);
  assert.deepEqual(settlementStacks(result.state.settlements.s0)[0].entries, [{ unitTypeId: "swordsman", count: 5 }]);
});

test("transferUnits toGarrison: unloading the hero's whole army is refused", () => {
  // A garrison can be emptied; a hero cannot. The last troop stays with the
  // hero, so the transfer moves nothing at all.
  const state = transferState({
    heroStacks: platoons([[{ unitTypeId: "swordsman", count: 3 }]]),
    garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 2 }] }],
  });
  const whole = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 3 }));
  assert.equal(whole.ok, false);
  assert.equal(whole.reason, "would_be_left_without_troops");
  assert.equal(whole.state, state, "a refused transfer moves nothing");

  // ...and the same transfer of all BUT the last troop still lands.
  const almost = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 2 }));
  assert.equal(almost.ok, true);
  assert.deepEqual(almost.state.heroes.h0.stacks[0].entries, [{ unitTypeId: "swordsman", count: 1 }]);
  assert.deepEqual(settlementStacks(almost.state.settlements.s0)[0].entries, [{ unitTypeId: "swordsman", count: 4 }]);

  // A hero whose LAST troop is a different type is protected the same way: the
  // first step may take the swordsmen while the archer holds the army, and the
  // second step -- the one that would leave nothing -- is refused.
  const mixed = transferState({
    heroStacks: platoons([[{ unitTypeId: "swordsman", count: 2 }, { unitTypeId: "archer", count: 1 }]]),
  });
  const takeSwordsmen = transferUnits(mixed, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 2 }));
  assert.equal(takeSwordsmen.ok, true, "the archer still holds the army");
  const takeLastArcher = transferUnits(
    takeSwordsmen.state,
    move({ direction: "toGarrison", unitTypeId: "archer", count: 1 }),
  );
  assert.equal(takeLastArcher.ok, false);
  assert.equal(takeLastArcher.reason, "would_be_left_without_troops");
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

// The garrison grid's drag-and-drop: a dropped tile names the receiving slot,
// in BOTH directions (toHero always could; toGarrison gained toSlot with the
// garrison grid).

test("transferUnits toGarrison with toSlot: deposits into the named garrison slot", () => {
  const state = transferState({
    heroStacks: platoons([[{ unitTypeId: "swordsman", count: 5 }]]),
    garrisonStacks: [
      { entries: [{ unitTypeId: "peasant", count: 2 }] },
      { entries: [{ unitTypeId: "archer", count: 1 }] },
    ],
  });
  const result = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 4, toSlot: 5 }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.heroes.h0.stacks[0].entries, [{ unitTypeId: "swordsman", count: 1 }]);
  const garrison = settlementStacks(result.state.settlements.s0);
  assert.deepEqual(garrison[5].entries, [{ unitTypeId: "swordsman", count: 4 }], "landed in slot 5");
  assert.deepEqual(garrison[0].entries, [{ unitTypeId: "peasant", count: 2 }], "other slots untouched");
  assert.deepEqual(garrison[1].entries, [{ unitTypeId: "archer", count: 1 }]);
});

test("transferUnits toGarrison with toSlot: merges a same-type entry in that slot only", () => {
  const state = transferState({
    heroStacks: platoons([[{ unitTypeId: "swordsman", count: 4 }]]),
    garrisonStacks: [
      { entries: [{ unitTypeId: "swordsman", count: 1 }] },
      { entries: [{ unitTypeId: "swordsman", count: 7 }] },
    ],
  });
  const result = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 3, toSlot: 0 }));
  assert.equal(result.ok, true);
  const garrison = settlementStacks(result.state.settlements.s0);
  assert.deepEqual(garrison[0].entries, [{ unitTypeId: "swordsman", count: 4 }]);
  assert.deepEqual(garrison[1].entries, [{ unitTypeId: "swordsman", count: 7 }], "the other slot keeps its count");
});

test("transferUnits toGarrison with toSlot: a full target platoon is refused and the hero keeps its troops", () => {
  const full = [
    { unitTypeId: "peasant", count: 1 },
    { unitTypeId: "archer", count: 1 },
    { unitTypeId: "cavalry", count: 1 },
  ];
  const state = transferState({
    heroStacks: platoons([[{ unitTypeId: "swordsman", count: 2 }]]),
    garrisonStacks: [{ entries: full }],
  });
  const result = transferUnits(state, move({ direction: "toGarrison", unitTypeId: "swordsman", count: 2, toSlot: 0 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "platoon_full");
  assert.deepEqual(settlementStacks(state.settlements.s0)[0].entries, full, "state untouched");
});

test("transferUnits with an out-of-range toSlot is refused in both directions", () => {
  const toGarrison = transferUnits(
    transferState({ heroStacks: platoons([[{ unitTypeId: "swordsman", count: 1 }]]) }),
    move({ direction: "toGarrison", unitTypeId: "swordsman", count: 1, toSlot: ARMY_STACK_SLOTS }),
  );
  assert.equal(toGarrison.ok, false);
  assert.equal(toGarrison.reason, "invalid_slot");

  const toHero = transferUnits(
    transferState({ garrisonStacks: [{ entries: [{ unitTypeId: "swordsman", count: 1 }] }] }),
    move({ direction: "toHero", unitTypeId: "swordsman", count: 1, toSlot: -1 }),
  );
  assert.equal(toHero.ok, false);
  assert.equal(toHero.reason, "invalid_slot");
});
