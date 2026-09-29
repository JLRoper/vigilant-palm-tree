import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHeroUpkeep } from "@heroes/engine";
import { makeHero } from "../charter/_helpers";

test("upkeep charges gold and cargo food based on the stacks total, not the stale troops scalar", () => {
  const hero = {
    ...makeHero("h0", 0, 2, 2, {
      troops: 1,
      gold: 300,
      stacks: [
        { entries: [{ unitTypeId: "swordsman", count: 12 }] },
        { entries: [{ unitTypeId: "archer", count: 8 }] },
        { entries: [{ unitTypeId: "cavalry", count: 4 }] },
      ],
    }),
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 },
  };
  const [after] = Object.values(applyHeroUpkeep({ h0: hero }));
  assert.equal(after.gold, 300 - 24);
  assert.equal(after.troops, 24);
  assert.equal(after.resources?.food, 100 - 24);
});

test("unpaid upkeep deserts units from the last stacks first and zeroes the purse", () => {
  const hero = makeHero("h0", 0, 2, 2, {
    troops: 24,
    gold: 3,
    stacks: [
      { entries: [{ unitTypeId: "swordsman", count: 12 }] },
      { entries: [{ unitTypeId: "archer", count: 8 }] },
      { entries: [{ unitTypeId: "cavalry", count: 4 }] },
    ],
  });
  const [after] = Object.values(applyHeroUpkeep({ h0: hero }));
  assert.equal(after.gold, 0);
  assert.equal(after.troops, 3);
  assert.deepEqual(
    after.stacks.map((p) => p.entries),
    [[{ unitTypeId: "swordsman", count: 3 }], [], []],
  );
});

test("a hero without cargo food pays no food and keeps its resources untouched", () => {
  const hero = makeHero("h0", 0, 2, 2, {
    troops: 12,
    gold: 50,
    stacks: [{ entries: [{ unitTypeId: "swordsman", count: 12 }] }],
  });
  const [after] = Object.values(applyHeroUpkeep({ h0: hero }));
  assert.equal(after.gold, 38);
  assert.equal(after.resources?.food ?? 0, 0);
});
