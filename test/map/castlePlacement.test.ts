import { test } from "node:test";
import assert from "node:assert/strict";
import { GameMap } from "../../src/map/gameMap";
import {
  CASTLE_COUNT_DEFAULT,
  CASTLE_COUNT_MAX,
  CASTLE_COUNT_MIN,
  clampCastleCount,
  defaultCastleSeedFromMapSeed,
  generateCastles,
  playerCastle,
  aiCastle,
} from "../../src/map/castlePlacement";
import { mulberry32 } from "../../src/core/rng";

function newMap(seed: number): GameMap {
  return new GameMap(seed);
}

test("clampCastleCount clamps below MIN to MIN", () => {
  assert.equal(clampCastleCount(0), CASTLE_COUNT_MIN);
  assert.equal(clampCastleCount(1), CASTLE_COUNT_MIN);
  assert.equal(clampCastleCount(-5), CASTLE_COUNT_MIN);
});

test("clampCastleCount clamps above MAX to MAX", () => {
  assert.equal(clampCastleCount(6), CASTLE_COUNT_MAX);
  assert.equal(clampCastleCount(99), CASTLE_COUNT_MAX);
});

test("clampCastleCount returns DEFAULT for non-finite", () => {
  assert.equal(clampCastleCount(NaN), CASTLE_COUNT_DEFAULT);
  assert.equal(clampCastleCount(Infinity), CASTLE_COUNT_DEFAULT);
});

test("clampCastleCount accepts values in range", () => {
  assert.equal(clampCastleCount(2), 2);
  assert.equal(clampCastleCount(3), 3);
  assert.equal(clampCastleCount(4), 4);
  assert.equal(clampCastleCount(5), 5);
});

test("defaultCastleSeedFromMapSeed is non-zero and deterministic", () => {
  const a = defaultCastleSeedFromMapSeed(42);
  const b = defaultCastleSeedFromMapSeed(42);
  assert.equal(a, b);
  assert.notEqual(a, 0);
  const c = defaultCastleSeedFromMapSeed(7);
  assert.notEqual(a, c);
});

test("generateCastles returns exactly castleCount castles", () => {
  const map = newMap(42);
  for (const n of [2, 3, 4, 5]) {
    const castles = generateCastles(map, { castleSeed: 1, castleCount: n });
    assert.equal(castles.length, n, `count ${n}: expected ${n} castles, got ${castles.length}`);
  }
});

test("generateCastles assigns roles in order: player L1, AI L2, rest L3 neutral", () => {
  const map = newMap(42);
  const castles = generateCastles(map, { castleSeed: 1, castleCount: 5 });
  assert.equal(castles[0].ownerId, 0);
  assert.equal(castles[0].level, 1);
  assert.equal(castles[1].ownerId, 1);
  assert.equal(castles[1].level, 2);
  for (let i = 2; i < castles.length; i++) {
    assert.equal(castles[i].ownerId, null);
    assert.equal(castles[i].level, 3);
  }
});

test("generateCastles places player in left half and AI in right half", () => {
  const map = newMap(42);
  const castles = generateCastles(map, { castleSeed: 1, castleCount: 3 });
  const p = playerCastle(castles);
  const a = aiCastle(castles);
  assert.ok(p, "player castle present");
  assert.ok(a, "ai castle present");
  assert.ok(p!.tile.q < map.width / 2, `player q=${p!.tile.q} should be < ${map.width / 2}`);
  assert.ok(a!.tile.q >= map.width / 2, `ai q=${a!.tile.q} should be >= ${map.width / 2}`);
});

test("generateCastles respects edge buffer", () => {
  const map = newMap(7);
  const castles = generateCastles(map, { castleSeed: 1, castleCount: 5 });
  for (const c of castles) {
    assert.ok(c.tile.q >= 2, `castle q=${c.tile.q} must be >= 2`);
    assert.ok(c.tile.q < map.width - 2, `castle q=${c.tile.q} must be < ${map.width - 2}`);
    assert.ok(c.tile.r >= 2, `castle r=${c.tile.r} must be >= 2`);
    assert.ok(c.tile.r < map.height - 2, `castle r=${c.tile.r} must be < ${map.height - 2}`);
  }
});

test("generateCastles places only on passable terrain", () => {
  const map = newMap(42);
  const castles = generateCastles(map, { castleSeed: 1, castleCount: 5 });
  for (const c of castles) {
    const t = map.get(c.tile.q, c.tile.r);
    assert.ok(t, "terrain exists");
    assert.notEqual(t, "water", "no water");
    assert.notEqual(t, "mountain", "no mountain");
  }
});

test("generateCastles avoids resource tiles", () => {
  const map = newMap(42);
  const castles = generateCastles(map, { castleSeed: 1, castleCount: 5 });
  for (const c of castles) {
    const rt = map.resourceTileAt(c.tile.q, c.tile.r);
    assert.equal(rt, undefined, `castle at (${c.tile.q},${c.tile.r}) sits on a resource tile`);
  }
});

test("generateCastles enforces min spacing of 4 between any pair", () => {
  const map = newMap(42);
  const castles = generateCastles(map, { castleSeed: 1, castleCount: 5 });
  for (let i = 0; i < castles.length; i++) {
    for (let j = i + 1; j < castles.length; j++) {
      const a = castles[i].tile;
      const b = castles[j].tile;
      const dq = Math.abs(a.q - b.q);
      const dr = Math.abs(a.r - b.r);
      const ds = Math.abs(a.q + a.r - b.q - b.r);
      const dist = (dq + dr + ds) / 2;
      assert.ok(
        dist >= 4,
        `castles too close: ${i}@(${a.q},${a.r}) vs ${j}@(${b.q},${b.r}) distance=${dist}`,
      );
    }
  }
});

test("generateCastles is deterministic for the same seed", () => {
  const map1 = newMap(42);
  const map2 = newMap(42);
  const a = generateCastles(map1, { castleSeed: 99, castleCount: 4 });
  const b = generateCastles(map2, { castleSeed: 99, castleCount: 4 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].tile.q, b[i].tile.q);
    assert.equal(a[i].tile.r, b[i].tile.r);
    assert.equal(a[i].ownerId, b[i].ownerId);
    assert.equal(a[i].level, b[i].level);
  }
});

test("generateCastles changes layout with different seeds", () => {
  const map = newMap(42);
  const a = generateCastles(map, { castleSeed: 1, castleCount: 3 });
  const b = generateCastles(map, { castleSeed: 1234, castleCount: 3 });
  const same =
    a.length === b.length &&
    a.every((ca, i) => ca.tile.q === b[i].tile.q && ca.tile.r === b[i].tile.r);
  assert.equal(same, false, "different seeds should produce different layouts");
});

test("mulberry32 stays consistent for shared use", () => {
  const r1 = mulberry32(99);
  const r2 = mulberry32(99);
  for (let i = 0; i < 10; i++) {
    assert.equal(r1(), r2());
  }
});
