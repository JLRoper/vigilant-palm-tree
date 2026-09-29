# Map

The world the heroes move through. Hex grid, isometric rendering, procedurally generated.

## Status

✅ **Implemented.** Procedural map generation, 6 terrain types, biome-aware resource placement, server-side tile persistence, isometric rendering, camera (pan/zoom, DPR-aware), fog of war, and minimap all ship in v1.

## Grid

- **24 × 18 hex grid**, axial coordinates `(q, r)`.
- Hex size = 32 logical px.
- Pointy-top orientation, flat-top stack.

## Terrain types

| Terrain | Fill | Move cost | Notes |
|---------|------|-----------|-------|
| Grass   | green       | 1         | Default. Plains — most common terrain. |
| Dirt    | brown       | 1.2       | Roads / paths. Exposed, barren ground — proxy for arid land in v1. |
| Forest  | dark green  | 1.6       | Slow, decorative trees. Wood-bearing biome. |
| Desert  | sand yellow | 1.4       | Passable but harsh. Arcane-bearing biome (ancient ruins). |
| Mountain| grey rock   | impassable| Peaks and ridges. Stone + iron-bearing biome. Lakes / rivers. |
| Water   | blue        | impassable| Lakes / rivers. Never carries resources. |

Generated via a deterministic pseudo-noise function on the map seed. Same seed → same map. Implementation: [`src/map/gameMap.ts`](../src/map/gameMap.ts), [`src/map/terrain.ts`](../src/map/terrain.ts). See [map-gen.md](./map-gen.md) for the algorithm.

## Resource tile placement

✅ **Implemented.** Resources are placed by per-terrain density — see [resources.md](./resources.md#biome-aware-density-matrix) for the full matrix. Water and impassable mountain are never assigned a resource; mountain-edge tiles get a spillover boost for stone/iron.

Implementation: [`src/map/resourceTiles.ts`](../src/map/resourceTiles.ts) (`placeResourceTiles`).

### Biome rules (summary)

| Resource   | Preferred biomes                          | Avoids        |
|------------|-------------------------------------------|---------------|
| Gold       | Grass, dirt (anywhere with foot traffic)  | Mountain, water |
| Wood       | **Forest** (high), grass (low)            | Desert, mountain, water |
| Stone      | **Mountain** (high), dirt (low)           | Forest, water |
| Iron Ore   | **Mountain** (medium-high), dirt (low)    | Forest, water |
| Arcane Dust| **Desert** (high), dirt (low)             | Forest, mountain, water |

## Rendering

- **Hex outline:** 1px darker stroke.
- **Terrain fill:** flat colour from palette.
- **Decoration overlay:** trees on forest, wave ripples on water, sand hatch on desert, peak silhouette on mountain (procedural).
- **Resource overlay:** small icon in the hex centre for unclaimed resource tiles.
- **Settlement overlay:** town sprite on top of resource icon when claimed (procedural, owner-coloured).

Implementation: [`src/render/`](../src/render/).

## Data model

✅ **Implemented.** The map's authoritative state lives in a server-side table:

```sql
CREATE TABLE IF NOT EXISTS tiles (
  id          SERIAL PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  q           INTEGER NOT NULL,
  r           INTEGER NOT NULL,
  terrain     TEXT NOT NULL,
  resource    TEXT,
  UNIQUE (game_id, q, r)
);
CREATE INDEX IF NOT EXISTS tiles_game_idx ON tiles (game_id);
```

- `terrain` is non-null; `resource` is null for tiles without a deposit.
- `POST /api/games` generates the tile grid using the seed and inserts the rows. `GET /api/games/:name/tiles` returns them.
- Client-side `GameMap` hydrates from the tiles endpoint instead of re-deriving from seed.

## Future: randomized per-game tiles

⏸️ **Deferred.** Documented for roadmap visibility.

The `tiles` table's contents are opaque to the client. Today every game with the same seed produces an identical grid. The server-side generator can be swapped later to:

- **Random per-game:** each new game rolls a fresh grid (no seed → no reproducibility), persisted to `tiles`.
- **Hand-authored levels:** designers place specific `(q, r)` terrain/resource rows by hand, ships as level JSON.
- **Procedural-but-biased:** change the biome density tables, change the noise function, or fold in per-game "events" (a continent shattered by volcanoes) without touching the client.

Because the client only reads the table, all of these are server-only changes. No `GameMap` API changes are needed when this lands.

## Camera

- Pan: drag with mouse.
- Zoom: mouse wheel, clamped to `0.25x – 3x`. Zoom anchors on cursor position.
- Initial position: centred on map centre (`(width-1)/2, (height-1)/2`).
- DPR-aware: `Camera.apply` includes device pixel ratio so coordinates stay correct on retina displays.

## Minimap

- Bottom-right corner, fixed CSS size (180 × ratio × height).
- Shows all tiles with terrain colours.
- Hero position: amber/red marker.
- Path: translucent overlay.
- ✅ Resource tiles: small amber dot indicator (per-resource tint optional).

## Fog of war

✅ **Implemented** (shipped long before the 2026-09-29 playtest pass; this section replaced a stale "deferred entirely" note). Visibility is computed per frame in [`src/render/fog.ts`](../src/render/fog.ts) as the union of:

- **Hero vision rings** — radius 4 (`VISION_RANGE`) around every hero's position.
- **Settlement vision rings** — radius `controlRange(level)` around every castle (grows with settlement level).

Non-visible hexes are covered with a semi-transparent fog overlay on the map and render black on the minimap. Resource deposits are hidden under fog too — the old "resource tiles stay always visible" v1 decision is superseded. Moving into fog is **allowed by design** (HoMM-style); path segments crossing fogged tiles draw brighter over a dark under-stroke so a planned move stays legible.

**Unexplored tiles reveal no terrain info until seen** (locked decision, 2026-09-29 playtest fixes): the tile popup on a fogged tile shows coordinates + "Unexplored" only — `TileInfo.terrain` is null and the terrain/move-cost/deposit/settlement/heroes/charter/territory lines are all suppressed (`src/screens/adventure/tileInfo.ts`; the existing exception — tiles you own stay visible — is kept). The server-side `tiles` table still holds the full grid; the gate is a client presentation rule, not an information-model change.

## Cross-references

- What's placed on the map: [resources.md](./resources.md), [settlements.md](./settlements.md)
- Who moves on it: [heroes.md](./heroes.md)
- Map generation algorithm: [map-gen.md](./map-gen.md)

[← Back to index](./README.md)
