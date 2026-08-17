import { test } from "node:test";
import assert from "node:assert/strict";
import { GameMap } from "@heroes/engine";
import type { TileRow } from "@heroes/engine";

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
  for (const mapSize of ["small", "medium", "large"] as const) {
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
