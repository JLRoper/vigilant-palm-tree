import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlatoons, platoonPower, unitPower, type UnitType } from "@heroes/engine";

const catalog: Record<string, UnitType> = {
  militia: { id: "militia", name: "Militia", attack: 1, defence: 1, health: 3, speed: 3, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 1 },
  griffin: { id: "griffin", name: "Griffin", attack: 8, defence: 6, health: 18, speed: 6, description: "", advantageType: "monster", specialty: "", specialtyPriority: 1 },
};

test("unitPower: a catalog unit weighs attack + defence", () => {
  assert.equal(unitPower(catalog.militia), 2);
  assert.equal(unitPower(catalog.griffin), 14);
});

test("unitPower: an unknown unit falls back to the tier-1 helper convention (1 + 1)", () => {
  assert.equal(unitPower(undefined), 2);
  assert.equal(unitPower({ ...catalog.militia, id: "ghost" }), 2);
});

test("platoonPower: empty stacks are 0, and an absent roster is 0", () => {
  assert.equal(platoonPower([], catalog), 0);
  assert.equal(platoonPower(normalizePlatoons([]), catalog), 0);
});

test("platoonPower: zero-count entries contribute nothing", () => {
  const platoons = normalizePlatoons([
    { entries: [{ unitTypeId: "militia", count: 0 }, { unitTypeId: "griffin", count: 0 }] },
  ]);
  assert.equal(platoonPower(platoons, catalog), 0);
});

test("platoonPower: mixed units sum count x (attack + defence) across platoons", () => {
  const platoons = normalizePlatoons([
    { entries: [{ unitTypeId: "militia", count: 3 }] },
    { entries: [] },
    { entries: [{ unitTypeId: "griffin", count: 2 }] },
  ]);
  assert.equal(platoonPower(platoons, catalog), 3 * 2 + 2 * 14);
});

test("platoonPower: a multi-unit entry weighs each unit by its own stats", () => {
  const platoons = normalizePlatoons([
    { entries: [{ unitTypeId: "militia", count: 1 }, { unitTypeId: "griffin", count: 1 }] },
  ]);
  assert.equal(platoonPower(platoons, catalog), 16);
});

test("platoonPower: unknown ids weigh like baseline troops, so a ratio gate on power degrades to troop counts", () => {
  const attackers = normalizePlatoons([{ entries: [{ unitTypeId: "ghost", count: 15 }] }]);
  const garrison = normalizePlatoons([{ entries: [{ unitTypeId: "phantom", count: 10 }] }]);
  assert.equal(platoonPower(attackers, {}), 30);
  assert.equal(platoonPower(garrison, {}), 20);
  assert.equal(platoonPower(attackers, {}) >= 1.5 * platoonPower(garrison, {}), true);
});
