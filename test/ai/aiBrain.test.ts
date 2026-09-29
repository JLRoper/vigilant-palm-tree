import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAiMove } from "../../src/ai/aiBrain";
import { GameMap, type TileRow } from "../../src/map/gameMap";
import type { Terrain } from "../../src/map/terrain";
import { hexDistance } from "../../src/core/hex";
import { normalizePlatoons } from "@heroes/engine";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

function garrisoned(settlement: ReturnType<typeof makeSettlement>, count = 5): ReturnType<typeof makeSettlement> {
  settlement.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count }] }]);
  return settlement;
}

function withTroops(hero: ReturnType<typeof makeHero>): ReturnType<typeof makeHero> {
  hero.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]);
  return hero;
}

function grassMap(width: number, height: number): GameMap {
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({ q, r, terrain: "grass", resource: null });
    }
  }
  return GameMap.fromTiles(rows);
}

function terrainAt(entries: Array<[number, number, Terrain]>): GameMap {
  return GameMap.fromTiles(
    entries.map(([q, r, terrain]) => ({ q, r, terrain, resource: null })),
  );
}

function aiTurnState(heroes: ReturnType<typeof makeHero>[], settlements: ReturnType<typeof makeSettlement>[] = []) {
  return makeState({
    heroes,
    settlements,
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
}

test("an adjacent enemy is targeted: the step repositions beside it instead of onto its tile", () => {
  const map = terrainAt([
    [2, 2, "grass"],
    [3, 2, "grass"],
    [3, 1, "grass"],
    [2, 3, "grass"],
    [3, 3, "grass"],
  ]);
  const state = aiTurnState([withTroops(makeHero("h0", 0, 3, 2)), makeHero("h1", 1, 2, 2)]);

  const move = pickAiMove(state, "h1", map, () => 0.9);

  assert.ok(move, "an in-reach enemy must produce a move");
  assert.notDeepEqual(move!.toTile, { q: 3, r: 2 }, "the engine rejects moving onto the enemy tile (occupied)");
  assert.equal(hexDistance(move!.toTile, { q: 3, r: 2 }), 1, "the step must end adjacent to the enemy so the post-move battle check fires");
  assert.equal(hexDistance(move!.toTile, { q: 2, r: 2 }), 1, "one hex step only");
  assert.equal(move!.cost, 1, "grass step costs 1");
});

test("an enemy within reach is approached: the step closes distance instead of wandering", () => {
  const map = grassMap(8, 8);
  const state = aiTurnState([withTroops(makeHero("h0", 0, 5, 2)), makeHero("h1", 1, 2, 2)]);

  const move = pickAiMove(state, "h1", map, () => 0.9);

  assert.ok(move);
  assert.equal(hexDistance(move!.toTile, { q: 2, r: 2 }), 1, "one hex step only");
  assert.equal(
    hexDistance(move!.toTile, { q: 5, r: 2 }),
    2,
    "the step must close the distance to the enemy (3 -> 2)",
  );
  assert.notDeepEqual(move!.toTile, { q: 5, r: 2 }, "never steps onto the enemy tile");
  assert.equal(move!.cost, 1);
});

test("a 0-troop enemy hero within reach is not targeted: the hero wanders instead of approaching", () => {
  const map = grassMap(8, 8);
  const wiped = makeHero("h0", 0, 5, 2, { stacks: [] });
  const state = aiTurnState([wiped, makeHero("h1", 1, 2, 2)]);

  const move = pickAiMove(state, "h1", map, () => 0.05);

  assert.ok(move, "open map with movement left must produce a move");
  assert.equal(
    hexDistance(move!.toTile, { q: 5, r: 2 }),
    4,
    "the empty hero is no target: the wander dest (0,0) leads AWAY from it (3 -> 4; an approach would close 3 -> 2)",
  );
  assert.notDeepEqual(move!.toTile, { q: 5, r: 2 }, "never steps onto the empty hero's tile");
  assert.equal(move!.cost, 1);
});

test("with no targets in reach the hero takes one reachable wander step (not a jump to the wander destination)", () => {
  const map = grassMap(12, 12);
  const state = aiTurnState([makeHero("h0", 0, 11, 11), makeHero("h1", 1, 2, 2)]);

  const move = pickAiMove(state, "h1", map, () => 0.5);

  assert.ok(move, "open map with movement left must wander somewhere reachable");
  assert.equal(hexDistance(move!.toTile, { q: 2, r: 2 }), 1, "the wander result is a single hex step");
  assert.notDeepEqual(move!.toTile, { q: 6, r: 6 }, "the hero must not teleport to the random destination");
  assert.equal(move!.cost, 1);
});

test("impassable and unreachable targets return null without crashing", () => {
  const map = terrainAt([
    [2, 2, "grass"],
    [3, 2, "water"],
    [4, 2, "water"],
  ]);
  const state = aiTurnState([withTroops(makeHero("h0", 0, 3, 2)), makeHero("h1", 1, 2, 2)], [
    makeSettlement("s2", null, 4, 2),
  ]);

  const move = pickAiMove(state, "h1", map, () => 0.5);

  assert.equal(move, null, "enemy on impassable terrain, unreachable settlement, impassable wander targets -> null");
});

test("a hero with no movement left returns null", () => {
  const map = grassMap(8, 8);
  const state = aiTurnState([
    makeHero("h0", 0, 5, 2),
    makeHero("h1", 1, 2, 2, { movementRemaining: 0 }),
  ]);

  assert.equal(pickAiMove(state, "h1", map, () => 0.5), null);
});

test("a garrisoned enemy settlement the AI cannot beat is never a step: the approach routes around it", () => {
  const map = grassMap(8, 8);
  const state = aiTurnState(
    [withTroops(makeHero("h0", 0, 5, 2)), makeHero("h1", 1, 2, 2)],
    [garrisoned(makeSettlement("s0", 0, 3, 2))],
  );

  const move = pickAiMove(state, "h1", map, () => 0.9);

  assert.ok(move, "the enemy hero is still in reach — the AI must keep approaching");
  assert.notDeepEqual(
    move!.toTile,
    { q: 3, r: 2 },
    "5 attackers vs a 5-strong garrison is below the 1.5x threshold: no attack",
  );
  assert.equal(hexDistance(move!.toTile, { q: 3, r: 2 }), 1, "the detour keeps the step beside the settlement, not on it");
  assert.equal(hexDistance(move!.toTile, { q: 5, r: 2 }), 3, "the step is on the shortest path around the garrisoned tile");
  assert.equal(move!.cost, 1);
});

test("a garrisoned enemy settlement the AI can beat is a target: the path steps onto it", () => {
  const map = grassMap(8, 8);
  const strong = makeHero("h1", 1, 2, 2);
  strong.stacks = normalizePlatoons([
    { entries: [{ unitTypeId: "swordsman", count: 8 }] },
  ]);
  const state = aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), strong], [
    garrisoned(makeSettlement("s0", 0, 3, 2)),
  ]);

  const move = pickAiMove(state, "h1", map, () => 0.9);

  assert.ok(move, "8 attackers vs a 5-strong garrison clears the 1.5x threshold");
  assert.deepEqual(
    move!.toTile,
    { q: 3, r: 2 },
    "the favorable garrison must not be blocked: the approach ends on the settlement tile (tryCaptureAt turns it into a battle)",
  );
  assert.equal(move!.cost, 1);
});

test("a favorable NEUTRAL garrisoned settlement is attacked exactly like an enemy-owned one", () => {
  const map = grassMap(8, 8);
  const strong = makeHero("h1", 1, 2, 2);
  strong.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 8 }] }]);
  const state = aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), strong], [
    garrisoned(makeSettlement("s0", null, 4, 2)),
  ]);

  const move = pickAiMove(state, "h1", map, () => 0.9);

  assert.ok(move);
  assert.deepEqual(
    move!.toTile,
    { q: 3, r: 2 },
    "the first step of the approach runs straight at the neutral garrison — it is a real target, not an obstacle",
  );
  assert.equal(hexDistance(move!.toTile, { q: 4, r: 2 }), 1, "the approach closes distance (settlement two hexes away)");
  assert.equal(move!.cost, 1);
});

test("threshold boundary: an attacker exactly at 1.5x the garrison attacks, one troop short routes around", () => {
  const map = grassMap(8, 8);
  const atThreshold = makeHero("h1", 1, 2, 2);
  atThreshold.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 15 }] }]);
  const belowThreshold = makeHero("h1b", 1, 2, 2);
  belowThreshold.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 14 }] }]);

  const attack = pickAiMove(aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), atThreshold], [
    garrisoned(makeSettlement("s0", 0, 3, 2), 10),
  ]), "h1", map, () => 0.5);

  assert.ok(attack, "15 >= 1.5 * 10 exactly: the attack is on");
  assert.deepEqual(attack!.toTile, { q: 3, r: 2 }, "the at-threshold attacker steps onto the garrisoned settlement");

  const avoid = pickAiMove(aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), belowThreshold], [
    garrisoned(makeSettlement("s0", 0, 3, 2), 10),
  ]), "h1b", map, () => 0.5);

  assert.ok(avoid, "14 < 1.5 * 10: no attack, but movement remains so the hero wanders");
  assert.notDeepEqual(avoid!.toTile, { q: 3, r: 2 }, "the below-threshold attacker never steps onto the garrison");
  assert.equal(hexDistance(avoid!.toTile, { q: 2, r: 2 }), 1, "one hex step only");
  assert.equal(avoid!.cost, 1);
});

test("an empty enemy-owned settlement is a real target: the walk-in capture path keeps working", () => {
  const map = terrainAt([
    [2, 2, "grass"],
    [3, 2, "grass"],
    [4, 2, "grass"],
    [5, 2, "grass"],
  ]);
  const state = aiTurnState([makeHero("h0", 0, 10, 10), makeHero("h1", 1, 2, 2)], [
    makeSettlement("s0", 0, 3, 2),
    makeSettlement("s2", null, 5, 2),
  ]);

  const move = pickAiMove(state, "h1", map, () => 0.5);

  assert.ok(move);
  assert.deepEqual(
    move!.toTile,
    { q: 3, r: 2 },
    "the empty enemy settlement outranks the neutral one (650-band vs 600-band): it is stepped onto for the walk-in capture",
  );
  assert.equal(move!.cost, 1);
});

test("the strength gate holds with no better target: an unfavorable garrison is skipped, a favorable one is enterable", () => {
  const map = grassMap(12, 12);
  const weakState = aiTurnState(
    [makeHero("h0", 0, 11, 11), makeHero("h1", 1, 2, 2)],
    [garrisoned(makeSettlement("s0", 0, 3, 2))],
  );
  const strong = makeHero("h1", 1, 2, 2);
  strong.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 8 }] }]);
  const strongState = aiTurnState(
    [makeHero("h0", 0, 11, 11), strong],
    [garrisoned(makeSettlement("s0", 0, 3, 2))],
  );

  const seq = [3 / 12, 2 / 12, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
  let i = 0;
  const rng = () => seq[i++ % seq.length];

  const weakMove = pickAiMove(weakState, "h1", map, rng);

  assert.ok(weakMove, "open map with movement left must still wander somewhere reachable");
  assert.notDeepEqual(
    weakMove!.toTile,
    { q: 3, r: 2 },
    "the first wander pick is the (unfavorable) garrisoned settlement tile itself — it must be skipped",
  );
  assert.equal(hexDistance(weakMove!.toTile, { q: 2, r: 2 }), 1, "one hex step only");
  assert.equal(weakMove!.cost, 1);

  const strongMove = pickAiMove(strongState, "h1", map, rng);

  assert.ok(strongMove);
  assert.deepEqual(
    strongMove!.toTile,
    { q: 3, r: 2 },
    "a favorable garrison is not blocked even when it is the only pick: the hero steps right onto it",
  );
  assert.equal(strongMove!.cost, 1);
});
