import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHeroVerdict, nearestOwnedSettlement, relocateHeroToSettlement } from "@heroes/engine";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

test("deriveHeroVerdict truth table", () => {
  assert.equal(deriveHeroVerdict("lost_all_troops"), "defeated");
  assert.equal(deriveHeroVerdict("retreated_hero", "surrender"), "surrendered");
  assert.equal(deriveHeroVerdict("retreated_hero"), "retreated");
  assert.equal(deriveHeroVerdict("retreated_hero", "retreat"), "retreated");
  assert.equal(deriveHeroVerdict("won"), "stood");
  assert.equal(deriveHeroVerdict("survived"), "stood");
});

test("deriveHeroVerdict: retreated_self follows the same concession split", () => {
  assert.equal(deriveHeroVerdict("retreated_self", "surrender"), "surrendered");
  assert.equal(deriveHeroVerdict("retreated_self"), "retreated");
});

test("deriveHeroVerdict: a concession never upgrades a won/survived side", () => {
  assert.equal(deriveHeroVerdict("won", "surrender"), "stood");
  assert.equal(deriveHeroVerdict("survived", "retreat"), "stood");
});

test("nearestOwnedSettlement picks the closest owned settlement", () => {
  const state = makeState({
    settlements: [
      makeSettlement("far", 0, 5, 0),
      makeSettlement("near", 0, 2, 0),
      makeSettlement("enemy", 1, 1, 0),
    ],
  });

  const nearest = nearestOwnedSettlement(state, { q: 0, r: 0, ownerId: 0 });
  assert.equal(nearest?.id, "near");
});

test("nearestOwnedSettlement returns null when the owner holds nothing", () => {
  const state = makeState({
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 1, 0)],
  });

  assert.equal(nearestOwnedSettlement(state, { q: 1, r: 0, ownerId: 2 }), null);
});

test("nearestOwnedSettlement ignores other owners' settlements entirely", () => {
  const state = makeState({
    settlements: [makeSettlement("enemyNear", 1, 1, 0), makeSettlement("mineFar", 0, 6, 0)],
  });

  const nearest = nearestOwnedSettlement(state, { q: 0, r: 0, ownerId: 0 });
  assert.equal(nearest?.id, "mineFar");
});

test("nearestOwnedSettlement on a tie returns one of the tied settlements", () => {
  const state = makeState({
    settlements: [makeSettlement("a", 0, 2, 0), makeSettlement("b", 0, -2, 0)],
  });

  const nearest = nearestOwnedSettlement(state, { q: 0, r: 0, ownerId: 0 });
  assert.ok(nearest?.id === "a" || nearest?.id === "b");
});

function retreatHero(): ReturnType<typeof makeHero> {
  return makeHero("h0", 0, 10, 10, {
    movementRemaining: 2,
    stacks: [{ entries: [{ unitTypeId: "spearman", count: 3 }] }],
  });
}

test("relocateHeroToSettlement moves the hero to the settlement tile", () => {
  const hero = retreatHero();
  const moved = relocateHeroToSettlement(hero, { q: 4, r: 2 });

  assert.equal(moved.q, 4);
  assert.equal(moved.r, 2);
});

test("relocateHeroToSettlement nulls the previous-move bookkeeping", () => {
  const hero = { ...retreatHero(), previousQ: 9, previousR: 10, previousMovementRemaining: 5 };
  const moved = relocateHeroToSettlement(hero, { q: 4, r: 2 });

  assert.equal(moved.previousQ, null);
  assert.equal(moved.previousR, null);
  assert.equal(moved.previousMovementRemaining, null);
});

test("relocateHeroToSettlement seeds the trail at the settlement and refills movement", () => {
  const hero = retreatHero();
  const moved = relocateHeroToSettlement(hero, { q: 4, r: 2 });

  assert.deepEqual(moved.trail, [{ q: 4, r: 2 }]);
  assert.equal(moved.movementRemaining, MOVEMENT_PER_TURN);
});

test("relocateHeroToSettlement preserves stacks and mutates nothing", () => {
  const hero = retreatHero();
  const before = JSON.stringify(hero);
  const moved = relocateHeroToSettlement(hero, { q: 4, r: 2 });

  assert.deepEqual(moved.stacks, hero.stacks);
  assert.deepEqual(moved.troops, hero.troops);
  assert.equal(JSON.stringify(hero), before);
  assert.notEqual(moved, hero);
});
