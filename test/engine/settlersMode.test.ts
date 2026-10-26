import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CLASSIC_MODE_DEFAULTS,
  DEFAULT_GAME_MODE,
  MOVEMENT_PER_TURN,
  SETTLERS_MODE_DEFAULTS,
  coveredWagonIdFor,
  coveredWagonHeroIdFor,
  coveredWagonSeatOf,
  gameModeSettings,
  hexDistance,
  isGameMode,
  resolveGameMode,
  seatHeroIdFor,
  type GameModeSettings,
  type GameState,
  type SettlementState,
} from "@heroes/contracts";
import {
  CURRENT_MAP_GEN_VERSION,
  FOUND_SETTLEMENT_REFUSALS,
  SETTLERS_STREAM_PREFIX,
  applyPlaceBuildings,
  buildInitialGameState,
  buildStarterLayout,
  canFoundSettlement,
  cityViewSizeFor,
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
  starterCityOnOpen,
  wagonSuppliesFor,
  type GameMap,
  type MapSize,
} from "@heroes/engine";

// The settlers game mode's pin (SETTLERS-PLAN.md §2.3, §2.4) plus the phase-1
// rules that ride it -- now including the four CONFIRMED intentions the mode
// was audited against:
//
//   1. a settlers game is bare wilderness: no neutral town, settlement, castle
//      or building anywhere, and a founded settlement never comes with
//      prebuilt buildings (not at founding, not when its city view opens);
//   2. founding happens IN PLACE, on the hex the wagon already stands on --
//      there is no separate tile-selection step, and the rule admits no other
//      hex;
//   3. the wagon BECOMES the settlement's first hero (the same entity, renamed
//      `p<seat>-wagon` -> `p<seat>-hero`) instead of being deleted, and the
//      renamed hero can never found again.
//
// Two guarantees about NOT moving what already exists, unchanged by any of it:
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
// mutate an existing one). The mode gates ENTITY seeding only.

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

const EMPTY_WAREHOUSE = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };

// ── 1. Existing seeds are untouched ──

const GRID_PINS: readonly { seed: number; size: MapSize; digest: string }[] = [
  { seed: 42, size: "small", digest: "ba546e362edba6c4" },
  { seed: 7, size: "medium", digest: "1b7c4f65ec4ccf40" },
];

// The pick-up amounts a resource tile carries, pinned separately from the
// terrain pin above and deliberately NOT folded into it: the two pins mean
// different things. The grid pin asks "did a generation pass move the world
// for a seed that already exists" (only a redesign may change it); this one
// asks "did the seed+tile hash change" (only a new hash version may change it),
// and its digests were taken WITHOUT including the amount in the grid shape --
// which is why the grid digests above are the same values they were before
// pickups existed.
const AMOUNT_PINS: readonly { seed: number; size: MapSize; digest: string }[] = [
  { seed: 42, size: "small", digest: "42db022df1dd2858" },
  { seed: 7, size: "medium", digest: "a236b61cb4ae6f22" },
];

test("the generated grid of an existing seed is byte-identical", () => {
  for (const pin of GRID_PINS) {
    const map = getOrCreateGameMap(pin.seed, pin.size, CURRENT_MAP_GEN_VERSION);
    const shape = {
      width: map.width,
      height: map.height,
      tiles: map.tiles,
      // Deposit PLACEMENT (position + type) only. The pristine `amount` is a
      // field added after this pin existed and is derived from the seed rather
      // than drawn, so including it would change what the pin is measuring
      // without changing the world -- the amounts have their own pin below.
      resourceTiles: map.placedResourceTiles.map((t) => ({ q: t.q, r: t.r, resource: t.resource })),
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

test("the pick-up amount of a resource tile is stable for a seed, inside 5-500", () => {
  for (const pin of AMOUNT_PINS) {
    const map = getOrCreateGameMap(pin.seed, pin.size, CURRENT_MAP_GEN_VERSION);
    const amounts = map.placedResourceTiles.map((t) => ({
      q: t.q,
      r: t.r,
      resource: t.resource,
      amount: t.amount,
    }));
    const actual = digest(amounts);
    console.log(`[pin] amounts ${pin.seed}/${pin.size} = ${actual} (${amounts.length} tiles)`);
    assert.equal(actual, pin.digest, `the seed+tile amount hash changed for seed ${pin.seed}`);
    for (const a of amounts) {
      assert.ok(a.amount >= 5 && a.amount <= 500, `${a.q},${a.r} amount ${a.amount} is inside 5-500`);
    }
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
/** The classic seeding's neutral count for seed 42: entity seeding, not terrain. */
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

test("neutral castles are classic seeding: the classic board keeps them, a settlers board has none", () => {
  const neutrals = Object.values(seedPayload(42).settlements).filter((s) => s.ownerId === null);
  assert.equal(
    neutrals.length,
    NEUTRAL_PIN,
    "a classic game must still hold its neutral castles: they are entity seeding",
  );
  assert.ok(
    neutrals.every((s) => s.ownerId === null && typeof s.q === "number" && typeof s.r === "number"),
    "a neutral castle is a settlement with no owner, at a real hex",
  );
  assert.ok(
    neutrals.every((s) => s.buildings.length > 0),
    "…and a seeded castle still comes with its own buildings (classic is untouched)",
  );

  // Settlers: BARE wilderness -- no neutral castle, so no neutral town, no
  // seeded starter buildings and no startup districts either (all three are
  // downstream of the castle list). This is `neutralCastles: false` plus
  // init.ts's modeCastles filter; no generation pass is involved.
  assert.deepEqual(
    Object.values(settlersPayload(42).settlements),
    [],
    "a settlers game seeds no settlement at all -- owned or neutral, with buildings or without",
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
    "founder_not_a_wagon",
    "tile_impassable",
    "occupied",
    "too_close_to_settlement",
  ]);
});

test("the wagon id convention names a seat, and the hero id it converts to", () => {
  assert.equal(coveredWagonIdFor(0), "p0-wagon");
  assert.equal(seatHeroIdFor(0), "p0-hero");
  assert.equal(coveredWagonSeatOf("p0-wagon"), 0);
  assert.equal(coveredWagonSeatOf("p12-wagon"), 12);
  assert.equal(coveredWagonSeatOf("p0-hero"), null, "a hero id is not a wagon");
  assert.equal(coveredWagonSeatOf("p-wagon"), null, "no seat digits, no wagon");
  assert.equal(coveredWagonSeatOf("p1-wagonx"), null, "the suffix must be the whole tail");
  assert.equal(coveredWagonHeroIdFor("p2-wagon"), "p2-hero");
  assert.equal(coveredWagonHeroIdFor("h3"), null, "a recruited hero converts to nothing");
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

/** The fixture map every founding test measures against. */
function fixtureMap(): GameMap {
  return getOrCreateGameMap(SEED, "small", CURRENT_MAP_GEN_VERSION);
}

test("a settlers game seeds bare wilderness: no castle, town, settlement or building at all", () => {
  const payload = settlersPayload();
  assert.deepEqual(
    Object.values(payload.settlements),
    [],
    "a settlers board holds no settlement: no seat town, no neutral castle, and therefore no seeded starter buildings or districts",
  );
  assert.equal(
    Object.keys(payload.settlements).length,
    0,
    "…and no settlement id, so the first founded town is s0",
  );

  // The classic seeding of the SAME seed is untouched: the mode is a gate on
  // the entity pass, never a change to the map or to classic.
  const classic = Object.values(seedPayload(SEED).settlements);
  const classicOwned = classic.filter((s) => s.ownerId !== null);
  assert.ok(
    classicOwned.length > 0,
    "classic mode still seeds starting castles owned by the seats",
  );
  assert.equal(
    classic.filter((s) => s.ownerId === null).length,
    NEUTRAL_PIN,
    "…and its neutral castles",
  );
  assert.deepEqual(
    [...new Set(classicOwned.map((s) => s.ownerId))].sort(),
    [0, 1, 2],
    "every seat owns at least one starting castle in classic mode",
  );
  assert.ok(
    classicOwned.every((s) => s.buildings.length > 0),
    "…and each of them keeps the starter city classic has always seeded",
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
  const map = fixtureMap();
  const request = {
    seed: SEED,
    size: "small" as const,
    playerCount: PLAYERS,
    humanSeatCount: HUMANS,
    mode: "settlers" as const,
    map,
  };
  const starts = placeSettlersStarts(request);
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
  }
  // A settlers board carries no settlement, so the "also clear of the existing
  // towns" half of the rule is asserted against a board that HAS objectives:
  // the classic seeding's own castle hexes, handed to the placement as its
  // blocked list. Every start must still keep minFoundingDistance from them.
  const objectives = Object.values(seedPayload(SEED).settlements).map((s) => ({ q: s.q, r: s.r }));
  assert.ok(objectives.length > 0, "the classic fixture must have objectives to avoid");
  for (const start of placeSettlersStarts({ ...request, occupied: objectives })) {
    for (const o of objectives) {
      assert.ok(
        hexDistance({ q: start.q, r: start.r }, o) >= minDistance,
        "a start is never inside the founding dead zone of a settlement already on the board",
      );
    }
  }
  // Replaying is exact, and one seat's start does not depend on how many seats
  // follow it (the stream is per-entity, not a shared cursor).
  assert.deepEqual(placeSettlersStarts(request), starts);
  const solo = placeSettlersStarts({ ...request, playerCount: 1, humanSeatCount: 1 });
  assert.deepEqual(solo[0], starts[0], "seat 0's start is (mapSeed, seat 0)'s alone");
  const otherSeed = placeSettlersStarts({ ...request, seed: SEED + 1 });
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
function withFounderAt(state: GameState, founderId: string, q: number, r: number): GameState {
  return { ...state, heroes: { ...state.heroes, [founderId]: { ...state.heroes[founderId], q, r } } };
}

/**
 * A neutral castle, synthesized: a settlers board has none (that is the
 * point), but the SPACING and OCCUPANCY halves of the rule are measured
 * against settlements, so the refusal cases need a board that has one.
 */
function makeNeutral(id: string, q: number, r: number): SettlementState {
  return {
    id,
    name: id,
    ownerId: null,
    q,
    r,
    level: 2,
    population: 0,
    goldTax: 0,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { ...EMPTY_WAREHOUSE },
    citySpots: [],
    cityMines: [],
    morale: 100,
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: true,
    castleVariant: 0,
    buildings: [],
  };
}

function withNeutralAt(state: GameState, neutral: SettlementState): GameState {
  return { ...state, settlements: { ...state.settlements, [neutral.id]: neutral } };
}

/** A passable, dry, resource-free hex, at least `minDist` from every `avoid` hex. */
function findOpenHex(map: GameMap, avoid: Array<{ q: number; r: number }>, minDist = 4): { q: number; r: number } {
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (!map.isPassable(q, r)) continue;
      if (map.riverAt(q, r)) continue;
      if (map.resourceTileAt(q, r)) continue;
      if (avoid.some((a) => hexDistance({ q, r }, a) < minDist)) continue;
      return { q, r };
    }
  }
  throw new Error("findOpenHex: no legal founding hex on this fixture map");
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
  assert.deepEqual(
    canFoundSettlement({ state: settlers, founderId: wagon.id, q: wagon.q, r: wagon.r, map: fixtureMap() }),
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

  // IN PLACE: the founder's own hex is the only hex the rule ever admits --
  // there is no reach, so one hex off is `founder_not_at_tile` even on perfect
  // ground.
  const away = findOpenHex(map, [{ q: wagon.q, r: wagon.r }]);
  assert.deepEqual(
    canFoundSettlement({ state, founderId: wagon.id, q: away.q, r: away.r, map }),
    { ok: false, reason: "founder_not_at_tile" },
  );

  const neutral = makeNeutral("n0", 3, 3);
  const onNeutral = withFounderAt(withNeutralAt(state, neutral), wagon.id, neutral.q, neutral.r);
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
  const onTooClose = withFounderAt(withNeutralAt(state, neutral), wagon.id, tooClose.q, tooClose.r);
  assert.deepEqual(
    canFoundSettlement({ state: onTooClose, founderId: wagon.id, q: tooClose.q, r: tooClose.r, map }),
    { ok: false, reason: "too_close_to_settlement" },
  );
});

test("only a covered wagon founds: a recruited hero standing on legal ground is refused", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const legal = findOpenHex(map, [{ q: wagon.q, r: wagon.r }]);
  const withRecruit: GameState = {
    ...state,
    heroes: {
      ...state.heroes,
      h9: { ...wagon, id: "h9", name: "Recruit", ownerId: 0, q: legal.q, r: legal.r },
    },
    players: state.players.map((p) => (p.id === 0 ? { ...p, heroIds: [...p.heroIds, "h9"] } : p)),
  };
  assert.deepEqual(
    canFoundSettlement({ state: withRecruit, founderId: "h9", q: legal.q, r: legal.r, map }),
    { ok: false, reason: "founder_not_a_wagon" },
    "the rule is wagon-only: the client's gesture, the brain and the driver are not the only thing keeping a recruited hero out",
  );
  const refused = foundSettlement({ state: withRecruit, founderId: "h9", q: legal.q, r: legal.r, map });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.reason, "founder_not_a_wagon");
});

test("founding in place turns the wagon into the town's first hero instead of deleting it", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const seatsBefore = state.players[0].settlementIds.length;

  const result = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.consumedFounder, false, "the wagon is NOT spent: it becomes the town's first hero");
  assert.equal(result.suppliesGranted, true);

  // The town lands on the wagon's own hex -- the in-place rule.
  const settlement = result.state.settlements[result.settlementId];
  assert.ok(settlement, "the settlement exists at the returned id");
  assert.equal(settlement.ownerId, wagon.ownerId);
  assert.equal(settlement.q, wagon.q, "the town is planted where the wagon stood");
  assert.equal(settlement.r, wagon.r);
  assert.equal(settlement.level, 1);
  assert.deepEqual(settlement.warehouse, SETTLERS_MODE_DEFAULTS.wagonSupplies);
  assert.deepEqual(
    settlement.buildings,
    [],
    "no prebuilt buildings: the founding-time grant is off and the city view's free commit is off too",
  );
  assert.ok(Object.keys(settlement.resourceRates).length > 0, "the town's rates come from its terrain");
  assert.equal(settlement.name.length > 0, true);

  // The identity change: one entity, renamed. Everything else about the record
  // -- position, trail, gold, name, movement -- is the wagon's own.
  const heroId = seatHeroIdFor(wagon.ownerId);
  assert.equal(result.state.heroes[wagon.id], undefined, "the wagon's own id is gone");
  const hero = result.state.heroes[heroId];
  assert.ok(hero, "the seat's hero id is the wagon");
  assert.equal(hero.ownerId, wagon.ownerId);
  assert.equal(hero.q, wagon.q);
  assert.equal(hero.r, wagon.r);
  assert.deepEqual(hero.trail, wagon.trail, "the same record: only its id moved");
  assert.equal(hero.movementRemaining, wagon.movementRemaining);
  assert.deepEqual(hero.stacks, [], "still no army");
  assert.deepEqual(
    hero.resources,
    EMPTY_WAREHOUSE,
    "the cargo went into the town's warehouse -- ONE stockpile, in the town (cargoStaysWithFounderHero false)",
  );

  // The roster follows the rename and names the new town.
  assert.deepEqual(result.state.players[0].heroIds, [heroId], "the seat's roster names the town's first hero");
  assert.deepEqual(
    result.state.players[0].settlementIds,
    [...state.players[0].settlementIds, result.settlementId],
  );
  assert.equal(result.state.players[0].settlementIds.length, seatsBefore + 1);
  assert.equal(result.state.nextSettlementId, state.nextSettlementId + 1, "the id counter moves with it");
  assert.equal(result.state.dirty, true);
  assert.deepEqual(result.state.players[1].heroIds, [coveredWagonIdFor(1)], "the other seats are untouched");
  assert.ok(result.state.heroes[coveredWagonIdFor(1)], "…and so are their wagons");

  // The converted hero can never found again (the rule is wagon-only): standing
  // it on fresh legal ground is still refused.
  const elsewhere = findOpenHex(map, [settlement, { q: wagon.q, r: wagon.r }]);
  const moved = withFounderAt(result.state, heroId, elsewhere.q, elsewhere.r);
  assert.deepEqual(
    canFoundSettlement({ state: moved, founderId: heroId, q: elsewhere.q, r: elsewhere.r, map }),
    { ok: false, reason: "founder_not_a_wagon" },
    "one wagon, one settlement",
  );

  // And the hex it already holds is occupied for anyone else.
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

test("the founding keeps the selection on the entity it converts, and clears it when the founder is consumed", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const selected: GameState = { ...state, selectedHeroId: wagon.id };

  const converted = foundSettlement({ state: selected, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  assert.equal(
    converted.state.selectedHeroId,
    seatHeroIdFor(0),
    "the selection follows the wagon into its new id -- the panel must never report a hero that no longer exists",
  );

  // A selection that was somebody else is left alone.
  const other: GameState = { ...state, selectedHeroId: coveredWagonIdFor(1) };
  const untouched = foundSettlement({ state: other, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(untouched.ok, true);
  if (!untouched.ok) return;
  assert.equal(untouched.state.selectedHeroId, coveredWagonIdFor(1), "another seat's selection is untouched");

  // A CONSUMED founder leaves nothing to select, so the selection is dropped --
  // the same rule the defeat path's endBattlePhase applies.
  flipModeKey("wagonBecomesFirstHero", false, () => {
    const consumed = foundSettlement({ state: selected, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
    assert.equal(consumed.ok, true);
    if (!consumed.ok) return;
    assert.equal(consumed.state.selectedHeroId, null, "a consumed founder drops the selection with it");
  });
});

test("the converted founder survives a reload as the settlement's first hero", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const founded = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(founded.ok, true);
  if (!founded.ok) return;

  // The row a save writes, read back the way every command reads it.
  const reloaded = hydrateGameState({
    seed: SEED,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: founded.state.players,
    heroes: founded.state.heroes,
    settlements: founded.state.settlements,
    gameMode: "settlers",
  });
  const heroId = seatHeroIdFor(0);
  assert.ok(reloaded.heroes[heroId], "the town's first hero is in the reloaded heroes record");
  assert.equal(reloaded.heroes[wagon.id], undefined, "…and the wagon id is not");
  assert.deepEqual(reloaded.players[0].heroIds, [heroId], "the persisted roster names it");
  assert.deepEqual(reloaded.players[0].settlementIds, [founded.settlementId]);
  assert.deepEqual(
    reloaded.settlements[founded.settlementId].buildings,
    [],
    "a reloaded town is still building-free",
  );
  assert.equal(
    reloaded.settlements[founded.settlementId].warehouse.wood,
    SETTLERS_MODE_DEFAULTS.wagonSupplies.wood,
    "…and still holds the cargo the wagon carried",
  );
  // The reloaded hero is still not a founder, and still the seat's own.
  assert.deepEqual(
    canFoundSettlement({ state: reloaded, founderId: heroId, q: wagon.q, r: wagon.r, map }),
    { ok: false, reason: "founder_not_a_wagon" },
  );
  assert.equal(reloaded.heroes[heroId].ownerId, 0);
});

test("a founded settlers town is never handed a prebuilt city", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const founded = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(founded.ok, true);
  if (!founded.ok) return;
  const settlement = founded.state.settlements[founded.settlementId];

  // 1. The founding-time grant is off (`freeStarterBuildings: false`).
  assert.deepEqual(settlement.buildings, []);
  assert.deepEqual(
    foundedSettlementBuildings("settlers", settlement.population),
    [],
    "the mode's founding-time answer is NO",
  );

  // 2. The city view's own free commit -- the path that handed a founded town
  //    the classic starter city the moment its city view opened -- is off too.
  for (const existing of [undefined, []]) {
    const onOpen = starterCityOnOpen({
      size: cityViewSizeFor(1),
      style: "classic",
      existing,
      mode: "settlers",
    });
    assert.deepEqual(
      onOpen,
      { buildings: [], free: false },
      "opening a settlers town's city view commits nothing, and nothing for free",
    );
  }
  // An already-built settlers town is handed its own buildings back untouched
  // (the pre-existing rule, unchanged), never a second city.
  const built = buildStarterLayout({ size: 5, style: "classic" });
  assert.deepEqual(
    starterCityOnOpen({ size: 5, style: "classic", existing: built, mode: "settlers" }),
    { buildings: built, free: false },
  );

  // 3. Classic is untouched: an empty classic settlement still gets its free set.
  const classicOpen = starterCityOnOpen({ size: 5, style: "classic", existing: [], mode: "classic" });
  assert.equal(classicOpen.free, true, "a classic settlement keeps the free starter commit");
  assert.equal(classicOpen.buildings.length > 0, true);
  const modeBlind = starterCityOnOpen({ size: 5, style: "classic", existing: undefined });
  assert.equal(modeBlind.free, true, "an absent mode reads as classic (a mode-blind caller keeps today's behaviour)");

  // 4. And the ENGINE refuses a spoofed free commit, so a stale or hostile
  //    client cannot hand a settlers town the classic city for nothing: the
  //    same call that is free in a classic game is charged here.
  const rich = {
    ...founded.state,
    settlements: {
      ...founded.state.settlements,
      [settlement.id]: {
        ...settlement,
        gold: 5000,
        warehouse: { wood: 5000, stone: 5000, iron: 5000, arcane: 5000, food: 0 },
      },
    },
  };
  const spoofed = applyPlaceBuildings(rich, settlement.id, 0, classicOpen.buildings, true);
  assert.equal(spoofed.ok, true, "the town can afford the spoofed set, so it is placed");
  assert.ok(
    spoofed.state.settlements[settlement.id].warehouse.wood < rich.settlements[settlement.id].warehouse.wood,
    "…and it is CHARGED: initialLayout cannot buy a free city in a mode whose key says no",
  );
  const freeInClassic = applyPlaceBuildings(
    { ...rich, gameMode: "classic" },
    settlement.id,
    0,
    classicOpen.buildings,
    true,
  );
  assert.equal(freeInClassic.ok, true);
  assert.equal(
    freeInClassic.state.settlements[settlement.id].warehouse.wood,
    rich.settlements[settlement.id].warehouse.wood,
    "the classic path is still free -- the mode gate is the only new thing",
  );
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
// SETTLERS-PLAN.md §3's answers ARE these keys, and the mode's whole behaviour
// is meant to move with them (packages/contracts/src/gameMode.ts). Each test
// below mutates the key, runs the RULE, and asserts the outcome flipped,
// restoring the constant in a `finally`.

/** The seven keys, in one list: a new key without a flip test goes red here. */
const MODE_KEYS = [
  "wagonBecomesFirstHero",
  "minFoundingDistance",
  "wagonSupplies",
  "cargoStaysWithFounderHero",
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
  // The confirmed intentions, as the constants the rules read.
  assert.equal(SETTLERS_MODE_DEFAULTS.neutralCastles, false, "bare wilderness: no neutral castle");
  assert.equal(SETTLERS_MODE_DEFAULTS.freeStarterBuildings, false, "no prebuilt city, ever");
  assert.equal(SETTLERS_MODE_DEFAULTS.wagonBecomesFirstHero, true, "the wagon becomes the town's first hero");
  assert.equal(SETTLERS_MODE_DEFAULTS.minFoundingDistance, 3, "founding is in place whatever this is");
  assert.equal(CLASSIC_MODE_DEFAULTS.neutralCastles, true, "classic keeps its neutrals");
  assert.equal(CLASSIC_MODE_DEFAULTS.freeStarterBuildings, true, "classic keeps its free starter city");
});

test("flipping wagonBecomesFirstHero flips who the founder becomes", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const result = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.consumedFounder, false, "the default keeps the founder as the town's first hero");
  assert.ok(result.state.heroes[seatHeroIdFor(0)], "…under the seat's hero id");

  flipModeKey("wagonBecomesFirstHero", false, () => {
    const consumed = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
    assert.equal(consumed.ok, true);
    if (!consumed.ok) return;
    assert.equal(consumed.consumedFounder, true, "flipping the key spends the wagon instead");
    assert.equal(consumed.state.heroes[wagon.id], undefined, "the wagon is gone");
    assert.equal(consumed.state.heroes[seatHeroIdFor(0)], undefined, "…and no hero took its place");
    assert.deepEqual(consumed.state.players[0].heroIds, [], "the roster drops it");
    // The town is identical either way: who the founder becomes does not change
    // a byte of the settlement.
    assert.deepEqual(
      consumed.state.settlements[consumed.settlementId],
      result.state.settlements[result.settlementId],
    );
  });
});

test("flipping cargoStaysWithFounderHero leaves the load aboard the surviving founder", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const founded = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
  assert.equal(founded.ok, true);
  if (!founded.ok) return;
  assert.deepEqual(
    founded.state.settlements[founded.settlementId].warehouse,
    SETTLERS_MODE_DEFAULTS.wagonSupplies,
    "the default moves the cargo into the town",
  );

  flipModeKey("cargoStaysWithFounderHero", true, () => {
    const kept = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
    assert.equal(kept.ok, true);
    if (!kept.ok) return;
    assert.deepEqual(
      kept.state.settlements[kept.settlementId].warehouse,
      EMPTY_WAREHOUSE,
      "the town starts empty: the load is still the crew's",
    );
    assert.equal(kept.suppliesGranted, false);
    assert.deepEqual(
      kept.state.heroes[seatHeroIdFor(0)].resources,
      SETTLERS_MODE_DEFAULTS.wagonSupplies,
      "…and the surviving hero rides on with it",
    );
  });
});

test("flipping minFoundingDistance flips founding AND start spacing (L2's boundary)", () => {
  const { map, state } = settlersState();
  const wagon = state.heroes[coveredWagonIdFor(0)];
  const neutral = makeNeutral("n0", 3, 3);
  const withNeutral = withNeutralAt(state, neutral);

  // A passable hex inside the default dead zone of the neutral castle.
  let inside: { q: number; r: number } | undefined;
  for (let r = 0; r < map.height && !inside; r++) {
    for (let q = 0; q < map.width && !inside; q++) {
      const d = hexDistance({ q, r }, { q: neutral.q, r: neutral.r });
      if (d > 0 && d < 3 && map.isPassable(q, r)) inside = { q, r };
    }
  }
  assert.ok(inside, "the fixture map must have a hex inside a neutral's dead zone");
  const onInside = withFounderAt(withNeutral, wagon.id, inside.q, inside.r);

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
  assert.deepEqual(wagonSuppliesFor("settlers"), SETTLERS_MODE_DEFAULTS.wagonSupplies);
  flipModeKey("wagonSupplies", EMPTY_WAREHOUSE, () => {
    for (const wagon of Object.values(settlersPayload().heroes)) {
      assert.deepEqual(wagon.resources, EMPTY_WAREHOUSE, "a flipped key must empty the starting cargo");
    }
    const { map, state } = settlersState();
    const wagon = state.heroes[coveredWagonIdFor(0)];
    const result = foundSettlement({ state, founderId: wagon.id, q: wagon.q, r: wagon.r, map });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.suppliesGranted, false, "an empty cargo is not a granted stockpile");
    assert.deepEqual(result.state.settlements[result.settlementId].warehouse, EMPTY_WAREHOUSE);
  });
});

test("flipping freeStarterBuildings hands the town the starter city, at founding and at the city view", () => {
  assert.deepEqual(
    foundedSettlementBuildings("settlers", 1),
    [],
    "the mode's answer is NO: no founding grant",
  );
  assert.deepEqual(
    starterCityOnOpen({ size: 5, style: "classic", existing: [], mode: "settlers" }),
    { buildings: [], free: false },
    "…and no free city-view commit",
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
    assert.equal(
      starterCityOnOpen({ size: 5, style: "classic", existing: [], mode: "settlers" }).free,
      true,
      "the same key gates the city view's free commit",
    );
  });
});

test("flipping neutralCastles fills the wilderness, and leaves classic alone", () => {
  assert.equal(
    Object.values(settlersPayload().settlements).length,
    0,
    "the default is BARE wilderness: no neutral castle at all",
  );
  flipModeKey("neutralCastles", true, () => {
    const settlements = Object.values(settlersPayload().settlements);
    assert.equal(
      settlements.length,
      NEUTRAL_PIN,
      "putting the neutrals back is a filter over the generated castles, and it returns exactly the ones classic seeds",
    );
    assert.ok(settlements.every((s) => s.ownerId === null), "…as neutrals");
    assert.ok(
      settlements.every((s) => s.buildings.length > 0),
      "…with the buildings and districts the seeding pass gives them",
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
