import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHARTER_MIN_SETTLEMENT_DISTANCE,
  CHARTER_PURSE_HINT,
  CHARTER_TARGET_REACH,
  GameMap,
  evaluateCharterRequirements,
  hexDistance,
  validCharterHexes,
} from "@heroes/engine";
import type { Terrain, TileRow } from "@heroes/engine";
import { emptyWarehouse, makeCharter, makeHero, makeSettlement, makeState } from "../charter/_helpers";

// ---------------------------------------------------------------------------
// The shared gate: this suite mirrors test/screens/adventure/charterRequirements.test.ts
// pin-for-pin against the engine module the client file now delegates to
// (src/screens/adventure/charterRequirements.ts), so the two copies of the
// evaluator cannot drift apart.
// ---------------------------------------------------------------------------

function passingState() {
  return makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
}

test("all requirements met passes with no missing entries or hints", () => {
  const reqs = evaluateCharterRequirements(passingState(), "h0");
  assert.equal(reqs.canStart, true);
  assert.deepEqual(reqs.missing, []);
  assert.deepEqual(reqs.hints, []);
});

test("no hero selected is the only failure reported", () => {
  const reqs = evaluateCharterRequirements(passingState(), null);
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["No hero selected"]);
  assert.deepEqual(reqs.hints, []);
});

test("a hero already chartering fails on that requirement alone", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500, isChartering: true })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Hero is already chartering"]);
});

test("a hero off any friendly settlement fails on that requirement alone", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 7, 5, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Hero must stand on a friendly settlement"]);
});

test("a short purse reports the exact missing row and the withdraw hint", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 300 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Purse 300/2500g"]);
  assert.deepEqual(reqs.hints, [
    "Withdraw gold from a friendly settlement's treasury — your hero must stand on it (hero panel → Withdraw all)",
  ]);
  assert.equal(CHARTER_PURSE_HINT, reqs.hints[0]);
});

test("short warehouse wood is reported with current and required values", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 12, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Warehouse wood 12/20"]);
  assert.deepEqual(reqs.hints, []);
});

test("short warehouse stone is reported with current and required values", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 10 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Warehouse stone 10/15"]);
  assert.deepEqual(reqs.hints, []);
});

test("multiple shortfalls accumulate in a stable order with the purse hint", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 300 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 12, stone: 10 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, [
    "Purse 300/2500g",
    "Warehouse wood 12/20",
    "Warehouse stone 10/15",
  ]);
  assert.deepEqual(reqs.hints, [CHARTER_PURSE_HINT]);
});

test("requirement rows carry pass/fail state for every check", () => {
  const reqs = evaluateCharterRequirements(passingState(), "h0");
  assert.deepEqual(
    reqs.rows.map((r) => [r.label, r.ok, r.detail]),
    [
      ["Hero selected", true, "h0"],
      ["Not already chartering", true, "Ready"],
      ["On friendly settlement", true, "Standing on s0"],
      ["Purse", true, "2500/2500g"],
      ["Warehouse wood", true, "20/20"],
      ["Warehouse stone", true, "15/15"],
    ],
  );
});

// ---------------------------------------------------------------------------
// validCharterHexes: the shared placement rule (GameEngine.computeValidCharterHexes
// delegates here, and the AI planner consumes the same set). Rule: passable,
// not a settlement / charter target / hero tile, and at least
// CHARTER_MIN_SETTLEMENT_DISTANCE (=4) hexes from every settlement.
// ---------------------------------------------------------------------------

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

function settlementOnlyState(settlements: ReturnType<typeof makeSettlement>[], heroes: ReturnType<typeof makeHero>[] = []) {
  return makeState({ heroes, settlements });
}

test("validCharterHexes enforces the dist-3 / dist-4 boundary around every settlement", () => {
  assert.equal(CHARTER_MIN_SETTLEMENT_DISTANCE, 4);
  const map = gridMap(12, 12);
  const state = settlementOnlyState([makeSettlement("s0", 0, 4, 4)]);

  const hexes = validCharterHexes(state, map);

  // distance 3 from (4,4) — one short of the minimum
  for (const key of ["7,4", "4,7", "1,4", "4,1", "6,5", "5,6", "1,7", "7,1", "3,3"]) {
    assert.equal(hexes.has(key), false, `${key} at distance 3 must be excluded`);
  }
  assert.equal(hexes.has("4,4"), false, "the settlement tile itself is excluded");

  // distance exactly 4 — the boundary is inclusive
  for (const key of ["8,4", "4,8", "0,4", "4,0", "6,6", "0,8", "8,0", "7,7", "0,0"]) {
    assert.equal(hexes.has(key), true, `${key} at distance 4 must be valid`);
  }
});

test("validCharterHexes excludes impassable hexes even at legal distance", () => {
  const map = gridMap(12, 12, {
    terrain: (q, r) => {
      if (q === 8 && r === 4) return "water";
      if (q === 4 && r === 8) return "mountain";
      return "grass";
    },
  });
  const state = settlementOnlyState([makeSettlement("s0", 0, 4, 4)]);

  const hexes = validCharterHexes(state, map);

  assert.equal(hexes.has("8,4"), false, "a water hex at distance 4 is not a legal target");
  assert.equal(hexes.has("4,8"), false, "a mountain hex at distance 4 is not a legal target");
  assert.equal(hexes.has("9,4"), true, "the passable hex beside it is still valid");
  assert.equal(hexes.has("0,8"), true, "other distance-4 hexes are unaffected");
});

test("validCharterHexes excludes every settlement tile, not just the provisioning one", () => {
  const map = gridMap(12, 12);
  const state = settlementOnlyState([makeSettlement("s0", 0, 4, 4), makeSettlement("s1", 1, 10, 10)]);

  const hexes = validCharterHexes(state, map);

  assert.equal(hexes.has("10,10"), false, "the second settlement tile is excluded even though it clears the first's distance ring");
  assert.equal(hexes.has("0,0"), true, "a far hex is valid");
});

test("validCharterHexes excludes tiles already targeted by an active charter", () => {
  const map = gridMap(12, 12);
  const state = makeState({
    heroes: [],
    settlements: [makeSettlement("s0", 0, 4, 4)],
    activeCharters: [makeCharter({ id: "c0", heroId: "h1", ownerId: 1, targetQ: 8, targetR: 4 })],
  });

  const hexes = validCharterHexes(state, map);

  assert.equal(hexes.has("8,4"), false, "a chartered target is taken even at legal distance");
  assert.equal(hexes.has("9,4"), true, "the hex beside it is still valid");
});

test("validCharterHexes excludes every hero tile, the founding hero included", () => {
  const map = gridMap(12, 12);
  const state = settlementOnlyState(
    [makeSettlement("s0", 0, 4, 4)],
    [makeHero("h0", 0, 8, 4), makeHero("h1", 1, 9, 4)],
  );

  const hexes = validCharterHexes(state, map);

  assert.equal(hexes.has("8,4"), false, "the chartering hero's own tile is excluded");
  assert.equal(hexes.has("9,4"), false, "a foreign hero's tile is excluded too");
  assert.equal(hexes.has("10,4"), true, "unoccupied hexes at legal distance stay valid");
});

test("validCharterHexes is deterministic for the same state and map", () => {
  const map = gridMap(12, 12);
  const state = settlementOnlyState(
    [makeSettlement("s0", 0, 4, 4), makeSettlement("s1", 1, 10, 10)],
    [makeHero("h0", 0, 8, 4), makeHero("h1", 1, 9, 4)],
  );

  assert.deepEqual(validCharterHexes(state, map), validCharterHexes(state, map));
});

test("validCharterHexes applies no hero-reach cap: that cap is the AI planner's own", () => {
  assert.equal(CHARTER_TARGET_REACH, 8);
  const map = gridMap(24, 18);
  const state = settlementOnlyState([makeSettlement("s0", 0, 2, 2)], [makeHero("h0", 0, 2, 2)]);

  const hexes = validCharterHexes(state, map);

  assert.ok(
    hexDistance({ q: 2, r: 2 }, { q: 20, r: 10 }) > CHARTER_TARGET_REACH,
    "the far hex lies beyond the planner's reach cap",
  );
  assert.equal(hexes.has("20,10"), true, "validCharterHexes still reports it: the cap lives in pickCharterAction, not here");
  assert.equal(hexes.has("2,2"), false, "the hero's own tile (the settlement) is still excluded");
});
