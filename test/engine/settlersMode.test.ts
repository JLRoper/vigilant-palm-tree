import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DEFAULT_GAME_MODE,
  SETTLERS_MODE_DEFAULTS,
  gameModeSettings,
  isGameMode,
  resolveGameMode,
} from "@heroes/contracts";
import {
  CURRENT_MAP_GEN_VERSION,
  FOUND_SETTLEMENT_REFUSALS,
  SETTLERS_STREAM_PREFIX,
  canFoundSettlement,
  createInitialState,
  foundSettlement,
  getOrCreateGameMap,
  hashString,
  makeInitialStatePayload,
  mulberry32,
  placeSettlersStarts,
  settlersStreamKey,
  settlersStreamRng,
  type MapSize,
} from "@heroes/engine";

// The settlers game mode's phase-0 pin (SETTLERS-PLAN.md §2.3, §2.4).
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
// Phase 0 changes no rule, so these pins are the baseline the later phases are
// measured against: if a phase-1 edit moves them, that edit re-rolled every
// save in flight and must be redesigned (add a pass for the new version, never
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

// ── 4. Phase 0 ships signatures, not rules ──

test("the settlers start-placement and founding stubs throw rather than guess", () => {
  assert.throws(
    () =>
      placeSettlersStarts({
        seed: 42,
        size: "small",
        playerCount: 3,
        humanSeatCount: 1,
        mode: "settlers",
      }),
    /not implemented yet/,
    "a stub that returned a plausible placement would seed a game on invented starts",
  );

  const state = createInitialState();
  assert.throws(
    () => canFoundSettlement({ state, founderId: "p0-wagon", q: 3, r: 3 }),
    /not implemented yet/,
    "the predicate must not answer ok:true before the rule exists",
  );
  assert.throws(
    () => foundSettlement({ state, founderId: "p0-wagon", q: 3, r: 3 }),
    /not implemented yet/,
    "founding must not return a state before the rule exists",
  );
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
