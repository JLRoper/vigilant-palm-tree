import { test } from "node:test";
import assert from "node:assert/strict";
import { stepTravelCharter } from "@heroes/engine";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import { makeCharter, makeHero, makeState } from "./_helpers";

test("stepTravelCharter rejects when hero does not exist", () => {
  const s = makeState();
  const result = stepTravelCharter(s, "ghost", 3, 3, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_hero");
});

test("stepTravelCharter rejects when hero is not chartering", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: false })],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_chartering");
});

test("stepTravelCharter rejects when isChartering is true but charterId is null", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: null })],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_chartering");
});

test("stepTravelCharter rejects when the hero's charterId has no matching active charter", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "missing" })],
    activeCharters: [],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_charter");
});

test("stepTravelCharter rejects when the charter is already constructing", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, phase: "constructing", targetQ: 10, targetR: 10 })],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_traveling");
});

test("stepTravelCharter rejects when the destination is occupied by another hero", () => {
  const s = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" }),
      makeHero("h1", 1, 3, 2),
    ],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, targetQ: 10, targetR: 10 })],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "occupied");
});

test("stepTravelCharter rejects impassable (infinite) cost", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, targetQ: 10, targetR: 10 })],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, Infinity);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "impassable");
});

test("stepTravelCharter rejects insufficient movement", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0", movementRemaining: 1 })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, targetQ: 10, targetR: 10 })],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, 5);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "insufficient_movement");
});

test("stepTravelCharter moves the hero and leaves the charter traveling when not yet arrived", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, targetQ: 10, targetR: 10, phase: "traveling" })],
  });
  const result = stepTravelCharter(s, "h0", 3, 2, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.heroes.h0.q, 3);
  assert.equal(result.state.heroes.h0.r, 2);
  assert.equal(result.state.heroes.h0.movementRemaining, MOVEMENT_PER_TURN - 1);
  assert.equal(result.state.heroes.h0.previousQ, 2);
  assert.equal(result.state.heroes.h0.previousR, 2);
  assert.deepEqual(result.state.heroes.h0.trail, [{ q: 2, r: 2 }, { q: 3, r: 2 }]);
  assert.equal(result.state.activeCharters[0].phase, "traveling");
  assert.equal(result.state.dirty, true);
});

test("stepTravelCharter flips the charter to constructing and zeroes movement on arrival", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 8, 10, { isChartering: true, charterId: "c0", movementRemaining: 5 })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, targetQ: 10, targetR: 10, phase: "traveling" })],
  });
  const result = stepTravelCharter(s, "h0", 10, 10, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.heroes.h0.q, 10);
  assert.equal(result.state.heroes.h0.r, 10);
  // Arrival forces movementRemaining to 0 even though only part of the
  // budget (2 of 5) was actually spent on this final step.
  assert.equal(result.state.heroes.h0.movementRemaining, 0);
  assert.equal(result.state.activeCharters[0].phase, "constructing");
});

test("stepTravelCharter does not flip other charters when a different hero arrives", () => {
  const s = makeState({
    heroes: [
      makeHero("h0", 0, 8, 10, { isChartering: true, charterId: "c0", movementRemaining: 5 }),
      makeHero("h1", 1, 0, 0, { isChartering: true, charterId: "c1", movementRemaining: 5 }),
    ],
    activeCharters: [
      makeCharter({ id: "c0", heroId: "h0", ownerId: 0, targetQ: 10, targetR: 10, phase: "traveling" }),
      makeCharter({ id: "c1", heroId: "h1", ownerId: 1, targetQ: 20, targetR: 20, phase: "traveling" }),
    ],
  });
  const result = stepTravelCharter(s, "h0", 10, 10, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const c1 = result.state.activeCharters.find((c) => c.id === "c1");
  assert.equal(c1?.phase, "traveling");
});
