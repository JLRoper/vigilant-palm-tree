# Battle Arena Biome Backgrounds — Design Concepts

**Branch:** `feat/battle-arena-backgrounds`  
**Worktree:** `.worktrees/battle-arena-backgrounds`  
**Date:** 2026-10-19

---

## Overview

The current battle arena renders a flat dark background (`#14161a`) with procedural obstacle hexes (impassable dark-red hexes). This document proposes **5 distinct biome-themed background styles** that adapt to the terrain where the battle takes place, with biome-relevant obstacles that vary in density (none → sparse → dense).

**Terrain Types (from `packages/engine/src/map/terrain.ts`):**
- `grass` — open plains
- `dirt` — barren ground
- `water` — impassable (rivers, lakes)
- `forest` — light woods
- `denseForest` — impassable thick woods
- `desert` — arid sands
- `mountain` — impassable peaks
- `swamp` — marshy ground
- `snow` — frozen tundra

---

## Concept 1: "Living Terrain" — Procedural Biome Tiles

### Visual Style
Each hex renders as a textured tile matching the biome, with subtle variation per hex (noise-based). Obstacles are **biome-native features** that block movement.

### Biome Palettes & Obstacles

| Biome | Base Tile | Obstacle (Impassable) | Obstacle Density Tiers |
|-------|-----------|----------------------|------------------------|
| **Grass** | `#3a6b3a` varied ±15% brightness | Large boulders / ancient standing stones | None / 3-5 / 8-12 |
| **Dirt** | `#8a6b3a` varied ±15% | Cracked earth fissures / sinkholes | None / 3-5 / 8-12 |
| **Forest** | `#1f4a2a` varied | Fallen logs / thick root clusters | None / 4-6 / 10-15 |
| **Dense Forest** | `#10301a` (darker) | Massive tree trunks (2-hex wide) | Sparse (4-6) / Medium (8-10) / Dense (12-16) |
| **Desert** | `#d4b56e` varied | Sand dunes / rock outcrops / cacti clusters | None / 3-5 / 8-12 |
| **Mountain** | `#6e6e7a` varied | Sheer cliff faces / scree slopes | Sparse (3-4) / Medium (6-8) / Dense (10-12) |
| **Swamp** | `#4a5540` varied | Deep water pools / mangrove roots | None / 4-6 / 10-14 |
| **Snow** | `#c9d6e4` varied | Ice floes / crevasses / frozen boulders | None / 3-5 / 8-12 |

### Implementation Notes
- **Shader-based**: Single draw call per biome via instanced hex mesh with biome atlas texture
- **Obstacle seed** drives both placement and visual variant (boulder vs. standing stone)
- **Density tiers**: Controlled by `obstacleCount` (default 12) → map to None (0), Sparse (obstacleCount × 0.4), Medium (obstacleCount), Dense (obstacleCount × 1.5)
- **Transition hexes**: At biome boundaries, blend adjacent biome textures (2-hex border)

### Mockup Description
```
┌─────────────────────────────────────────────────────────────┐
│  GRASS BIOME — SPARSE OBSTACLES (3-5)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ████ ████ ████ ████ ████ ████ ████ ████ ████ ████  │   │
│  │  ████ ████ ████ ▓▓▓▓ ████ ████ ████ ████ ████ ████  │   │  ████ = grass tile
│  │  ████ ████ ████ ████ ████ ████ ▓▓▓▓ ████ ████ ████  │   │  ▓▓▓▓ = boulder obstacle
│  │  ████ ████ ████ ████ ████ ████ ████ ████ ████ ████  │   │
│  │  ████ ████ ████ ████ ████ ████ ████ ████ ████ ████  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Concept 2: "Atmospheric Parallax" — Layered Depth with Skybox

### Visual Style
Multi-layer parallax background: **far skybox** (biome sky) → **mid terrain silhouettes** → **near ground plane** (hex grid). Obstacles rise from ground as 3D-ish silhouettes.

### Biome Atmospheres

| Biome | Skybox | Midground Silhouettes | Ground Texture | Obstacle Silhouettes |
|-------|--------|----------------------|----------------|---------------------|
| **Grass** | Bright blue, wispy clouds | Distant hills, lone oak | Short grass blades swaying | Standing stones, boulders |
| **Dirt** | Hazy orange-brown, heat shimmer | Cracked mesas, dead trees | Dust motes drifting | Fissures, sinkholes |
| **Forest** | Dappled green canopy gaps | Tree trunks fading up | Leaf litter, ferns | Fallen logs, root walls |
| **Dense Forest** | Near-black, shafts of light | Massive trunks, vines | Thick moss, mushrooms | Ancient tree boles (wide) |
| **Desert** | Blazing sun, sandstorm haze | Dunes marching to horizon | Rippled sand, bleached bones | Rock spires, cacti |
| **Mountain** | Crisp pale blue, peaks in mist | Jagged ridges, snow caps | Scree, alpine grass | Cliff faces, boulder fields |
| **Swamp** | Overcast grey-green, mist low | Cypress knees, willows | Dark water, lily pads | Water pools, root tangles |
| **Snow** | Pale aurora, heavy sky | Frozen peaks, pine silhouettes | Crusted snow, wind drifts | Ice ridges, crevasses |

### Parallax Layers (CSS/Canvas)
```
Layer 0 (Farthest):  Skybox — slow pan (0.05× camera)
Layer 1:             Far terrain silhouettes — 0.2× camera
Layer 2:             Mid terrain details — 0.5× camera
Layer 3 (Grid):      Battle hexes + units — 1.0× (fixed)
Layer 4 (Nearest):   Obstacle silhouettes — 1.1× (slight pop)
```

### Obstacle Density
- **None**: Clean grid, only skybox + ground
- **Sparse**: 3-5 obstacle silhouettes, subtle
- **Medium**: 8-12 obstacles, midground elements increase
- **Dense**: 15-20 obstacles, midground crowded, skybox darker

### Mockup Description
```
┌─────────────────────────────────────────────────────────────┐
│  FOREST BIOME — MEDIUM OBSTACLES (PARALLAX)                 │
│                                                             │
│   ☁  ☁        ☁          ☁        ☁        ☁    ← Skybox  │
│    △    △        △    △        △    △        △   ← Distant │
│     △△△  △△△    △△△  △△△    △△△  △△△  △△△      ← Mid      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███  │   │  ███ = grass/forest floor
│  │  ███ ███ ▓▓▓ ███ ███ ███ ███ ▓▓▓ ███ ███ ███ ███  │   │  ▓▓▓ = fallen log
│  │  ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███  │   │  ◉ = unit
│  │  ███ ◉  ███ ███ ███ ◉  ███ ███ ███ ███ ███ ███    │   │
│  └─────────────────────────────────────────────────────┘   │
│    ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ← Fog  │
└─────────────────────────────────────────────────────────────┘
```

---

## Concept 3: "Painterly Watercolor" — Artistic Biome Wash

### Visual Style
Hand-painted watercolor aesthetic per biome. The entire battlefield is a single large canvas texture with wet-edge blending. Obstacles are **painted elements** (not separate sprites) — darker wet-in-wet strokes.

### Biome Palettes (Watercolor Swatches)

| Biome | Wash Colors | Accent Strokes | Obstacle Brushwork |
|-------|-------------|----------------|-------------------|
| **Grass** | Sap green, yellow ochre, pale cadmium | Dry-brush grass blades | Umber + Payne's gray boulders |
| **Dirt** | Burnt sienna, raw umber, yellow ochre | Salt texture (crystals) | Sepia fissures, dry-brush cracks |
| **Forest** | Hooker's green, sap green, perylene green | Lifting (light spots) | Van dyke brown logs, indigo roots |
| **Dense Forest** | Perylene green, indigo, lamp black | Masking fluid highlights | Lamp black trunks, Payne's gray |
| **Desert** | Yellow ochre, raw sienna, quinacridone gold | Granulation (cobalt) | Burnt umber rocks, dioxazine cacti |
| **Mountain** | Payne's gray, cerulean, titanium white | Dry-brush snow caps | Neutral tint cliffs, mars black scree |
| **Swamp** | Sap green + Payne's gray, sepia, indigo | Blooms (water backruns) | Sepia water, van dyke roots |
| **Snow** | Cerulean + titanium, Payne's gray, lavender | Lifting (highlights) | Payne's gray crevasses, indigo ice |

### Obstacle Density as Paint Density
- **None**: Clean wash, minimal detail — "clear day"
- **Sparse**: Few darker accents — "scattered rocks"
- **Medium**: Rich texture, visible brushwork — "overgrown"
- **Dense**: Heavy impasto, overlapping strokes — "impenetrable"

### Technical Approach
- **Pre-rendered**: One large canvas per biome × density tier (9 biomes × 4 densities = 36 textures)
- **Runtime**: Draw biome texture as background, overlay hex grid + units
- **Variation**: 3 texture variants per biome/density (seeded) for replay variety
- **Animated**: Subtle paper texture shift + pigment granulation drift (2-3 sec loop)

### Mockup Description
```
┌─────────────────────────────────────────────────────────────┐
│  DESERT BIOME — MEDIUM (WATERCOLOR)                         │
│                                                             │
│   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  │
│  ~  ╱╲  ╱╲  ~  ╱╲  ╱╲  ~  ╱╲  ╱╲  ~  ╱╲  ╱╲  ~  ← Dunes   │
│ ~  ╱░░╲╱░░╲ ~  ╱░░╲╱░░╲ ~  ╱░░╲╱░░╲ ~  ╱░░╲╱░░╲ ~  ← Sand  │
│   ╱░░░░░░░╲   ╱░░░░░░░╲   ╱░░░░░░░╲   ╱░░░░░░░╲           │
│  ~  ▓▓▓  ~  ~  ▓▓▓  ~  ~  ▓▓▓  ~  ~  ▓▓▓  ~  ~  ← Rocks    │
│   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  │
│    ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███    │  ← Hex grid overlay
│    ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███    │
└─────────────────────────────────────────────────────────────┘
```

---

## Concept 4: "Strategic Map Overlay" — Tactical Cartography

### Visual Style
**Paper map aesthetic** — the battlefield looks like a commander's field map. Biome = map terrain symbols (NATO-style or fantasy cartography). Obstacles = **map symbols** (⛰ △ ◆ ░ ▓) with clear tactical meaning.

### Biome Map Styles

| Biome | Paper Texture | Grid Style | Terrain Symbols | Obstacle Symbols |
|-------|---------------|------------|-----------------|------------------|
| **Grass** | Cream vellum, faint fold lines | Thin ink hex grid | Green tint wash | ░ Boulder, ◆ Standing stone |
| **Dirt** | Yellowed parchment, burn marks | Brown ink grid | Sepia stipple | ▓ Fissure, ◇ Sinkhole |
| **Forest** | Green-tinted paper, fiber flecks | Dark green grid | △ Tree symbols (clustered) | ▼ Fallen log, ♣ Root cluster |
| **Dense Forest** | Dark green, wax seal stains | Near-black grid | △△ Dense tree groups | ▼▼ Massive trunk (2-hex) |
| **Desert** | Sand-colored, tea-stained edges | Ochre grid | ~ Dune lines, ◆ Oasis | ▲ Rock spire, ◆ Cactus |
| **Mountain** | Grey-blue, ice crystal watermark | Slate grid | ▲▲ Contour lines, ❄ Snow | ░░ Cliff, ▓ Scree |
| **Swamp** | Mottled brown-green, water rings | Muddy grid | ~ Water, ♣ Mangrove | ░ Pool, ♣ Root tangle |
| **Snow** | Bright white, embossed texture | Ice-blue grid | ❄❄ Drift lines, △ Pine | ▓ Crevasse, ░ Ice ridge |

### Obstacle Density = Map Clutter
- **None**: Clean tactical map — "recon complete, clear terrain"
- **Sparse**: Few symbols — "scattered obstacles noted"
- **Medium**: Standard clutter — "typical terrain"
- **Dense**: Heavy annotation — "difficult going, expect delays"

### Interactive Layer
- **Hover hex** → tooltip: "Boulder (impassable)" / "Fissure (impassable)"
- **Legend panel** (toggle): Shows all symbols for current biome
- **Print mode**: High-contrast B&W for accessibility

### Mockup Description
```
┌─────────────────────────────────────────────────────────────┐
│  MOUNTAIN BIOME — DENSE (TACTICAL MAP)                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  │   │  · = grid dot
│  │  ·  ▲  ·  ▲  ·  ·  ▲  ·  ·  ▲  ·  ·  ·  ▲  ·  ·  ·  │   │  ▲ = contour
│  │  ·  ·  ░░  ·  ·  ·  ▓  ·  ·  ░░  ·  ·  ·  ·  ·  ·  │   │  ░░ = cliff
│  │  ·  ·  ·  ·  ▲  ·  ·  ·  ·  ·  ▓  ·  ·  ▲  ·  ·  ·  │   │  ▓ = scree
│  │  ·  ◉  ·  ·  ·  ·  ●  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  │   │  ◉/● = units
│  └─────────────────────────────────────────────────────┘   │
│  LEGEND:  ░░ Cliff (impassable)   ▓ Scree (impassable)     │
│           ▲ Contour (slow)        ❄ Snow (2× move cost)    │
└─────────────────────────────────────────────────────────────┘
```

---

## Concept 5: "Dynamic Living World" — Animated Biome Ecosystems

### Visual Style
**Fully animated background** — the battlefield breathes. Biome determines the ecosystem: grass sways, dust blows, fireflies drift, aurora dances. Obstacles are **living/active entities** (not static).

### Biome Animations

| Biome | Ambient Animation | Obstacle Behavior | Density Effect |
|-------|-------------------|-------------------|----------------|
| **Grass** | Grass blades sway (wind shader), butterflies | Boulders static, standing stones glow faintly at night | More obstacles = less visible grass motion |
| **Dirt** | Dust devils spiral, heat haze shimmer | Fissures pulse (subtle glow), sinkholes breathe | Dense = constant dust storms |
| **Forest** | Leaves flutter, light shafts sweep, fireflies | Logs moss pulses, roots slowly writhe | Dense = darker, more fireflies |
| **Dense Forest** | Canopy sways, heavy shadows move | Tree trunks creak (visual), vines snake | Dense = near darkness, bioluminescent fungi |
| **Desert** | Sand ripples flow, mirage shimmer | Rocks cast moving shadows, cacti bloom at dusk | Dense = sandstorm overlay |
| **Mountain** | Snow drifts, wind streaks, eagle soars | Cliffs shed occasional rocks, scree shifts | Dense = blizzard whiteout |
| **Swamp** | Bubbles rise, mist swirls, dragonflies | Pools ripple, roots pulse, will-o'-wisps | Dense = thick fog, glowing gas |
| **Snow** | Snowflakes fall, aurora waves, breath clouds | Ice creaks (crack lines appear), drifts shift | Dense = whiteout, only near units visible |

### Obstacle Density = Ecosystem Intensity
- **None**: Peaceful, clear — "calm before battle"
- **Sparse**: Subtle life — "nature watches"
- **Medium**: Active — "the land stirs"
- **Dense**: Hostile — "the biome fights back"

### Technical Approach
- **WebGL/Canvas 2D hybrid**: Background = WebGL shader (wind, particles), Grid = Canvas 2D (units, UI)
- **Performance**: Quality tiers (Low: static images, Medium: CSS animations, High: WebGL shaders)
- **Accessibility**: `prefers-reduced-motion` → static fallback (Concept 1 style)
- **Time of day**: Dawn/Day/Dusk/Night shifts palette + animation intensity

### Mockup Description
```
┌─────────────────────────────────────────────────────────────┐
│  SWAMP BIOME — MEDIUM (ANIMATED)                            │
│                                                             │
│    ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~  ~~~       │  ← Mist swirls
│     @   @    @   @    @   @    @   @    @   @    @        │  ← Fireflies
│  ~  @  ~~~  @  ~~~  @  ~~~  @  ~~~  @  ~~~  @  ~~~  @  ~  │
│   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███ ███  │   │  ███ = water/mud
│  │  ███ ███ ░░░ ███ ███ ███ ███ ░░░ ███ ███ ███ ███  │   │  ░░░ = deep pool (animated ripple)
│  │  ███ ◉  ███ ███ ███ ◉  ███ ███ ███ ███ ███ ███    │   │  ♣ = mangrove root (slow pulse)
│  │  ███ ███ ♣♣♣ ███ ███ ███ ███ ♣♣♣ ███ ███ ███ ███  │   │
│  └─────────────────────────────────────────────────────┘   │
│    ○  ○  ○  ○  ○  ○  ○  ○  ○  ○  ○  ○  ○  ○  ○  ○        │  ← Bubbles rising
└─────────────────────────────────────────────────────────────┘
```

---

## Comparison Matrix

| Criteria | Concept 1: Living Terrain | Concept 2: Atmospheric Parallax | Concept 3: Painterly Watercolor | Concept 4: Strategic Map | Concept 5: Dynamic World |
|----------|---------------------------|----------------------------------|----------------------------------|--------------------------|--------------------------|
| **Visual Distinctiveness** | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★☆☆ | ★★★★★ |
| **Biome Clarity** | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★★ | ★★★★☆ |
| **Obstacle Readability** | ★★★★★ | ★★★☆☆ | ★★★☆☆ | ★★★★★ | ★★★☆☆ |
| **Implementation Effort** | Medium (shader) | High (multi-layer) | Medium (pre-render) | Low (2D canvas) | Very High (WebGL) |
| **Performance Cost** | Low | Medium | Low | Very Low | High |
| **Accessibility** | Good | Good (disable parallax) | Good | Excellent | Fair (needs fallback) |
| **Art Pipeline** | Texture atlas | Layered assets | 36 painted textures | Symbol font/SVG | Shaders + particles |
| **Replay Variety** | High (seeded) | Medium | Medium (3 variants) | Low | High (procedural) |
| **Thematic Fit (HoMM)** | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★★ |

---

## Recommended Implementation Path

### Phase 1 (MVP) — Concept 1 + Concept 4 Hybrid
1. **Base**: Procedural biome tiles (Concept 1) — shader-based, performant
2. **Overlay**: Optional tactical symbols (Concept 4) — toggleable legend
3. **Density tiers**: 0 / Sparse / Medium / Dense via `obstacleCount` multiplier
4. **Biome detection**: Pass terrain from adventure map → battle arena

### Phase 2 — Polish
- Add Concept 3 watercolor textures as "Artistic Mode" setting
- Time-of-day palette shifts (already in engine: `timeOfDayForRound`)

### Phase 3 — Deluxe (Optional)
- Concept 2 parallax for high-end devices
- Concept 5 WebGL animations behind `prefers-reduced-motion` gate

---

## Integration Points

### Current Code Touch Points
| File | Change |
|------|--------|
| `src/screens/combat/arena/openManualBattleArena.ts` | Accept `biome: Terrain` + `obstacleDensity` options |
| `packages/engine/src/combat/manualBattle.ts` | `startManualBattle` options: add `biome`, `obstacleDensity` |
| `packages/engine/src/combat/grid.ts` | `makeBattleGrid`: biome-aware obstacle types (not just impassable) |
| `src/render/scene/sceneBuilder/battleScene.ts` | `BattleSceneInput`: add `biome`, `biomeObstacles` |
| `src/render/scene/paint2d/deps.ts` | `Paint2DDep`: add `biomeBackground` provider |

### Data Flow
```
Adventure Map Tile (Terrain)
        │
        ▼
Battle Trigger (hero collision / settlement battle)
        │
        ▼
GameActions.startBattleFlow() → openManualBattleArena()
        │                              │
        │                    biome = map.get(heroTile)
        │                    density = random/terrain-based
        ▼                              ▼
   Engine:                    Renderer:
   makeBattleGrid()          battleScene.build()
   (biome obstacles)         (biome background)
```

---

## Obstacle Density Configuration

```typescript
// In combatConfig.ts or new biomeArenaConfig.ts
export type ObstacleDensity = 'none' | 'sparse' | 'medium' | 'dense';

export const BIOME_OBSTACLE_DEFAULTS: Record<Terrain, ObstacleDensity> = {
  grass: 'sparse',
  dirt: 'sparse',
  water: 'none',      // Water battles = naval? Different system
  forest: 'medium',
  denseForest: 'dense',
  desert: 'sparse',
  mountain: 'medium',
  swamp: 'medium',
  snow: 'sparse',
};

// Multiplier applied to DEFAULT_OBSTACLE_COUNT (12)
export const DENSITY_MULTIPLIER: Record<ObstacleDensity, number> = {
  none: 0,
  sparse: 0.35,
  medium: 1.0,
  dense: 1.5,
};
```

---

## Decision Required

**Choose one primary concept for Phase 1:**

1. **Concept 1 (Living Terrain)** — Best balance of clarity, performance, biome fidelity
2. **Concept 2 (Parallax)** — Most immersive, highest art cost
3. **Concept 3 (Watercolor)** — Most distinctive art style, pre-render pipeline
4. **Concept 4 (Strategic Map)** — Best readability, lowest effort, most "HoMM"
5. **Concept 5 (Dynamic World)** — Most alive, highest tech risk, needs fallback

**Secondary choices:**
- Obstacle density: Fixed per biome? Randomized per battle? Player choice?
- Transition handling: Biome blends at territory borders?
- Settings: Quality preset (Low/Med/High) or per-feature toggles?

---

## Next Steps

1. **Review this doc** — pick primary + secondary concepts
2. **Prototype** — implement Concept 1 in worktree (shader + biome obstacle types)
3. **Playtest** — verify readability, performance, biome recognition
4. **Iterate** — add Concept 4 overlay, then Concept 3 as alt mode
5. **Merge** — PR with feature flag for gradual rollout

---

*End of design document. See `docs/design/` for any future iterations.*