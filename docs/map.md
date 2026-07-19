# Map

The world the heroes move through. Hex grid, isometric rendering, procedurally generated.

## Status

📋 **Planned for v1.** Core (terrain + rendering) is implemented. Resource tile placement, fog of war, and minimap resource markers are pending.

## Grid

- **24 × 18 hex grid**, axial coordinates `(q, r)`.
- Hex size = 32 logical px.
- Pointy-top orientation, flat-top stack.

## Terrain types (current)

| Terrain | Fill | Move cost | Notes |
|---------|------|-----------|-------|
| Grass | green | 1 | Default |
| Dirt | brown | 1.2 | Roads / paths |
| Forest | dark green | 1.6 | Slow, decorative trees |
| Water | blue | impassable | Lakes / rivers |

Generated via a deterministic pseudo-noise function on the map seed. Same seed → same map.

## Resource tile placement (planned)

~14% of tiles carry a [resource](./resources.md), placed at map generation time:

| Resource | Density |
|----------|---------|
| Gold | ~5% |
| Wood | ~4% |
| Stone | ~3% |
| Iron Ore | ~1.5% |
| Arcane Dust | ~0.5% |

Resource type is independent of terrain — a Gold tile can be grass, a Wood tile can be forest, etc.

## Rendering

- **Hex outline:** 1px darker stroke.
- **Terrain fill:** flat colour from palette.
- **Decoration overlay:** trees on forest, wave ripples on water (procedural).
- **Resource overlay (planned):** small icon in the hex centre for unclaimed resource tiles.
- **Settlement overlay (planned):** town sprite on top of resource icon when claimed.

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
- (Planned) Resource tiles: small dot indicator.

## Fog of war (deferred)

⏸️ **Deferred entirely.** Resource tiles stay **always visible** for v1 — no fog hiding them. If/when fog ships later, this decision will be revisited.

## Cross-references

- What's placed on the map: [resources.md](./resources.md), [settlements.md](./settlements.md)
- Who moves on it: [heroes.md](./heroes.md)

[← Back to index](./README.md)
