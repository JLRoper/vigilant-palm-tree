import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CLASSIC_MODE_DEFAULTS,
  DEFAULT_GAME_MODE,
  MOVEMENT_PER_TURN,
  SETTLERS_MODE_DEFAULTS,
  coveredWagonIdFor,
  gameModeSettings,
  hexDistance,
  isGameMode,
  resolveGameMode,
  type GameModeSettings,
} from "@heroes/contracts";
import {
  CURRENT_MAP_GEN_VERSION,
  FOUND_SETTLEMENT_REFUSALS,
  SETTLERS_STREAM_PREFIX,
  buildInitialGameState,
  canFoundSettlement,
  createInitialState,
  foundedSettlementBuildings,
  foundSettlement,
  getOrCreateGameMap,
  hashString,
  hydrateGameState,
  makeInitialStatePayload,
  mulberry32,
  placeSettlersStarts,
  settlersStreamKey,
  settlersStreamRng,
  wagonSuppliesFor,
  type MapSize,
} from "@heroes/engine";

// The settlers game mode's pin (SETTLERS-PLAN.md §2.3, §2.4) plus the phase-1
// rules that ride it.
//
// Two guarantees, both about NOT moving what already exists:
//
//   1. an existing seed's grid and its seeded entities are byte-identical
//      (terrain, rivers, resource deposits, castle/neutral positions, names,
//      horse variants, city spots, districts) -- a digest pin, not a
//      re-implementation, so ANY generation change fails here first;
//   2. settlers placement draws from its own stream
//      (mulberry32(hashString("settlers:<seed>:<id>"))) and from nothing else.
//
// The classic-mode digests below are the baseline every later phase is
// measured against: if a later edit moves them, that edit re-rolled every save
// in flight and must be redesigned (add a pass for the new version, never
// mutate an existing one).

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

// ── 1. Existing seeds are untouched ──

const GRID_PINS: readonly { seed: number; size: MapSize; digest: string }[] = [
  { seed: 42, size: "small", digest: "ba546e362edba6c4" },
  { seed: 7, size: "medium", digest: "1b7c4f65ec4ccf40" },
];

test("the generated grid of an existing seed is byte-identical", () => {
  for (const pin of GRID_PINS) {
    const map = getOrCreateGameMap(pin.seed, pin.size, CURRENT_MAP_GEN_VERSION);
    const shape = {
      width: map.width,
      height: map.height,
      tiles: map.tiles,
      resourceTiles: map.placedResourceTiles,
      rivers: map.placedRivers,
    };
    const actual = digest(shape);
    console.log(`[pin] grid ${pin.seed}/${pin.size} = ${actual}`);
    assert.equal(
      actual,
      pin.digest,
      `the grid for seed ${pin.seed} (${pin.size}) moved -- a generation pass or a MapGenVersion changed`,
    );
  }
});

function seedPayload(seed: number, size: MapSize = "small") {
  const map = getOrCreateGameMap(seed, size, CURRENT_MAP_GEN_VERSION);
  return makeInitialStatePayload(map, mulberry32(seed ^ 0x706c6179), {
    playerCount: 3,
    humanSeatCount: 1,
  });
}

const ENTITY_PIN = "f33d24e92e845b36";
const NEUTRAL_PIN = 2;

test("the seeded entities of an existing seed are byte-identical", () => {
  const payload = seedPayload(42);
  const actual = digest(payload);
  console.log(`[pin] entities 42/small = ${actual}`);
  console.log(`[pin] neutrals = ${Object.values(payload.settlements).filter((s) => s.ownerId === null).length}`);
  assert.equal(
    actual,
    ENTITY_PIN,
    "castle placement / settlement creation / hero seeding moved for an existing seed",
  );
  assert.deepEqual(seedPayload(42), payload, "two builds of one seed must be identical");
});

test("neutral castles still spawn in the wilderness (design answer 4)", () => {
  const neutrals = Object.values(seedPayload(42).settlements).filter((s) => s.ownerId === null);
  assert.equal(
    neutrals.length,
    NEUTRAL_PIN,
    "the wilderness must still hold its neutral castles: they are entity seeding, and settlers mode does not suppress them",
  );
  assert.ok(
    neutrals.every((s) => s.ownerId === null && typeof s.q === "number" && typeof s.r === "number"),
    "a neutral castle is a settlement with no owner, at a real hex",
  );
});

// ── 2. The settlers stream is its own ──

const STREAM_PIN: readonly number[] = [
  0.7702564157079905,
  0.66468665888533,
  0.25231543462723494,
  0.623929301276803,
];

function take(rng: () => number, n: number): number[] {
  return Array.from({ length: n }, () => rng());
}

test("the settlers stream is keyed mulberry32(hashString(\"settlers:<seed>:<id>\"))", () => {
  const key = settlersStreamKey(42, "p0");
  assert.equal(SETTLERS_STREAM_PREFIX, "settlers");
  assert.equal(key, "settlers:42:p0");

  const values = take(settlersStreamRng(42, "p0"), 4);
  console.log(`[pin] settlers 42/p0 = ${JSON.stringify(values)}`);
  assert.deepEqual(values, [...STREAM_PIN], "the stream's own values moved");

  const replay = mulberry32(hashString(key));
  assert.deepEqual(
    values,
    take(replay, 4),
    "the stream must be exactly mulberry32(hashString(key)) -- no extra mixing",
  );
});

test("the settlers stream is per-entity and per-seed, and replays identically", () => {
  const base = take(settlersStreamRng(42, "p0"), 4);
  assert.deepEqual(take(settlersStreamRng(42, "p0"), 4), base, "same id replays");
  assert.notDeepEqual(take(settlersStreamRng(42, "p1"), 4), base, "another entity, another stream");
  assert.notDeepEqual(take(settlersStreamRng(43, "p0"), 4), base, "another seed, another stream");
});

test("the settlers stream is not the map's or the castle seed's stream", () => {
  const values = take(settlersStreamRng(42, "p0"), 4);
  assert.notDeepEqual(take(mulberry32(42), 4), values, "not the map seed's own stream");
  assert.notDeepEqual(take(mulberry32(42 ^ 0x706c6179), 4), values, "not the creation stream");
});

// ── 3. The mode vocabulary, as the engine sees it ──

test("an absent or unreadable mode reads as classic", () => {
  assert.equal(DEFAULT_GAME_MODE, "classic");
  assert.equal(isGameMode("settlers"), true);
  assert.equal(isGameMode("sandbox"), false);
  assert.equal(resolveGameMode(undefined), "classic");
  assert.equal(resolveGameMode(null), "classic");
  assert.equal(resolveGameMode("settlers"), "settlers");
  assert.equal(gameModeSettings("settlers"), SETTLERS_MODE_DEFAULTS);
  assert.equal(gameModeSettings("classic").minFoundingDistance, 0);
  assert.equal(gameModeSettings(undefined), gameModeSettings("classic"));
});

test("the founding refusal vocabulary is one pinned list", () => {
  assert.deepEqual([...FOUND_SETTLEMENT_REFUSALS], [
    "not_settlers_mode",
    "founder_not_at_tile",
    "tile_impassable",
    "occupied",
    "too_close_to_settlement",
  ]);
});

// ── 4. Start placement: one wagon per seat, wilderness bare of seat towns ──

const SEED = 42;
const PLAYERS = 3;
const HUMANS = 1;

function settlersPayload(seed = SEED, playerCount = PLAYERS, humanSeatCount = HUMANS) {
  const map = getOrCreateGameMap(seed, "small", CURRENT_MAP_GEN_VERSION);
  return makeInitialStatePayload(map, mulberry32(seed ^ 0x706c6179), {
    playerCount,
    humanSeatCount,
    gameMode: "settlers",
    mapSeed: seed,
  });
}

test("a settlers game seeds bare wilderness: no seat owns a town, and the neutrals remain", () => {
  const payload = settlersPayload();
  const seatSettlements = Object.values(payload.settlements).filter((s) => s.ownerId !== null);
  assert.deepEqual(
    seatSettlements.map((s) => s.id),
    [],
    "a settlers seat must start with no pre-existing town, settlement or castle (§2.1: this is entity seeding, not terrain)",
  );
  const neutrals = Object.values(payload.settlements).filter((s) => s.ownerId === null);
  assert.equal(neutrals.length, NEUTRAL_PIN, "the neutral castles are still capture objectives (answer 4)");
  // The classic seeding of the SAME seed still has its seat castles -- the mode
  // is a gate on the entity pass, not a change to the map or to classic.
  const classicOwned = Object.values(seedPayload(SEED).settlements).filter((s) => s.ownerId !== null);
  assert.ok(
    classicOwned.length > 0,
    "classic mode still seeds starting castles owned by the seats",
  );
  assert.deepEqual(
    [...new Set(classicOwned.map((s) => s.ownerId))].sort(),
    [0, 1, 2],
    "every seat owns at least one starting castle in classic mode",
  );
});

test("a settlers game seeds one covered wagon per seat, carrying the starter supplies", () => {
  const payload = settlersPayload();
  const wagons = Object.values(payload.heroes);
  assert.equal(wagons.length, PLAYERS, "one wagon per seat, human and AI alike");
  for (const wagon of wagons) {
    assert.equal(wagon.id, coveredWagonIdFor(wagon.ownerId), "a wagon's id is p<seat>-wagon");
    assert.equal(wagon.name, "Covered Wagon");
    assert.equal(wagon.troops, 0, "a wagon carries no army");
    assert.deepEqual(wagon.stacks, []);
    assert.deepEqual(wagon.resources, SETTLERS_MODE_DEFAULTS.wagonSupplies, "the mode's supplies ride as cargo");
    assert.equal(wagon.movementRemaining, MOVEMENT_PER_TURN, "wagon movement is a hero's");
  }
  for (const player of payload.players) {
    assert.deepEqual(player.heroIds, [coveredWagonIdFor(player.id)], "the seat's roster entry IS its wagon");
    assert.deepEqual(player.settlementIds, []);
  }
});

test("a settlers start is bare terrain, spaced apart, and reproducible from (mapSeed, seat)", () => {
  const map = getOrCreateGameMap(SEED, "small", CURRENT_MAP_GEN_VERSION);
  const starts = placeSettlersStarts({
    seed: SEED,
    size: "small",
    playerCount: PLAYERS,
    humanSeatCount: HUMANS,
    mode: "settlers",
    map,
  });
  assert.equal(starts.length, PLAYERS);
  assert.deepEqual(
    starts.map((s) => s.streamId),
    [0, 1, 2].map((seat) => settlersStreamKey(SEED, coveredWagonIdFor(seat))),
    "each start names the stream it was drawn from",
  );
  for (const start of starts) {
    const terrain = map.get(start.q, start.r);
    assert.ok(terrain && map.isPassable(start.q, start.r), "a wagon starts on passable ground");
    assert.equal(map.riverAt(start.q, start.r), undefined, "not on a river tile");
    assert.equal(map.resourceTileAt(start.q, start.r), undefined, "not on a resource deposit");
  }
  const minDistance = SETTLERS_MODE_DEFAULTS.minFoundingDistance;
  for (const a of starts) {
    for (const b of starts) {
      if (a === b) continue;
      assert.ok(
        hexDistance({ q: a.q, r: a.r }, { q: b.q, r: b.r }) >= minDistance,
        "seats start at least minFoundingDistance apart",
      );
    }
    for (const neutral of Object.values(settlersPayload().settlements)) {
      assert.ok(
        hexDistance({ q: a.q, r: a.r }, { q: neutral.q, r: neutral.r }) >= minDistance,
        "a start is never inside the founding dead zone of a neutral castle",
      );
    }
  }
  // Replaying is exact, and one seat's start does not depend on how many seats
  // follow it (the stream is per-entity, not a shared cursor).
  const replay = placeSettlersStarts({
    seed: SEED,
    size: "small",
    playerCount: PLAYERS,
    humanSeatCount: HUMANS,
    mode: "settlers",
    map,
  });
  assert.deepEqual(replay, starts);
  const solo = placeSettlersStarts({
    seed: SEED,
    size: "small",
    playerCount: 1,
    humanSeatCount: 1,
    mode: "settlers",
    map,
  });
  assert.deepEqual(solo[0], starts[0], "seat 0's start is (mapSeed, seat 0)'s alone");
  const otherSeed = placeSettlersStarts({
    seed: SEED + 1,
    size: "small",
    playerCount: PLAYERS,
    humanSeatCount: HUMANS,
    mode: "settlers",
    map,
  });
  assert.notDeepEqual(otherSeed, starts, "another map seed, another placement");
});

// ── 5. Founding ──

function settlersState(seed = SEED) {
  const map = getOrCreateGameMap(seed, "small", CURRENT_MAP_GEN_VERSION);
  const state = buildInitialGameState(map, mulberry32(seed ^ 0x706c6179), {
    playerCount: PLAYERS,
    humanSeatCount: HUMANS,
    gameMode: "settlers",
    mapSeed: seed,
  });
  return { map, state };
}

/** The same state, with the founder relocated (for the position/terrain refusals). */
function withFounderAt(state: ReturnType<typeof settlersState>["state"], founderId: string, q: number, r: number) {
  return { ...state, heroes: { ...state.heroes, [founderId]: { ...state.heroes[founderId], q, r } } };
}

test("hydration carries the mode, and a row without one stays a classic state key-for-key", () => {
  const { state } = settlersState();
  const row = {
    seed: SEED,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: state.players,
    heroes: state.heroes,
    settlements: state.settlements,
  };
  const classic = hydrateGameState(row);
  assert.equal("gameMode" in classic, false, "an absent lobby.gameMode leaves no key behind (§1: reads as classic)");
  assert.equal(resolveGameMode(classic.gameMode), "classic");

  const settlers = hydrateGameState({ ...row, gameMode: "settlers" });
  assert.equal(settlers.gameMode, "settlers", "the row's mode reaches every mode-dependent rule");
  // And the hydrated settlers state can actually found: the mode is not just a
  // label on the state, it is what canFoundSettlement gates on.
  const wagon = settlers.heroes[coveredWagonIdFor(0)];
  const map = getOrCreateGameMap(SEED, "small", CURRENT_MAP_GEN_VERSION);
  assert.deepEqual(
    canFoundSettlement({ state: settlers, founderId: wagon.id, q: wagon.q, r: wagon.r, map }),
    { ok: true },
  );
});

test("a classic game refuses to found: founding is the settlers path", () => {
  const classic = createInitialState();
  const result = canFoundSettlement({ state: classic, founderId: "h0", q: 2, r: 2 });
  assert.deepEqual(result, { ok: false, reason: "not_settlers_mode" });
  const found = foundSettlement({ state: classic, founderId: "h0", q: 2, r: 2 });
  assert.equal(found.ok, false);
  assert.equal(found.ok === false && found.reason, "not_settlers_mode");
});

test("founding is refused off the founder's own hex, on occupied, impassable and too-close hexes", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];

  assert.deepEqual(
    canFoundSettlement({ state, founderId: wagon.id, q: 3, r: 3, map }),
    { ok: false, reason: "founder_not_at_tile" },
  );

  const neutral = Object.values(state.settlements).find((s) => s.ownerId === null)!;
  const onNeutral = withFounderAt(state, wagon.id, neutral.q, neutral.r);
  assert.deepEqual(
    canFoundSettlement({ state: onNeutral, founderId: wagon.id, q: neutral.q, r: neutral.r, map }),
    { ok: false, reason: "occupied" },
  );

  // A water tile: the wagon is standing on impassable terrain and cannot plant
  // a town there (the same candidate rule castle placement applies).
  let water: { q: number; r: number } | undefined;
  for (let r = 0; r < map.height && !water; r++) {
    for (let q = 0; q < map.width && !water; q++) {
      if (!map.isPassable(q, r)) water = { q, r };
    }
  }
  assert.ok(water, "the fixture map must have an impassable tile");
  const onWater = withFounderAt(state, wagon.id, water.q, water.r);
  assert.deepEqual(
    canFoundSettlement({ state: onWater, founderId: wagon.id, q: water.q, r: water.r, map }),
    { ok: false, reason: "tile_impassable" },
  );

  // One hex off a neutral castle: inside minFoundingDistance (3).
  let tooClose: { q: number; r: number } | undefined;
  for (let r = 0; r < map.height && !tooClose; r++) {
    for (let q = 0; q < map.width && !tooClose; q++) {
      const d = hexDistance({ q, r }, { q: neutral.q, r: neutral.r });
      if (d > 0 && d < SETTLERS_MODE_DEFAULTS.minFoundingDistance && map.isPassable(q, r)) {
        tooClose = { q, r };
      }
    }
  }
  assert.ok(tooClose, "the fixture map must have a hex inside a neutral's dead zone");
  const onTooClose = withFounderAt(state, wagon.id, tooClose.q, tooClose.r);
  assert.deepEqual(
    canFoundSettlement({ state: onTooClose, founderId: wagon.id, q: tooClose.q, r: tooClose.r, map }),
    { ok: false, reason: "too_close_to_settlement" },
  );
});

test("founding consumes the wagon and plants the settlement holding its supplies", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const seatsBefore = state.players[0].settlementIds.length;

  const result = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.consumedFounder, true, "answer 1: one wagon founds exactly one settlement");
  assert.equal(result.suppliesGranted, true);

  const settlement = result.state.settlements[result.settlementId];
  assert.ok(settlement, "the settlement exists at the returned id");
  assert.equal(settlement.ownerId, wagon.ownerId);
  assert.equal(settlement.q, wagon.q);
  assert.equal(settlement.r, wagon.r);
  assert.equal(settlement.level, 1);
  assert.deepEqual(settlement.warehouse, SETTLERS_MODE_DEFAULTS.wagonSupplies);
  assert.deepEqual(
    settlement.buildings,
    [],
    "answer 3: no free starter buildings; the city view's own starter commit is the only grant",
  );
  assert.ok(Object.keys(settlement.resourceRates).length > 0, "the town's rates come from its terrain");
  assert.equal(settlement.name.length > 0, true);

  // The wagon is gone, the seat's roster drops it, and the new town is listed.
  assert.equal(result.state.heroes[wagon.id], undefined, "the consumed wagon is removed");
  assert.deepEqual(result.state.players[0].heroIds, [], "the seat's roster no longer names the wagon");
  assert.deepEqual(
    result.state.players[0].settlementIds,
    [...state.players[0].settlementIds, result.settlementId],
  );
  assert.equal(result.state.players[0].settlementIds.length, seatsBefore + 1);
  assert.equal(result.state.nextSettlementId, state.nextSettlementId + 1, "the id counter moves with it");
  assert.equal(result.state.dirty, true);

  // A second founding there is refused: the hex is now occupied, whatever
  // founder tries it (seat 1's wagon, walked onto the new town's hex).
  const onTown = withFounderAt(result.state, coveredWagonIdFor(1), wagon.q, wagon.r);
  const again = foundSettlement({
    state: onTown,
    founderId: coveredWagonIdFor(1),
    q: wagon.q,
    r: wagon.r,
    map,
  });
  assert.equal(again.ok, false);
  assert.equal(again.ok === false && again.reason, "occupied");
});

test("the founding rule reads the mode's keys: consumption and supplies", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const original = SETTLERS_MODE_DEFAULTS.wagonConsumedOnFounding;
  try {
    SETTLERS_MODE_DEFAULTS.wagonConsumedOnFounding = false;
    const result = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.consumedFounder, false, "flipping the key flips the rule");
    assert.ok(result.state.heroes[wagon.id], "the wagon survives when the mode says so");
    assert.deepEqual(result.state.players[0].heroIds, [wagon.id]);
  } finally {
    SETTLERS_MODE_DEFAULTS.wagonConsumedOnFounding = original;
  }
});

test("a founded settlement's content is derived from the founder's own streams, not from a payload", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const first = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  const second = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(
    first.state.settlements[first.settlementId],
    second.state.settlements[second.settlementId],
    "the same founder on the same hex founds the same town, byte for byte",
  );
});

// ── 6. Every mode key flips its own rule (W7 deliverable #4) ──
//
// SETTLERS-PLAN.md §3's four answers ARE these keys, and the mode's whole
// behaviour is meant to move with them (packages/contracts/src/gameMode.ts:
// "flipping one here (plus its assertion) is the whole change when the reader
// answers differently"). W7's finding M1 was that only
// `wagonConsumedOnFounding` had a flip test -- the one above -- while the other
// keys were only READ inside assertions, so the assertion moved with the
// constant and proved nothing about the rule. Each test below mutates the key,
// runs the RULE, and asserts the outcome flipped, restoring the constant in a
// `finally`.

/** The six keys, in one list: a new key without a flip test goes red here. */
const MODE_KEYS = [
  "wagonConsumedOnFounding",
  "minFoundingDistance",
  "wagonSupplies",
  "freeStarterBuildings",
  "neutralCastles",
  "monsterLairs",
] as const;

/** Run `fn` with one mode key replaced, always restoring it. */
function flipModeKey<T>(key: keyof GameModeSettings, value: unknown, fn: () => T): T {
  const settings = SETTLERS_MODE_DEFAULTS as unknown as Record<string, unknown>;
  const original = settings[key];
  try {
    settings[key] = value;
    return fn();
  } finally {
    settings[key] = original;
  }
}

test("the key set is exactly the pinned list, on both modes", () => {
  assert.deepEqual(
    Object.keys(SETTLERS_MODE_DEFAULTS).sort(),
    [...MODE_KEYS].sort(),
    "a settlers key appeared or vanished without a flip test",
  );
  assert.deepEqual(
    Object.keys(CLASSIC_MODE_DEFAULTS).sort(),
    [...MODE_KEYS].sort(),
    "classic and settlers must declare the same keys (the neutral values are what a mode-blind rule falls back to)",
  );
});

test("flipping minFoundingDistance flips founding AND start spacing (L2's boundary)", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const neutral = Object.values(state.settlements).find((s) => s.ownerId === null);
  assert.ok(neutral, "the fixture map must hold a neutral castle");

  // A passable hex inside the default dead zone of a neutral castle.
  let inside: { q: number; r: number } | undefined;
  for (let r = 0; r < map.height && !inside; r++) {
    for (let q = 0; q < map.width && !inside; q++) {
      const d = hexDistance({ q, r }, { q: neutral.q, r: neutral.r });
      if (d > 0 && d < 3 && map.isPassable(q, r)) inside = { q, r };
    }
  }
  assert.ok(inside, "the fixture map must have a hex inside a neutral's dead zone");
  const onInside = withFounderAt(state, wagon.id, inside.q, inside.r);

  assert.deepEqual(
    canFoundSettlement({ state: onInside, founderId: wagon.id, q: inside.q, r: inside.r, map }),
    { ok: false, reason: "too_close_to_settlement" },
    "the default (3) refuses the dead zone",
  );

  const request = {
    seed: SEED,
    size: "small" as const,
    playerCount: 1,
    humanSeatCount: HUMANS,
    mode: "settlers" as const,
    map,
  };

  flipModeKey("minFoundingDistance", 0, () => {
    assert.deepEqual(
      canFoundSettlement({ state: onInside, founderId: wagon.id, q: inside.q, r: inside.r, map }),
      { ok: true },
      "flipping the key to 0 must make the too-close founding legal",
    );
    // The PLACEMENT's own read of the same key (W7's L2): 0 means "no spacing
    // rule", NOT "spacing clamped to 1". At 0 a start may land on a hex that is
    // in the blocked list, so re-running with its own hex blocked reproduces it
    // exactly -- at 1 the same hex is refused and the scan moves on.
    const free = placeSettlersStarts(request);
    const blockedByItself = placeSettlersStarts({
      ...request,
      occupied: [{ q: free[0].q, r: free[0].r }],
    });
    assert.deepEqual(
      blockedByItself,
      free,
      "at 0 the spacing rule is off: a start may land on a blocked hex",
    );
  });

  flipModeKey("minFoundingDistance", 1, () => {
    const free = placeSettlersStarts(request);
    const blockedByItself = placeSettlersStarts({
      ...request,
      occupied: [{ q: free[0].q, r: free[0].r }],
    });
    assert.notDeepEqual(
      blockedByItself,
      free,
      "at 1 the same blocked hex is skipped -- so 0 is genuinely unclamped, not 1",
    );
  });

  assert.throws(
    () =>
      flipModeKey("minFoundingDistance", 999, () =>
        placeSettlersStarts({ ...request, playerCount: PLAYERS }),
      ),
    /no legal starting hex/,
    "an unreachable spacing rule must stop the placement, not silently pack the seats together",
  );
});

test("flipping wagonSupplies flips the wagon's cargo and the founded warehouse", () => {
  const empty = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
  assert.deepEqual(wagonSuppliesFor("settlers"), SETTLERS_MODE_DEFAULTS.wagonSupplies);
  flipModeKey("wagonSupplies", empty, () => {
    for (const wagon of Object.values(settlersPayload().heroes)) {
      assert.deepEqual(wagon.resources, empty, "a flipped key must empty the starting cargo");
    }
    const { map, state } = settlersState();
    const wagon = state.heroes[coveredWagonIdFor(0)];
    const result = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.suppliesGranted, false, "an empty cargo is not a granted stockpile");
    assert.deepEqual(result.state.settlements[result.settlementId].warehouse, empty);
  });
});

test("flipping freeStarterBuildings hands the founded town the starter city", () => {
  assert.deepEqual(
    foundedSettlementBuildings("settlers", 1),
    [],
    "the mode's answer is NO: the city view's own starter commit is the only grant",
  );
  flipModeKey("freeStarterBuildings", true, () => {
    const buildings = foundedSettlementBuildings("settlers", 1);
    assert.ok(buildings.length > 0, "flipping the key must grant the starter layout");
    const { map, state } = settlersState();
    const wagon = state.heroes[coveredWagonIdFor(0)];
    const result = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.state.settlements[result.settlementId].buildings,
      buildings,
      "the founded town carries exactly the layout the flipped key grants",
    );
  });
});

test("flipping neutralCastles empties the wilderness, and leaves classic alone", () => {
  assert.equal(
    Object.values(settlersPayload().settlements).length,
    NEUTRAL_PIN,
    "the default keeps the neutral castles (design answer 4)",
  );
  flipModeKey("neutralCastles", false, () => {
    assert.deepEqual(
      Object.values(settlersPayload().settlements),
      [],
      "suppressing the neutrals is a filter over the generated castles: the board is left bare",
    );
    assert.equal(
      Object.values(seedPayload(SEED).settlements).filter((s) => s.ownerId === null).length,
      NEUTRAL_PIN,
      "the classic seeding does not read the settlers key",
    );
  });
});

test("monsterLairs is read by no rule yet: flipping it moves nothing", () => {
  // SETTLERS-PLAN.md §3's answer 4 is forward-looking -- no lair generator
  // exists in the codebase, so the key is declared and unread. This is the
  // honest flip test for it: the key exists on both modes, and flipping it
  // changes no seeded board. A lair generator that starts reading it fails
  // here, which is the point.
  assert.equal(SETTLERS_MODE_DEFAULTS.monsterLairs, true);
  assert.equal(CLASSIC_MODE_DEFAULTS.monsterLairs, true);
  const before = digest(settlersPayload());
  flipModeKey("monsterLairs", false, () => {
    assert.equal(
      digest(settlersPayload()),
      before,
      "no rule reads monsterLairs yet, so flipping it must not move the seeded board",
    );
  });
});
