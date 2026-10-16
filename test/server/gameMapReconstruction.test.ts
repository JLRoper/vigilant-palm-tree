import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_MAP_CACHE_CAPACITY,
  GameMap,
  clearGameMapCache,
  getGameMapCacheSize,
  getOrCreateGameMap,
  resolveMapGenVersion,
  resolveSavedMapGenVersion,
} from "@heroes/engine";
import type { TileRow } from "@heroes/engine";
import { generateAndInsertTiles } from "../../server/routes";

// Verifies a load-bearing assumption behind server/app/commandHandler.ts's
// StartCharter case (plan/2026-08-17-consolidated-phase-1-5-track-map.md
// §5.1 R5): that case reconstructs a GameMap via
// `new GameMap(row.seed, row.map_size)` rather than reading the game's
// persisted `tiles` table. That's only safe because server/routes.ts's
// generateAndInsertTiles() -- the only real producer of a game's tiles --
// itself just calls `new GameMap(seed, mapSize)` and serializes the
// result, and src/managers/GameSessionManager.ts's loadGame() reconstructs
// the client's own map from those same persisted tiles via
// GameMap.fromTiles(). No command exercised GameMap reconstruction at all
// before this port, so this pins the equivalence down explicitly instead
// of trusting it silently: a future change to map generation that breaks
// this determinism should fail loudly here, not corrupt charter placement/
// resourceRates for existing games.
function toTileRows(map: GameMap): TileRow[] {
  const rows: TileRow[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const resourceTile = map.resourceTileAt(q, r);
      rows.push({ q, r, terrain: map.get(q, r)!, resource: resourceTile?.resource ?? null });
    }
  }
  return rows;
}

test("new GameMap(seed, mapSize) deterministically reproduces the same map GameMap.fromTiles() would reconstruct from its own persisted tiles", () => {
  const seed = 4242;
  const mapSize = "small" as const;

  // Simulates server/routes.ts's generateAndInsertTiles() at game creation.
  const originalMap = new GameMap(seed, mapSize);
  const persistedTiles = toTileRows(originalMap);

  // Simulates the client's own reconstruction path
  // (GameSessionManager.ts's loadGame(): GameMap.fromTiles(tiles fetched
  // from GET .../tiles)).
  const clientReconstructed = GameMap.fromTiles(persistedTiles);

  // Simulates server/app/commandHandler.ts's StartCharter case.
  const serverReconstructed = new GameMap(seed, mapSize);

  assert.equal(serverReconstructed.width, clientReconstructed.width);
  assert.equal(serverReconstructed.height, clientReconstructed.height);
  assert.deepEqual(serverReconstructed.tiles, clientReconstructed.tiles);
  assert.deepEqual(serverReconstructed.resourceTiles, clientReconstructed.resourceTiles);
});

test("GameMap reconstruction from seed+mapSize is deterministic across every mapSize, not just small", () => {
  for (const mapSize of ["small", "medium", "large", "huge", "epic"] as const) {
    const a = new GameMap(777, mapSize);
    const b = new GameMap(777, mapSize);
    assert.deepEqual(a.tiles, b.tiles);
    assert.deepEqual(a.resourceTiles, b.resourceTiles);
  }
});

test("GameMap reconstruction is seed-sensitive (different seeds must not accidentally collide)", () => {
  const a = new GameMap(1, "small");
  const b = new GameMap(2, "small");
  assert.notDeepEqual(a.tiles, b.tiles);
});

test("getOrCreateGameMap caches instances and evicts least-recently-used entries at capacity", () => {
  clearGameMapCache();
  assert.equal(GAME_MAP_CACHE_CAPACITY, 32);
  assert.equal(getGameMapCacheSize(), 0);

  const first = getOrCreateGameMap(1, "small");
  const hit = getOrCreateGameMap(1, "small");
  assert.equal(hit, first);
  assert.equal(getGameMapCacheSize(), 1);

  const second = getOrCreateGameMap(2, "small");
  for (let seed = 3; seed <= GAME_MAP_CACHE_CAPACITY; seed++) {
    getOrCreateGameMap(seed, "small");
  }
  assert.equal(getGameMapCacheSize(), GAME_MAP_CACHE_CAPACITY);

  assert.equal(getOrCreateGameMap(1, "small"), first);

  getOrCreateGameMap(GAME_MAP_CACHE_CAPACITY + 1, "small");
  assert.equal(getGameMapCacheSize(), GAME_MAP_CACHE_CAPACITY);
  assert.equal(getOrCreateGameMap(1, "small"), first);
  assert.notEqual(getOrCreateGameMap(2, "small"), second);
});

test("new GameMap(42, 'epic') generates 10,800 tiles in under 20 ms with bitset frontier", () => {
  new GameMap(41, "epic");
  const t0 = performance.now();
  const map = new GameMap(42, "epic");
  const elapsedMs = performance.now() - t0;

  assert.equal(map.width, 120);
  assert.equal(map.height, 90);
  assert.equal(map.tiles.length, 10_800);
  assert.ok(elapsedMs < 20, `expected epic map generation < 20ms, took ${elapsedMs.toFixed(2)}ms`);
});

test("generateAndInsertTiles on an epic map issues a single UNNEST query with 5 params of length 10,800", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 10_800 };
    },
  } as unknown as Parameters<typeof generateAndInsertTiles>[0];

  await generateAndInsertTiles(client, 7, 42, "upsert", "epic");

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UNNEST/);
  assert.equal(queries[0].params.length, 5);
  assert.equal(queries[0].params[0], 7);
  for (let idx = 1; idx <= 4; idx++) {
    const col = queries[0].params[idx];
    assert.ok(Array.isArray(col));
    assert.equal(col.length, 10_800);
  }
});

test("getOrCreateGameMap supports mapGenVersion 1, 2, and default version 3 without cache collision", () => {
  clearGameMapCache();
  const v1a = getOrCreateGameMap(42, "large", 1);
  const v1b = getOrCreateGameMap(42, "large", 1);
  const v2a = getOrCreateGameMap(42, "large", 2);
  const v2b = getOrCreateGameMap(42, "large", 2);
  const v3 = getOrCreateGameMap(42, "large", 3);
  const vDefault = getOrCreateGameMap(42, "large");

  assert.equal(v1a, v1b, "v1 maps are cached by versioned key");
  assert.equal(v2a, v2b, "v2 maps are cached by versioned key");
  assert.equal(v3, vDefault, "omitted version resolves to v3");
  assert.notEqual(v1a, v2a, "v1 and v2 do not collide in the LRU cache");
  assert.notEqual(v2a, v3, "v2 and v3 do not collide in the LRU cache");
  assert.deepEqual(v1a.tiles, new GameMap(42, "large", 1).tiles);
  assert.deepEqual(v2a.tiles, new GameMap(42, "large", 2).tiles);
  assert.deepEqual(v3.tiles, new GameMap(42, "large", 3).tiles);
  assert.notDeepEqual(
    v2a.tiles,
    v3.tiles,
    "v2 preserves unscaled blobs for existing v2 saves on maps > small while v3 uses scaledTerrainBlobs",
  );
});

test("resolveSavedMapGenVersion and getOrCreateGameMap unify missing/explicit mapGenVersion across AI, client, and command reconstruction", () => {
  clearGameMapCache();
  // Missing metadata on saved games (undefined / null) resolves to v1 across all saved-game callers,
  // while new-game creation (resolveMapGenVersion) defaults to v3.
  assert.equal(resolveMapGenVersion(undefined), 3);
  assert.equal(resolveMapGenVersion(null), 3);
  assert.equal(resolveSavedMapGenVersion(undefined), 1);
  assert.equal(resolveSavedMapGenVersion(null), 1);
  assert.equal(resolveSavedMapGenVersion(1), 1);
  assert.equal(resolveSavedMapGenVersion(2), 2);
  assert.equal(resolveSavedMapGenVersion(3), 3);

  const clientMissing = getOrCreateGameMap(99, "huge", resolveSavedMapGenVersion(undefined));
  const commandMissing = getOrCreateGameMap(99, "huge", resolveSavedMapGenVersion(undefined));
  const aiMissing = getOrCreateGameMap(99, "huge", resolveSavedMapGenVersion(undefined));
  assert.equal(clientMissing, commandMissing);
  assert.equal(commandMissing, aiMissing);
  assert.deepEqual(clientMissing.tiles, new GameMap(99, "huge", 1).tiles);
});
