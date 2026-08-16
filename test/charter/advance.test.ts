import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceCharters, CHARTER_SETTLEMENT_POPULATION } from "@heroes/engine";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import { makeCharter, makeHero, makeState } from "./_helpers";

test("CHARTER_SETTLEMENT_POPULATION matches the documented seed value", () => {
  assert.equal(CHARTER_SETTLEMENT_POPULATION, 50);
});

test("advanceCharters is a no-op (same state reference) when there are no active charters", () => {
  const s = makeState({ activeCharters: [] });
  const next = advanceCharters(s);
  assert.equal(next, s);
});

test("advanceCharters ignores charters still in the traveling phase", () => {
  const s = makeState({
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, phase: "traveling", daysRemaining: 5 })],
  });
  const next = advanceCharters(s);
  assert.equal(next, s);
  assert.equal(next.activeCharters[0].daysRemaining, 5);
});

test("advanceCharters decrements daysRemaining for a constructing charter that isn't finished", () => {
  const s = makeState({
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, phase: "constructing", daysRemaining: 3 })],
  });
  const next = advanceCharters(s);
  assert.equal(next.activeCharters.length, 1);
  assert.equal(next.activeCharters[0].daysRemaining, 2);
  assert.equal(next.activeCharters[0].phase, "constructing");
  assert.equal(Object.keys(next.settlements).length, Object.keys(s.settlements).length, "no settlement created yet");
});

test("advanceCharters completes a charter whose daysRemaining reaches 0: creates the settlement", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" }), makeHero("h1", 1, 18, 4)],
    activeCharters: [
      makeCharter({
        id: "c0",
        heroId: "h0",
        ownerId: 0,
        phase: "constructing",
        daysRemaining: 1,
        targetQ: 15,
        targetR: 15,
        settlementName: "Newhaven",
        settlementId: "s-new",
        resourceRates: { wood: 3 },
        foundedOnResource: "wood",
        citySpots: [{ cell: { x: 1, y: 1 }, resource: "wood", vein: "small" }],
      }),
    ],
  });
  const next = advanceCharters(s);
  assert.equal(next.activeCharters.length, 0, "completed charter is removed from activeCharters");
  const created = next.settlements["s-new"];
  assert.ok(created, "new settlement was created");
  assert.equal(created.name, "Newhaven");
  assert.equal(created.ownerId, 0);
  assert.equal(created.q, 15);
  assert.equal(created.r, 15);
  assert.equal(created.level, 1);
  assert.equal(created.population, CHARTER_SETTLEMENT_POPULATION);
  assert.equal(created.gold, 0);
  assert.deepEqual(created.warehouse, { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 });
  assert.deepEqual(created.resourceRates, { wood: 3 });
  assert.equal(created.foundedOnResource, "wood");
  assert.deepEqual(created.citySpots, [{ cell: { x: 1, y: 1 }, resource: "wood", vein: "small" }]);
  assert.equal(created.morale, 50);
  assert.equal(created.autoTrade, false);
  assert.deepEqual(created.buildings, []);
  assert.equal(next.dirty, true);
});

test("advanceCharters resets the founding hero and adds the settlement to the owner's roster", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0", movementRemaining: 0 })],
    activeCharters: [
      makeCharter({ id: "c0", heroId: "h0", ownerId: 0, phase: "constructing", daysRemaining: 1, settlementId: "s-new" }),
    ],
  });
  const next = advanceCharters(s);
  const hero = next.heroes.h0;
  assert.equal(hero.isChartering, false);
  assert.equal(hero.charterId, null);
  assert.equal(hero.movementRemaining, MOVEMENT_PER_TURN);
  assert.equal(hero.previousQ, null);
  assert.equal(hero.previousR, null);
  assert.equal(hero.previousMovementRemaining, null);
  const owner = next.players.find((p) => p.id === 0);
  assert.ok(owner?.settlementIds.includes("s-new"));
});

test("advanceCharters completes even when the founding hero no longer exists", () => {
  const s = makeState({
    activeCharters: [
      makeCharter({ id: "c0", heroId: "ghost-hero", ownerId: 0, phase: "constructing", daysRemaining: 1, settlementId: "s-new" }),
    ],
  });
  assert.doesNotThrow(() => advanceCharters(s));
  const next = advanceCharters(s);
  assert.ok(next.settlements["s-new"], "settlement is still created without the hero");
  assert.equal(next.activeCharters.length, 0);
});

test("advanceCharters handles a mix of counting-down and completing charters independently", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" }), makeHero("h1", 1, 18, 4, { isChartering: true, charterId: "c1" })],
    activeCharters: [
      makeCharter({ id: "c0", heroId: "h0", ownerId: 0, phase: "constructing", daysRemaining: 4, settlementId: "s-slow" }),
      makeCharter({ id: "c1", heroId: "h1", ownerId: 1, phase: "constructing", daysRemaining: 1, settlementId: "s-fast" }),
    ],
  });
  const next = advanceCharters(s);
  assert.equal(next.activeCharters.length, 1);
  assert.equal(next.activeCharters[0].id, "c0");
  assert.equal(next.activeCharters[0].daysRemaining, 3);
  assert.ok(next.settlements["s-fast"], "the finished charter's settlement exists");
  assert.equal(next.settlements["s-slow"], undefined, "the still-counting-down charter has not created a settlement");
});
