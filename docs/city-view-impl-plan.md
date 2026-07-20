# City View — Implementation Plan

Locked design for the in-settlement city screen. Supersedes the high-level design in `city-view.md` for tier sizing (this doc replaces the implicit "10×10 default" with a tiered scheme) and adds the isometric projection plan.

## Locked decisions (from planning round)

| Decision             | Choice                                                                      |
|----------------------|-----------------------------------------------------------------------------|
| Projection           | Manual isometric math on Canvas 2D (no WebGL, no Three.js)                  |
| View mode            | Overlay (adventure map still visible behind, like the battle modal)         |
| Camera framing       | Hybrid: fixed cell size up to 10×10, fit-to-viewport for 15×15              |
| Camera controls      | None on day one — static framing                                            |
| Building art (v1)    | Procedural iso shapes drawn by the renderer; swap to sprites later          |
| Tilt angle           | ~26.5° (classic HoMM-style; `tileDepth = tileWidth * 0.5`)                  |
| Tier sizing          | Replace old 10×10 default with **5×5 / 10×10 / 15×15** (see Tier table)     |

## Tier table

| Castle level | Tier label | Grid size | Camera framing           |
|--------------|------------|-----------|--------------------------|
| 1            | Settlement | 5×5       | Fixed cell size          |
| 2            | Town       | 10×10     | Fixed cell size          |
| 3            | Castle     | 15×15     | Fit-to-viewport          |

Threshold (10×10 → fixed, 15×15 → fit-to-view) is the default but should be a single config constant so we can adjust.

## Projection math

Two constants define the entire look:

```ts
const TILE_W = 96;                 // horizontal cell pitch in world px
const TILE_D = TILE_W * 0.5;       // vertical foreshortening; gives ~26.5° tilt
```

For a cell at grid coords `(gx, gy)` in `[0, N)`:

```ts
function cellToScreen(gx: number, gy: number, origin: { x: number; y: number }) {
  return {
    x: origin.x + (gx - gy) * TILE_W / 2,
    y: origin.y + (gx + gy) * TILE_D / 2,
  };
}
```

`origin` is the world-space point we choose to be the screen-center anchor (the geometric center of the grid: `(N/2 - 0.5, N/2 - 0.5)`). Camera is just `ctx.translate(-cam.x, -cam.y); ctx.scale(cam.zoom, cam.zoom)` after centering the world origin to the viewport center.

Inverse (for picking):

```ts
function screenToCell(sx: number, sy: number, origin: { x: number; y: number }) {
  const wx = sx - origin.x;
  const wy = sy - origin.y;
  // Solve the 2x2 system; equivalent to: gx = (wx/TILE_W + wy/TILE_D), gy = (wy/TILE_D - wx/TILE_W)
  const gx = wx / TILE_W + wy / TILE_D;
  const gy = wy / TILE_D - wx / TILE_W;
  return { gx, gy };
}
```

Floor `gx` and `gy` for the cell index; check bounds.

## Depth ordering

Single rule: sort by `gx + gy` ascending; within a cell, draw order is **tile → spot → building**. This handles all the cases we'll have in v1.

## File layout

```
src/
  core/
    cityGrid.ts          # cellToScreen / screenToCell / bounds / neighbors
  render/
    cityRenderer.ts      # draw frame for one settlement
    cityBuildingDraw.ts  # procedural iso building shapes
  views/
    cityView.ts          # entry point + state machine; owns enter/exit/click
  entities/
    cityBuilding.ts      # building definitions + state
  state/
    gameState.ts         # extend SettlementState (see below)
server/
  migrations/
    <timestamp>_city_state.sql   # city_spots, city_mines, buildings JSONB
```

## State extension

Append to `SettlementState` (`src/state/gameState.ts`):

```ts
citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: 'small'|'medium'|'large' }>;
cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: 1|2|3; builtTurn: number }>;
buildings: Array<{ cell: { x: number; y: number }; kind: BuildingKind; level: 1|2|3 }>;
```

Building kinds (v1, deferred beyond mines per `city-view.md`): `townHall`, `mageGuild`, `market` — declared but unused until UI ships.

DB: add three JSONB columns to the settlements JSONB blob, defaulting to `[]`. Migration is small.

## Phases

### Phase 1 — Grid renders (the hard part of rendering)

- [ ] `cityGrid.ts` math + unit tests against hand-computed coords.
- [ ] `cityRenderer.drawEmptyGrid(settlement)` — diamond tiles, no content.
- [ ] `cityView.ts` opens on double-click of a friendly settlement; closes on Esc / "back".
- [ ] Dim adventure map behind the overlay (existing battle modal pattern in `src/views/battleModal.ts` is the reference).
- [ ] Camera auto-frames per tier: 5×5 / 10×10 use fixed cell size; 15×15 fits to viewport with margin.

**Done when:** opening any friendly settlement shows an empty diamond grid sized to its tier.

### Phase 2 — Pick & hover

- [ ] `screenToCell` wired to `mousemove` on the canvas while city view is open.
- [ ] Hovered cell drawn with a diamond outline (matches existing hover style in `renderer.ts:88-97`).
- [ ] Out-of-bounds hover clears highlight.

**Done when:** mouse hover highlights exactly the cell under the cursor.

### Phase 3 — Content (spots + procedural buildings)

- [ ] Resource spots rendered on their cells using the existing rune-stone sprites from `tools/sprites/pixel-gen.mjs` (per `docs/art-style.md`). Iso-foreshortened by drawing at `(0.5, 0.5)` scale, slightly lower than cell center so they sit "on" the tile.
- [ ] Mine placeholder: small procedural iso box colored by resource type, with a level number.
- [ ] `cityBuildingDraw.ts`: `drawTownHall(ctx, cell)`, etc. — flat iso (diamond base + vertical walls + pyramid roof), parameterized by owner color and level.
- [ ] Depth sort pass: tiles → spots → buildings, ordered by `gx + gy`.

**Done when:** a freshly founded settlement shows 4–6 random spots and the player can see the procedural town hall at grid center.

### Phase 4 — State & DB

- [ ] `SettlementState` extended (see above).
- [ ] Server migration adds the three JSONB columns with `[]` default.
- [ ] At settlement founding (`src/game/initState.ts` or wherever founding happens), generate 4–6 spots from the full resource pool (not constrained by `foundedOnResource`), seeded by `id` for determinism.
- [ ] `Castle.fromGameState` / `toGameState` round-trip the new fields.

**Done when:** reloading a save restores spots, mines, and buildings exactly.

### Phase 5 — Build UI

- [ ] Click empty cell → build menu (mine types + cancel; placeholder for non-mine buildings).
- [ ] Click resource spot → "Build X mine here" prompt (cost preview from `city-view.md:42-45`).
- [ ] Click existing mine → info card + upgrade button (upgrade cost = 2× construction per `city-view.md:46`).
- [ ] Per-turn income from mines flows into existing `src/economy/income.ts` (extend, don't rewrite).

**Done when:** building a mine, ending the turn, and starting the next shows the income increased.

### Defer (per `city-view.md` + this doc)

- Walls / fortifications.
- Building slots beyond mines.
- Spells that affect city production.
- Iso sprite assets (procedural buildings stay until art agent ships proper sprites).
- City-view pan/zoom controls (only add if playtesting reveals it's needed).

## Open follow-ups

1. **Cell size constant `TILE_W = 96`** is a guess. After phase 1 ships we should eyeball it on a 1920×1080 viewport and adjust.
2. **Threshold for fit-to-view (currently `> 10×10`)** should be a single named constant in `cityView.ts`.
3. **Spot count (currently 4–6 per `city-view.md:27`)** should scale with tier — 5×5 probably wants ~3, 15×15 wants ~8. Decide in phase 4.
4. **Animation on enter/leave** — current plan is instant cut between adventure map and city view. If it feels janky we can add a 200ms zoom/pan tween later (low cost with the math above).
5. **`Castle.level` already exists in `src/entities/settlement.ts:4`** — verify it maps cleanly to the tier table before phase 4.

## Cross-references

- High-level design (now superseded for tier sizing): `docs/city-view.md`
- Settlement data model: `src/entities/settlement.ts`, `docs/settlements.md`
- Economy / per-turn yield: `src/economy/income.ts`, `docs/economy.md`
- Art direction for resource icons: `docs/art-style.md`
- Overlay pattern (battle modal is the reference): `src/views/battleModal.ts`
