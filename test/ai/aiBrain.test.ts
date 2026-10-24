import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARTER_TARGET_REACH, GARRISON_BACKOFF_ROUNDS, pickAiMove, pickCharterAction, pickGarrisonRecruitment, pickSettlersWagonAction } from "../../src/ai/aiBrain";
import { GameMap, type TileRow } from "../../src/map/gameMap";
import type { Terrain } from "../../src/map/terrain";
import { hexDistance } from "../../src/core/hex";
import { CHARTER_GOLD_COST, canFoundSettlement, mulberry32, normalizePlatoons, platoonTroopTotal, settlementStacks, type UnitType } from "@heroes/engine";
import type { BuildingKind } from "@heroes/contracts";
import { coveredWagonIdFor, gameModeSettings } from "@heroes/contracts";
import { makeHero, makeSettlement, makeState, emptyWarehouse } from "../charter/_helpers";

const POWER_UNITS: Record<string, UnitType> = {
  militia: { id: "militia", name: "Militia", attack: 1, defence: 1, health: 3, speed: 3, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 1 },
  griffin: { id: "griffin", name: "Griffin", attack: 8, defence: 6, health: 18, speed: 6, description: "", advantageType: "monster", specialty: "", specialtyPriority: 1 },
};

const RECRUIT_UNITS: Record<string, UnitType> = {
  peasant: { id: "peasant", name: "Peasant", attack: 1, defence: 1, health: 2, speed: 2, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 1 },
  swordsman: { id: "swordsman", name: "Swordsman", attack: 4, defence: 4, health: 10, speed: 3, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 1 },
  archer: { id: "archer", name: "Archer", attack: 3, defence: 2, health: 6, speed: 3, description: "", advantageType: "ranged", specialty: "", specialtyPriority: 1 },
  cavalry: { id: "cavalry", name: "Cavalry", attack: 6, defence: 5, health: 14, speed: 6, description: "", advantageType: "cavalry", specialty: "", specialtyPriority: 1 },
};

function building(kind: BuildingKind, gx = 2, gy = 2, level = 1) {
  return { gx, gy, kind, level, style: "classic" as const };
}

function garrisoned(settlement: ReturnType<typeof makeSettlement>, count = 5, unitTypeId = "swordsman"): ReturnType<typeof makeSettlement> {
  settlement.stacks = normalizePlatoons([{ entries: [{ unitTypeId, count }] }]);
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

test("threshold boundary on power: exactly 1.5x the garrison's power attacks, one point short routes around", () => {
  const map = grassMap(8, 8);
  const atThreshold = makeHero("h1", 1, 2, 2);
  atThreshold.stacks = normalizePlatoons([
    { entries: [{ unitTypeId: "griffin", count: 1 }, { unitTypeId: "militia", count: 8 }] },
  ]);
  const belowThreshold = makeHero("h1b", 1, 2, 2);
  belowThreshold.stacks = normalizePlatoons([
    { entries: [{ unitTypeId: "griffin", count: 1 }, { unitTypeId: "militia", count: 7 }] },
  ]);

  const attack = pickAiMove(aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), atThreshold], [
    garrisoned(makeSettlement("s0", 0, 3, 2), 10, "militia"),
  ]), "h1", map, () => 0.5, POWER_UNITS);

  assert.ok(attack, "griffin + 8 militia = 30 power vs 10 militia = 20 (1.5x exactly): the attack is on");
  assert.deepEqual(attack!.toTile, { q: 3, r: 2 }, "the at-threshold attacker steps onto the garrisoned settlement");
  assert.equal(
    platoonTroopTotal(atThreshold.stacks),
    9,
    "the attacker has FEWER troops than the garrison: only the power model lets it through",
  );

  const avoid = pickAiMove(aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), belowThreshold], [
    garrisoned(makeSettlement("s0", 0, 3, 2), 10, "militia"),
  ]), "h1b", map, () => 0.5, POWER_UNITS);

  assert.ok(avoid, "28 < 1.5 * 20: no attack, but movement remains so the hero wanders");
  assert.notDeepEqual(avoid!.toTile, { q: 3, r: 2 }, "the below-threshold attacker never steps onto the garrison");
  assert.equal(hexDistance(avoid!.toTile, { q: 2, r: 2 }), 1, "one hex step only");
  assert.equal(avoid!.cost, 1);
});

test("equal troop counts split by quality: griffins beat a militia garrison of the same size but not a griffin one", () => {
  const map = grassMap(8, 8);
  const attacker = makeHero("h1", 1, 2, 2);
  attacker.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "griffin", count: 5 }] }]);

  const beatsMilitia = pickAiMove(aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), attacker], [
    garrisoned(makeSettlement("s0", 0, 3, 2), 10, "militia"),
  ]), "h1", map, () => 0.9, POWER_UNITS);

  assert.ok(beatsMilitia, "5 griffins (70 power) vs 10 militia (20 power): 70 >= 1.5 * 20 clears the gate");
  assert.deepEqual(
    beatsMilitia!.toTile,
    { q: 3, r: 2 },
    "quality wins at equal troop counts: the approach steps onto the militia garrison",
  );

  const avoidsGriffins = pickAiMove(aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), attacker], [
    garrisoned(makeSettlement("s1", 0, 3, 2), 10, "griffin"),
  ]), "h1", map, () => 0.5, POWER_UNITS);

  assert.ok(avoidsGriffins, "5 griffins (70) vs 10 griffins (140): 70 < 1.5 * 140, the hero keeps moving");
  assert.notDeepEqual(
    avoidsGriffins!.toTile,
    { q: 3, r: 2 },
    "the same 5 troops refuse a garrison of equal size but higher quality",
  );
  assert.equal(hexDistance(avoidsGriffins!.toTile, { q: 3, r: 2 }), 1, "the unfavorable garrison is routed around, not entered");
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

// ---------------------------------------------------------------------------
// B1: pickGarrisonRecruitment (plan/2026-09-29-settlement-battle-followups.md)
// ---------------------------------------------------------------------------

function garrisonState(
  settlements: ReturnType<typeof makeSettlement>[],
  heroes: ReturnType<typeof makeHero>[] = [],
) {
  return makeState({
    heroes,
    settlements,
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
}

function raiderAt(q: number, r: number, count: number): ReturnType<typeof makeHero> {
  const hero = makeHero("h0", 0, q, r);
  hero.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count }] }]);
  return hero;
}

test("pickGarrisonRecruitment targets only own settlements without a standing defender hero", () => {
  const own = makeSettlement("s1", 1, 18, 4, {
    gold: 500,
    buildings: [building("farmhouse")],
  });
  const defended = makeSettlement("s3", 1, 14, 4, {
    gold: 500,
    buildings: [building("farmhouse")],
  });
  const foreign = makeSettlement("s0", 0, 10, 4, {
    gold: 500,
    buildings: [building("farmhouse")],
  });
  const state = garrisonState(
    [own, defended, foreign],
    [makeHero("h1", 1, 14, 4), makeHero("h0", 0, 0, 0)],
  );

  const plan = pickGarrisonRecruitment(state, 1, RECRUIT_UNITS);

  assert.deepEqual(
    plan.map((p) => p.settlementId),
    ["s1"],
    "a defended own settlement and a foreign settlement are never recruited for",
  );
  assert.deepEqual(plan[0], {
    settlementId: "s1",
    buildingKind: "farmhouse",
    gx: 2,
    gy: 2,
    unitTypeId: "peasant",
    count: 2,
  }, "an unthreatened town gets the skeleton garrison: floor 4 power = 2 peasants (2 power, 25g each)");
});

test("pickGarrisonRecruitment sizes the garrison against nearby enemy power and buys the best power-per-gold unit", () => {
  const town = makeSettlement("s1", 1, 10, 4, {
    gold: 2000,
    buildings: [building("farmhouse"), building("barracks", 4, 4)],
  });
  const state = garrisonState([town], [raiderAt(5, 4, 5)]);

  const plan = pickGarrisonRecruitment(state, 1, RECRUIT_UNITS);

  assert.deepEqual(
    plan.map((p) => [p.unitTypeId, p.count]),
    [["peasant", 3], ["swordsman", 3]],
    "threat = 5 x (4+4) = 40: peasant (0.08 power/gold) buys first, then swordsman (0.04) — each order capped at the 3-unit draft pool",
  );
});

test("pickGarrisonRecruitment skips settlements already at or above their target power", () => {
  const garrisonedTown = makeSettlement("s1", 1, 10, 4, {
    gold: 2000,
    buildings: [building("farmhouse")],
  });
  garrisonedTown.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "peasant", count: 20 }] }]);
  const weakTown = makeSettlement("s2", 1, 20, 8, {
    gold: 2000,
    buildings: [building("farmhouse")],
  });
  weakTown.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "peasant", count: 1 }] }]);
  const state = garrisonState([garrisonedTown, weakTown], [raiderAt(5, 4, 5)]);

  const plan = pickGarrisonRecruitment(state, 1, RECRUIT_UNITS);

  assert.deepEqual(plan.map((p) => [p.settlementId, p.unitTypeId, p.count]), [["s2", "peasant", 1]],
    "40 garrison power already meets the 40-power threat target; the 1-peasant (2 power) town tops up toward the floor");
});

test("pickGarrisonRecruitment respects the gold reserve and warehouse resources", () => {
  const poor = makeSettlement("s1", 1, 10, 4, { gold: 120, buildings: [building("farmhouse")] });
  assert.deepEqual(pickGarrisonRecruitment(garrisonState([poor]), 1, RECRUIT_UNITS), [],
    "120g - 100g reserve is below one 25g peasant: nothing is bought");

  const justEnough = makeSettlement("s2", 1, 10, 4, { gold: 125, buildings: [building("farmhouse")] });
  assert.deepEqual(
    pickGarrisonRecruitment(garrisonState([justEnough]), 1, RECRUIT_UNITS).map((p) => p.count),
    [1],
    "exactly one peasant fits above the reserve",
  );

  const woods = makeSettlement("s3", 1, 10, 4, {
    gold: 3000,
    warehouse: emptyWarehouse({ wood: 5 }),
    buildings: [building("archeryRange")],
  });
  const plan = pickGarrisonRecruitment(garrisonState([woods], [raiderAt(5, 4, 5)]), 1, RECRUIT_UNITS);

  assert.deepEqual(
    plan.map((p) => [p.unitTypeId, p.count]),
    [["archer", 2]],
    "a 40-power threat wants 8 archers but only 5 stocked wood at 2 per archer",
  );
});

test("pickGarrisonRecruitment respects the engine's garrison_full deposit cap", () => {
  const recruitBuildings = [
    building("farmhouse"),
    building("barracks", 4, 4),
    building("archeryRange", 6, 4),
    building("stables", 8, 4),
    building("mageGuild", 10, 4),
  ];
  const fullGarrison = normalizePlatoons(
    Array.from({ length: 8 }, (_, platoon) => ({
      entries: [0, 1, 2].map((slot) => ({ unitTypeId: `filler${platoon * 3 + slot}`, count: 1 })),
    })),
  );
  const locked = makeSettlement("s1", 1, 10, 4, { gold: 5000, buildings: recruitBuildings });
  locked.stacks = fullGarrison;
  const lockedState = garrisonState([locked], [raiderAt(5, 4, 12)]);

  assert.deepEqual(pickGarrisonRecruitment(lockedState, 1, RECRUIT_UNITS), [],
    "all 24 platoon entries taken and no candidate type already staged: every deposit probe fails, nothing is bought");

  const oneSlot = makeSettlement("s2", 1, 10, 4, { gold: 5000, buildings: recruitBuildings });
  const partial = normalizePlatoons(fullGarrison.slice(0, 7));
  partial[7] = { entries: [{ unitTypeId: "filler21", count: 1 }, { unitTypeId: "filler22", count: 1 }] };
  oneSlot.stacks = partial;
  const plan = pickGarrisonRecruitment(garrisonState([oneSlot], [raiderAt(5, 4, 12)]), 1, RECRUIT_UNITS);

  assert.deepEqual(
    plan.map((p) => [p.unitTypeId, p.count]),
    [["peasant", 3]],
    "the one free platoon slot takes the best power-per-gold candidate: 96 threat - 46 staged = 50 deficit, draft-capped to 3 peasants; the slot is then full for every other unit",
  );
});

test("pickGarrisonRecruitment clamps each order to the building's default draft pool", () => {
  const invader = makeHero("h0", 0, 5, 4);
  invader.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "peasant", count: 5 }] }]);
  const town = makeSettlement("s1", 1, 10, 4, {
    gold: 1000,
    buildings: [building("farmhouse")],
  });

  const plan = pickGarrisonRecruitment(garrisonState([town], [invader]), 1, RECRUIT_UNITS);

  assert.deepEqual(
    plan.map((p) => [p.unitTypeId, p.count]),
    [["peasant", 3]],
    "a 5-peasant threat (10 power) and 900g would buy 5 peasants, but the default draft pool is 3",
  );
});

test("pickGarrisonRecruitment respects an explicit per-unit draft pool", () => {
  const invader = makeHero("h0", 0, 5, 4);
  invader.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "peasant", count: 5 }] }]);
  const town = makeSettlement("s1", 1, 10, 4, {
    gold: 1000,
    buildings: [{ ...building("farmhouse"), draft: { peasant: 1 } }],
  });

  const plan = pickGarrisonRecruitment(garrisonState([town], [invader]), 1, RECRUIT_UNITS);

  assert.deepEqual(
    plan.map((p) => [p.unitTypeId, p.count]),
    [["peasant", 1]],
    "a written pool of 1 caps the order below the default 3",
  );
});

test("pickGarrisonRecruitment skips a drained draft pool and keeps buying from other buildings", () => {
  const town = makeSettlement("s1", 1, 10, 4, {
    gold: 2000,
    buildings: [
      { ...building("farmhouse"), draft: { peasant: 0 } },
      building("barracks", 4, 4),
    ],
  });

  const plan = pickGarrisonRecruitment(garrisonState([town], [raiderAt(5, 4, 5)]), 1, RECRUIT_UNITS);

  assert.deepEqual(
    plan.map((p) => [p.unitTypeId, p.count]),
    [["swordsman", 3]],
    "the drained peasant pool yields no peasant order, and the barracks still sells its 3",
  );
});

test("pickGarrisonRecruitment is deterministic and never mutates the settlement it plans for", () => {
  const town = makeSettlement("s1", 1, 10, 4, {
    gold: 2000,
    warehouse: emptyWarehouse({ wood: 4 }),
    buildings: [building("farmhouse"), building("barracks", 4, 4)],
  });
  const state = garrisonState([town], [raiderAt(5, 4, 5)]);

  const first = pickGarrisonRecruitment(state, 1, RECRUIT_UNITS);
  const second = pickGarrisonRecruitment(state, 1, RECRUIT_UNITS);

  assert.ok(first.length > 0);
  assert.deepEqual(first, second, "repeated calls return identical plans");
  assert.equal(state.settlements["s1"]?.gold, 2000, "planning never spends the treasury");
  assert.deepEqual(state.settlements["s1"]?.warehouse, emptyWarehouse({ wood: 4 }), "planning never spends the warehouse");
  assert.deepEqual(settlementStacks(state.settlements["s1"] ?? undefined), normalizePlatoons([]), "planning never mutates the garrison");
});

// ---------------------------------------------------------------------------
// I1: pickAiMove honors re-attack backoff exclusions
// ---------------------------------------------------------------------------

test("an I1-excluded garrisoned settlement is neither targeted nor stepped on: the hero routes around it", () => {
  const map = grassMap(8, 8);
  const strong = makeHero("h1", 1, 2, 2);
  strong.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 8 }] }]);
  const settlements = [garrisoned(makeSettlement("s0", 0, 3, 2))];
  const state = aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), strong], settlements);

  const baseline = pickAiMove(state, "h1", map, () => 0.9);
  assert.deepEqual(baseline!.toTile, { q: 3, r: 2 }, "without the exclusion the favorable garrison is stepped onto");

  const excluded = pickAiMove(state, "h1", map, () => 0.4, {}, new Set(["s0"]));

  assert.ok(excluded, "movement remains, so the hero still takes a step");
  assert.notDeepEqual(excluded!.toTile, { q: 3, r: 2 }, "the excluded settlement is removed from every target class");
  assert.equal(hexDistance(excluded!.toTile, { q: 3, r: 2 }), 1, "the step routes around: it lands beside the settlement, not on it");
  assert.equal(excluded!.cost, 1);
});

test("an excluded EMPTY enemy settlement is dropped from the walk-in capture class too", () => {
  const map = grassMap(8, 8);
  const state = aiTurnState([makeHero("h0", 0, 7, 7, { stacks: [] }), makeHero("h1", 1, 2, 2)], [
    makeSettlement("s0", 0, 3, 2),
  ]);

  const baseline = pickAiMove(state, "h1", map, () => 0.5);
  assert.deepEqual(baseline!.toTile, { q: 3, r: 2 }, "without the exclusion the empty settlement is stepped onto for the capture");

  const excluded = pickAiMove(state, "h1", map, () => 0.5, {}, new Set(["s0"]));

  assert.ok(excluded);
  assert.notDeepEqual(excluded!.toTile, { q: 3, r: 2 }, "the excluded settlement is not a target even when empty");
  assert.equal(hexDistance(excluded!.toTile, { q: 3, r: 2 }), 1);
  assert.equal(excluded!.cost, 1);
});

test("GARRISON_BACKOFF_ROUNDS is the expiry contract the TurnController records against", () => {
  assert.equal(GARRISON_BACKOFF_ROUNDS, 2);
});

// ---------------------------------------------------------------------------
// W5 (SETTLERS-PLAN.md §4): the AI slice -- the covered wagon's decisions.
//
// In settlers mode a seat owns no commander: it owns one covered wagon, and
// founding is what the wagon is for. Every hex the brain considers is asked
// about through the engine's own canFoundSettlement, so the AI can never found
// where a human could not; and because a wagon has NO army, the brain never
// offers it a military target at all.
// ---------------------------------------------------------------------------

/** The mode's own spacing answer, read here too -- never re-declared. */
const MIN_FOUNDING_DISTANCE = gameModeSettings("settlers").minFoundingDistance;

/** A covered wagon: a HeroState with no army, exactly what init.ts builds. */
function wagon(q: number, r: number, opts: HeroOpts = {}) {
  return makeHero(coveredWagonIdFor(1), 1, q, r, { troops: 0, stacks: [], ...opts });
}

const WAGON_ID = coveredWagonIdFor(1);

function settlersTurnState(
  heroes: ReturnType<typeof makeHero>[],
  settlements: ReturnType<typeof makeSettlement>[] = [],
) {
  const state = aiTurnState(heroes, settlements);
  state.gameMode = "settlers";
  return state;
}

test("settlers: a wagon on a hex the engine admits founds where it stands, and the decision draws no rng", () => {
  const map = grassMap(16, 16);
  const state = settlersTurnState([wagon(8, 8)]);
  const rng = seededRng(3);

  const action = pickSettlersWagonAction(state, WAGON_ID, map, rng.rng);

  assert.deepEqual(action, { kind: "found", heroId: WAGON_ID, q: 8, r: 8 }, "found here");
  assert.equal(
    canFoundSettlement({ state, founderId: WAGON_ID, q: 8, r: 8, map }).ok,
    true,
    "…which is exactly what the engine's own predicate says about that hex",
  );
  assert.equal(rng.draws(), 0, "a founding decision never advances an rng stream");
});

test("settlers: a wagon inside the mode's spacing walks to a hex the engine admits and founds there", () => {
  const map = grassMap(16, 16);
  const neutral = makeSettlement("s-neutral", null, 8, 8);
  const state = settlersTurnState([wagon(8, 9)], [neutral]);
  const rng = seededRng(5);

  assert.equal(
    canFoundSettlement({ state, founderId: WAGON_ID, q: 8, r: 9, map }).ok,
    false,
    `a settlement ${hexDistance({ q: 8, r: 9 }, { q: 8, r: 8 })} hex away is inside the ${MIN_FOUNDING_DISTANCE}-hex rule`,
  );

  let hero = state.heroes[WAGON_ID];
  let steps = 0;
  let action = pickSettlersWagonAction(state, WAGON_ID, map, rng.rng);
  while (action?.kind === "move") {
    assert.equal(hexDistance(action.toTile, { q: hero.q, r: hero.r }), 1, "one hex per decision");
    assert.notDeepEqual(action.toTile, { q: 8, r: 8 }, "a wagon never steps onto a settlement's hex");
    hero = { ...hero, q: action.toTile.q, r: action.toTile.r };
    state.heroes[WAGON_ID] = hero;
    steps += 1;
    assert.ok(steps <= 12, "the wagon converges on a legal hex instead of walking forever");
    action = pickSettlersWagonAction(state, WAGON_ID, map, rng.rng);
  }

  assert.ok(action, "the wagon reaches a hex it may found on");
  assert.equal(action!.kind, "found");
  assert.ok(
    hexDistance({ q: hero.q, r: hero.r }, { q: 8, r: 8 }) >= MIN_FOUNDING_DISTANCE,
    "…and it honours the mode's own spacing",
  );
  assert.equal(rng.draws(), 0, "walking to a founding hex draws nothing");
});

test("settlers: a wagon is offered no army target -- the empty castle next door is a commander's business", () => {
  const map = grassMap(16, 16);
  const castle = makeSettlement("s-neutral", null, 8, 8);
  const state = settlersTurnState([wagon(8, 9)], [castle]);
  const rng = seededRng(11);

  const wagonStep = pickAiMove(state, WAGON_ID, map, rng.rng);
  assert.ok(wagonStep, "the wagon still moves -- toward the hex it may found on");
  assert.notDeepEqual(wagonStep!.toTile, { q: 8, r: 8 }, "never onto the castle: capturing is an army action");

  // The control: the SAME board with an armed commander standing there does
  // walk onto the empty castle, so the fixture really is a capture target and
  // the difference above is the wagon, not the board.
  const classic = aiTurnState([
    makeHero("h1", 1, 8, 9, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "militia", count: 3 }] }]) }),
  ], [makeSettlement("s-neutral", null, 8, 8)]);
  const commanderStep = pickAiMove(classic, "h1", map, seededRng(11).rng);
  assert.ok(commanderStep);
  assert.deepEqual(commanderStep!.toTile, { q: 8, r: 8 }, "the same board is a walk-in capture for a commander");
});

test("settlers: the AI never charters -- pickCharterAction is mode-gated and consumes no rng", () => {
  const map = isolatedResourceMap(16, 16, [[4, 4, "gold"]]);
  const rng = seededRng(1);
  const settlers = charterState();
  settlers.gameMode = "settlers";

  assert.equal(pickCharterAction(settlers, "h1", map, rng.rng), null, "settlers founds, it does not charter");
  assert.equal(rng.draws(), 0, "the gate failure draws nothing");

  const classicRng = seededRng(1);
  assert.ok(pickCharterAction(charterState(), "h1", map, classicRng.rng), "the identical classic state still charters");
  assert.equal(classicRng.draws(), 2, "…and draws its name exactly as before");
});

test("settlers: pickSettlersWagonAction is a no-op for anything that is not a wagon", () => {
  const map = grassMap(16, 16);
  const state = settlersTurnState([makeHero("h1", 1, 8, 8)]);

  assert.equal(pickSettlersWagonAction(state, "h1", map, seededRng(1).rng), null, "a commander is not a wagon");
  assert.equal(pickSettlersWagonAction(state, "p9-wagon", map, seededRng(1).rng), null, "and a wagon that is gone is nothing to decide");

  // A wagon in a classic game: the engine's own mode gate refuses the founding,
  // so the brain has nothing to offer but a walk -- and never an army errand.
  const classic = aiTurnState([wagon(8, 8)], [makeSettlement("s-neutral", null, 8, 8)]);
  const action = pickSettlersWagonAction(classic, WAGON_ID, map, seededRng(2).rng);
  assert.notEqual(action?.kind, "found", "a classic game never founds through the mode's path");
});


// ---------------------------------------------------------------------------
// B3: pickCharterAction (plans/20261002-1900_ai-actor-phase-3.md, B3 spec §3)
// ---------------------------------------------------------------------------

type HeroOpts = Parameters<typeof makeHero>[4];

// The funded-AI-hero baseline: a 2,500g hero standing on its own well-stocked
// settlement at (8,8), during its own AI turn.
function charterState(heroOpts: HeroOpts = {}, warehouse = { wood: 20, stone: 15 }) {
  return makeState({
    heroes: [makeHero("h1", 1, 8, 8, { gold: CHARTER_GOLD_COST, ...heroOpts })],
    settlements: [makeSettlement("s1", 1, 8, 8, { warehouse: emptyWarehouse(warehouse) })],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
}

function gridMap(
  width: number,
  height: number,
  opts: {
    terrain?: (q: number, r: number) => Terrain;
    resources?: Array<[number, number, string]>;
  } = {},
): GameMap {
  const resources = new Map((opts.resources ?? []).map(([q, r, res]) => [`${q},${r}`, res]));
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({
        q,
        r,
        terrain: opts.terrain ? opts.terrain(q, r) : "grass",
        resource: resources.get(`${q},${r}`) ?? null,
      });
    }
  }
  return GameMap.fromTiles(rows);
}

const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

// Each resource tile sits on grass with its six neighbours under water, so the
// ONLY hex carrying a nonzero rate sum is the resource tile itself: the rate
// sums the planner compares are exactly RESOURCE_YIELD[resource].
function isolatedResourceMap(
  width: number,
  height: number,
  tiles: Array<[number, number, string]>,
): GameMap {
  const blocked = new Set<string>();
  for (const [q, r] of tiles) {
    for (const [dq, dr] of AXIAL_DIRS) blocked.add(`${q + dq},${r + dr}`);
  }
  return gridMap(width, height, {
    terrain: (q, r) => (blocked.has(`${q},${r}`) ? "water" : "grass"),
    resources: tiles,
  });
}

function seededRng(seed: number) {
  const rand = mulberry32(seed);
  let draws = 0;
  return {
    rng: () => {
      draws++;
      return rand();
    },
    draws: () => draws,
  };
}

test("pickCharterAction returns null on a short purse and consumes no rng", () => {
  const rng = seededRng(1);
  const map = gridMap(16, 16);

  const action = pickCharterAction(charterState({ gold: CHARTER_GOLD_COST - 1 }), "h1", map, rng.rng);

  assert.equal(action, null, "the shared gate rejects the hero before any planning");
  assert.equal(rng.draws(), 0, "a gate failure must not advance the rng stream");
});

test("pickCharterAction returns null on short warehouse wood and consumes no rng", () => {
  const rng = seededRng(1);
  const map = gridMap(16, 16);

  const action = pickCharterAction(charterState({}, { wood: 19, stone: 15 }), "h1", map, rng.rng);

  assert.equal(action, null);
  assert.equal(rng.draws(), 0);
});

test("pickCharterAction returns null on short warehouse stone and consumes no rng", () => {
  const rng = seededRng(1);
  const map = gridMap(16, 16);

  const action = pickCharterAction(charterState({}, { wood: 20, stone: 14 }), "h1", map, rng.rng);

  assert.equal(action, null);
  assert.equal(rng.draws(), 0);
});

test("pickCharterAction returns null when the hero stands off a friendly settlement", () => {
  const rng = seededRng(1);
  const state = makeState({
    heroes: [makeHero("h1", 1, 8, 9, { gold: CHARTER_GOLD_COST })],
    settlements: [makeSettlement("s1", 1, 8, 8, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) })],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });

  assert.equal(pickCharterAction(state, "h1", gridMap(16, 16), rng.rng), null);
  assert.equal(rng.draws(), 0);
});

test("pickCharterAction returns null when the hero is already chartering", () => {
  const rng = seededRng(1);

  const action = pickCharterAction(
    charterState({ isChartering: true, charterId: "c0" }),
    "h1",
    gridMap(16, 16),
    rng.rng,
  );

  assert.equal(action, null);
  assert.equal(rng.draws(), 0);
});

test("pickCharterAction returns null when no valid hex exists at all", () => {
  const rng = seededRng(1);
  // Passable only within distance 3 of the settlement: the shared <4 rule
  // leaves the valid set empty.
  const map = gridMap(16, 16, {
    terrain: (q, r) => (hexDistance({ q, r }, { q: 8, r: 8 }) <= 3 ? "grass" : "water"),
  });

  const action = pickCharterAction(charterState(), "h1", map, rng.rng);

  assert.equal(action, null);
  assert.equal(rng.draws(), 0, "an empty candidate set returns before the name is drawn");
});

test("pickCharterAction returns null when the only valid hexes sit beyond CHARTER_TARGET_REACH", () => {
  const rng = seededRng(1);
  // Passable only at distance >= 9 from the settlement: valid hexes exist, but
  // none is within the planner's reach cap.
  const map = gridMap(20, 20, {
    terrain: (q, r) => (q === 8 && r === 8) || hexDistance({ q, r }, { q: 8, r: 8 }) >= 9 ? "grass" : "water",
  });

  const action = pickCharterAction(charterState(), "h1", map, rng.rng);

  assert.equal(action, null);
  assert.equal(rng.draws(), 0);
});

test("pickCharterAction picks the highest-production hex over a nearer barren one", () => {
  const map = isolatedResourceMap(16, 16, [
    [4, 4, "gold"], // rate sum 20, distance 8 (the reach boundary)
    [8, 1, "wood"], // rate sum 15, distance 7 (nearer, but poorer)
  ]);

  const action = pickCharterAction(charterState(), "h1", map, () => 0);

  assert.ok(action);
  assert.equal(action!.targetQ, 4, "rates-first: the gold hex wins despite being farther");
  assert.equal(action!.targetR, 4);
  assert.equal(action!.heroId, "h1");
});

test("pickCharterAction breaks equal rate sums by distance to the hero", () => {
  const map = isolatedResourceMap(16, 16, [
    [8, 1, "gold"], // distance 7
    [4, 4, "gold"], // distance 8
  ]);

  const action = pickCharterAction(charterState(), "h1", map, () => 0);

  assert.ok(action);
  assert.deepEqual({ q: action!.targetQ, r: action!.targetR }, { q: 8, r: 1 }, "the nearer of two equal-rate hexes wins");
});

test("pickCharterAction breaks equal rate and distance ties by record order (q, then r)", () => {
  const byQ = isolatedResourceMap(16, 16, [
    [15, 8, "gold"], // distance 7
    [8, 1, "gold"], // distance 7
  ]);
  const byR = isolatedResourceMap(16, 16, [
    [8, 15, "gold"], // distance 7
    [8, 1, "gold"], // distance 7
  ]);

  const first = pickCharterAction(charterState(), "h1", byQ, () => 0);
  const second = pickCharterAction(charterState(), "h1", byR, () => 0);

  assert.ok(first);
  assert.ok(second);
  assert.deepEqual({ q: first!.targetQ, r: first!.targetR }, { q: 8, r: 1 }, "smaller q wins the exact tie");
  assert.deepEqual({ q: second!.targetQ, r: second!.targetR }, { q: 8, r: 1 }, "equal q falls through to smaller r");
});

test("pickCharterAction never targets a hex beyond CHARTER_TARGET_REACH", () => {
  assert.equal(CHARTER_TARGET_REACH, 8);
  const map = isolatedResourceMap(18, 18, [
    [8, 17, "gold"], // distance 9: beyond the cap, and record-order-first
    [15, 8, "gold"], // distance 7: the best legal choice
  ]);

  const action = pickCharterAction(charterState(), "h1", map, () => 0);

  assert.ok(action);
  assert.deepEqual(
    { q: action!.targetQ, r: action!.targetR },
    { q: 15, r: 8 },
    "the out-of-reach hex is filtered out even though it would win the record-order tie-break",
  );
});

test("pickCharterAction draws a deterministic name per rng seed and exactly two draws", () => {
  const map = isolatedResourceMap(16, 16, [[4, 4, "gold"]]);

  const first = seededRng(42);
  const second = seededRng(42);
  const a = pickCharterAction(charterState(), "h1", map, first.rng);
  const b = pickCharterAction(charterState(), "h1", map, second.rng);

  assert.ok(a);
  assert.ok(b);
  assert.deepEqual(a, b, "the same seed plans the identical action, name included");
  assert.equal(first.draws(), 2, "one draw for the name prefix, one for the suffix");
  assert.equal(second.draws(), 2);
  assert.match(a!.settlementName, /^[A-Z][a-z]+ [a-z]+$/, "the name comes from the player wordlists");
});

test("a hero with residual movement < 1 returns null and consumes 0 RNG draws", () => {
  const map = grassMap(12, 12);
  const state = aiTurnState([
    makeHero("h0", 0, 11, 11),
    makeHero("h1", 1, 2, 2, { movementRemaining: 0.4 }),
  ]);
  const rng = seededRng(7);

  const move = pickAiMove(state, "h1", map, rng.rng);

  assert.equal(move, null);
  assert.equal(rng.draws(), 0);
});

test("on an epic (120x90) grass map with no targets in reach, pickAiMove returns a 1-hex wander step in 2 RNG draws", () => {
  const map = grassMap(120, 90);
  const state = aiTurnState([
    makeHero("h0", 0, 119, 89),
    makeHero("h1", 1, 60, 45),
  ]);
  const rng = seededRng(19);

  const move = pickAiMove(state, "h1", map, rng.rng);

  assert.ok(move);
  assert.equal(hexDistance(move!.toTile, { q: 60, r: 45 }), 1);
  assert.equal(move!.cost, 1);
  assert.equal(rng.draws(), 2);
});
