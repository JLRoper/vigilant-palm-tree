# Map

The world the heroes move through. Hex grid, isometric rendering, procedurally generated.

## Status

🟡 **In progress.** Core terrain + rendering is implemented. Biome-aware resource placement, the new `mountain` and `desert` terrain types, and server-side tile persistence are planned and being documented before code lands.

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

Generated via a deterministic pseudo-noise function on the map seed. Same seed → same map.

### New terrain (v1)

- **`mountain`** — impassable like water, but stone/iron-bearing. Estimated ~3% of map. Renders as a peaked silhouette with a snow/light tip.
- **`desert`** — passable at 1.4× movement cost. Estimated ~5% of map. Renders as sandy fill with light hatch lines. Carries arcane dust most often — thematically "the old things leak from ancient ruins buried in the sand."

## Resource tile placement (planned — biome-aware)

Resources are **not independent of terrain**. Each resource has a per-terrain density table; the placer samples the appropriate row for each tile based on its terrain.

See [resources.md](./resources.md) for the full density matrix and rationale.

### Biome rules (summary)

| Resource   | Preferred biomes                          | Avoids        |
|------------|-------------------------------------------|---------------|
| Gold       | Grass, dirt (anywhere with foot traffic)  | Mountain, water |
| Wood       | **Forest** (high), grass (low)            | Desert, mountain, water |
| Stone      | **Mountain** (high), dirt (low)           | Forest, water |
| Iron Ore   | **Mountain** (medium-high), dirt (low)    | Forest, water |
| Arcane Dust| **Desert** (high), dirt (low)             | Forest, mountain, water |

Tiles on water or impassable mountain are **never** assigned a resource (water has no deposits; mountain is a pathfinder block — its deposits are exposed at adjacent dirt/grass tiles).

Per-terrain densities must sum to the same overall target (~14% of passable tiles carry a resource) to keep the global resource budget stable.

## Rendering

- **Hex outline:** 1px darker stroke.
- **Terrain fill:** flat colour from palette.
- **Decoration overlay:** trees on forest, wave ripples on water, sand hatch on desert, peak silhouette on mountain (procedural).
- **Resource overlay (planned):** small icon in the hex centre for unclaimed resource tiles.
- **Settlement overlay (planned):** town sprite on top of resource icon when claimed.

## Data model (planned — Slice 2)

The map's authoritative state lives in a server-side table:

```sql
CREATE TABLE IF NOT EXISTS tiles (
  id          SERIAL PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  q           INTEGER NOT NULL,
  r           INTEGER NOT NULL,
  terrain     TEXT NOT NULL,                -- 'grass' | 'dirt' | 'forest' | 'desert' | 'mountain' | 'water'
  resource    TEXT,                         -- 'gold' | 'wood' | 'stone' | 'iron' | 'arcane' | NULL
  UNIQUE (game_id, q, r)
);
CREATE INDEX IF NOT EXISTS tiles_game_idx ON tiles (game_id);
```

- `terrain` is non-null; `resource` is null for tiles without a deposit.
- The seed moves from client-side map generation to server-side. `POST /api/games` generates the tile grid using the seed and inserts the rows. `GET /api/games/:name/tiles` returns them.
- Client-side `GameMap` hydrates from the tiles endpoint instead of re-deriving from seed.
- Settlement binding (next milestone) keys on `(game_id, q, r)`.

### Migration note

When this slice lands, the existing seed-derived `resourceTiles` field on `GameMap` becomes obsolete and gets removed. Saved games from before Slice 2 won't have tile rows; on first read, the server backfills them by running the deterministic seed-based generator once.

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

## Fog of war (deferred)

⏸️ **Deferred entirely.** Resource tiles stay **always visible** for v1 — no fog hiding them. If/when fog ships later, this decision will be revisited.

## Cross-references

- What's placed on the map: [resources.md](./resources.md), [settlements.md](./settlements.md)
- Who moves on it: [heroes.md](./heroes.md)

[← Back to index](./README.md)
