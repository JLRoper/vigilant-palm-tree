import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameMap } from "../../../src/map/gameMap";
import type { Hero } from "../../../src/entities/hero";
import { makeHero, makeState } from "../../charter/_helpers";
import { clickRejectionToast, resolveAdventureClick } from "../../../src/screens/adventure/clickIntent";

function stubHero(id: string, ownerId: number, q: number, r: number, movementRemaining = 10): Hero {
  return { id, ownerId, tile: { q, r }, movementRemaining } as unknown as Hero;
}

function stubMap(impassable: Set<string>): GameMap {
  return {
    isPassable: (q: number, r: number) => !impassable.has(`${q},${r}`),
    cost: () => 1,
    get: () => "grass",
  } as unknown as GameMap;
}

const OPEN_MAP = stubMap(new Set());

function resolve(overrides: Partial<Parameters<typeof resolveAdventureClick>[0]> = {}) {
  return resolveAdventureClick({
    map: OPEN_MAP,
    heroes: {},
    state: makeState(),
    hover: null,
    movedDuringDrag: false,
    isPlayerTurn: true,
    charterMode: false,
    validCharterHexes: null,
    ...overrides,
  });
}

test("charter mode over a valid hex with a selected hero opens the charter modal", () => {
  const state = makeState({ selectedHeroId: "h0" });
  const intent = resolve({
    state,
    hover: { q: 3, r: 3 },
    charterMode: true,
    validCharterHexes: new Set(["3,3"]),
  });
  assert.deepEqual(intent, { kind: "open-charter", targetQ: 3, targetR: 3 });
});

test("charter mode over an invalid hex is rejected before every other branch", () => {
  const moved = resolve({
    hover: { q: 9, r: 9 },
    movedDuringDrag: true,
    charterMode: true,
    validCharterHexes: new Set(["3,3"]),
  });
  assert.equal(moved.kind, "none");
  assert.equal(moved.reason, "charter_invalid");
});

test("charter mode without valid hexes falls through to the normal click pipeline", () => {
  const state = makeState({ selectedHeroId: "h0" });
  const intent = resolve({
    state,
    heroes: { h0: stubHero("h0", 0, 3, 3) },
    hover: { q: 3, r: 3 },
    charterMode: true,
    validCharterHexes: null,
  });
  assert.deepEqual(intent, { kind: "select-hero", heroId: "h0" });
});

test("a drag that crossed the move threshold swallows the click", () => {
  const intent = resolve({ movedDuringDrag: true, hover: { q: 1, r: 1 } });
  assert.equal(intent.kind, "none");
  assert.equal(intent.reason, "movedDuringDrag");
});

test("clicks during the AI turn are swallowed", () => {
  const intent = resolve({ isPlayerTurn: false, hover: { q: 1, r: 1 } });
  assert.equal(intent.kind, "none");
  assert.equal(intent.reason, "not_player_turn");
});

test("clicking a friendly hero selects it", () => {
  const state = makeState({ selectedHeroId: null });
  const intent = resolve({
    state,
    heroes: { h0: stubHero("h0", 0, 0, 0) },
    hover: { q: 0, r: 0 },
  });
  assert.deepEqual(intent, { kind: "select-hero", heroId: "h0" });
});

test("clicking an own settlement with nothing selected selects the settlement", () => {
  const state = makeState({ heroes: [makeHero("h0", 0, 0, 0)], selectedHeroId: null });
  const intent = resolve({ state, hover: { q: 2, r: 2 } });
  assert.deepEqual(intent, { kind: "select-settlement", settlementId: "s0" });
});

test("clicking an enemy within reach yields an attack intent onto the best adjacent tile", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 0, 0), makeHero("h1", 1, 2, 0)],
    selectedHeroId: "h0",
  });
  const intent = resolve({
    state,
    heroes: { h0: stubHero("h0", 0, 0, 0), h1: stubHero("h1", 1, 2, 0) },
    hover: { q: 2, r: 0 },
  });
  assert.equal(intent.kind, "attack");
  if (intent.kind !== "attack") return;
  assert.equal(intent.heroId, "h0");
  assert.deepEqual(intent.dest, { q: 1, r: 0 });
  assert.equal(intent.cost, 1);
  assert.equal(intent.reachableIdx, 1);
  assert.equal(intent.clamped, false);
  assert.deepEqual(intent.remainingPath, []);
});

test("an enemy beyond remaining movement clamps the attack to the reachable hex", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 0, 0, { movementRemaining: 1 }), makeHero("h1", 1, 3, 0)],
    selectedHeroId: "h0",
  });
  const intent = resolve({
    state,
    heroes: { h0: stubHero("h0", 0, 0, 0, 1), h1: stubHero("h1", 1, 3, 0) },
    hover: { q: 3, r: 0 },
  });
  assert.equal(intent.kind, "attack");
  if (intent.kind !== "attack") return;
  assert.equal(intent.clamped, true);
  assert.equal(intent.reachableIdx, 1);
  assert.deepEqual(intent.dest, { q: 1, r: 0 });
  assert.equal(intent.cost, 1);
  assert.deepEqual(intent.remainingPath, [{ q: 2, r: 0 }]);
});

test("no reachable adjacent hex reports no attack path", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 0, 0, { movementRemaining: 0 }), makeHero("h1", 1, 2, 0)],
    selectedHeroId: "h0",
  });
  const intent = resolve({
    state,
    heroes: { h0: stubHero("h0", 0, 0, 0, 0), h1: stubHero("h1", 1, 2, 0) },
    hover: { q: 2, r: 0 },
  });
  assert.equal(intent.kind, "none");
  if (intent.kind !== "none") return;
  assert.equal(intent.reason, "no attack path");
});

test("clicking an open tile with a selected hero yields a move intent carrying the debug path", () => {
  const state = makeState({ heroes: [makeHero("h0", 0, 0, 0)], selectedHeroId: "h0" });
  const intent = resolve({ state, hover: { q: 4, r: 0 } });
  assert.equal(intent.kind, "move");
  if (intent.kind !== "move") return;
  assert.equal(intent.heroId, "h0");
  assert.deepEqual(intent.dest, { q: 4, r: 0 });
  assert.equal(intent.cost, 4);
  assert.equal(intent.reachableIdx, 4);
  assert.equal(intent.clamped, false);
  assert.deepEqual(intent.remainingPath, []);
  assert.deepEqual(intent.debugPath, [
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 3, r: 0 },
    { q: 4, r: 0 },
  ]);
});

test("an impassable goal yields an empty path while still carrying the debug path", () => {
  const state = makeState({ heroes: [makeHero("h0", 0, 0, 0)], selectedHeroId: "h0" });
  const intent = resolve({
    state,
    map: stubMap(new Set(["5,0"])),
    hover: { q: 5, r: 0 },
  });
  assert.equal(intent.kind, "none");
  if (intent.kind !== "none") return;
  assert.equal(intent.reason, "empty path");
  assert.deepEqual(intent.debugPath, []);
});

test("moving with no selection reports no selection", () => {
  const state = makeState({ selectedHeroId: null });
  const intent = resolve({ state, hover: { q: 6, r: 0 } });
  assert.equal(intent.kind, "none");
  if (intent.kind !== "none") return;
  assert.equal(intent.reason, "no selection");
});

test("F9: every user-facing rejection reason maps to a toast, drags and off-map clicks stay silent", () => {
  assert.deepEqual(clickRejectionToast("not_player_turn"), { message: "It's not your turn", kind: "info" });
  assert.deepEqual(clickRejectionToast("no selection"), { message: "Select a hero first", kind: "info" });
  assert.deepEqual(clickRejectionToast("no hero"), { message: "The selected hero no longer exists", kind: "error" });
  assert.deepEqual(clickRejectionToast("empty path"), { message: "No path there", kind: "info" });
  assert.deepEqual(clickRejectionToast("impassable first step"), { message: "No path there", kind: "info" });
  assert.deepEqual(clickRejectionToast("no attack path"), { message: "No path there", kind: "info" });
  assert.deepEqual(clickRejectionToast("charter_invalid"), { message: "Pick a highlighted hex for the new settlement", kind: "info" });
  assert.equal(clickRejectionToast("movedDuringDrag"), null);
  assert.equal(clickRejectionToast("no hover"), null);
  assert.equal(clickRejectionToast("something new"), null);
});

test("a 0-movement rejection reports exhaustion instead of claiming no path", () => {
  assert.deepEqual(clickRejectionToast("impassable first step", 0), {
    message: "Out of movement — the rest continues next turn",
    kind: "info",
  });
  assert.deepEqual(clickRejectionToast("impassable first step", 2), { message: "No path there", kind: "info" }, "a genuinely unaffordable first step still reads as no path");
});

test("a hero with no movement left clicking an open tile carries the 0-movement context", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 0, 0, { movementRemaining: 0 })],
    selectedHeroId: "h0",
  });
  const intent = resolve({
    state,
    heroes: { h0: stubHero("h0", 0, 0, 0, 0) },
    hover: { q: 4, r: 0 },
  });
  assert.equal(intent.kind, "none");
  if (intent.kind !== "none") return;
  assert.equal(intent.reason, "impassable first step");
  assert.equal(intent.movementRemaining, 0);
  assert.deepEqual(clickRejectionToast(intent.reason, intent.movementRemaining), {
    message: "Out of movement — the rest continues next turn",
    kind: "info",
  });
});

test("F10: a clamped move intent's cost equals the detailed split's costToSplit clamped to remaining movement", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 0, 0, { movementRemaining: 1.5 })],
    selectedHeroId: "h0",
  });
  const intent = resolve({ state, hover: { q: 4, r: 0 } });
  assert.equal(intent.kind, "move");
  if (intent.kind !== "move") return;
  assert.equal(intent.clamped, true);
  assert.equal(intent.reachableIdx, 2);
  assert.equal(intent.cost, 1.5);
  assert.deepEqual(intent.remainingPath, [
    { q: 3, r: 0 },
    { q: 4, r: 0 },
  ]);
});
