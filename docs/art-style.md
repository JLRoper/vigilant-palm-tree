# Art Style

> Status: ✅ Implemented. Canonical reference for sprite art direction. Rune stone resource icons, procedural castle sprites, and hero/knight sprites have been generated.

Canonical reference for sprite art direction in heroes-js. Update this file when the direction changes; the next art agent will read it first.

## Current direction: Alchemical Rune Stones

All resource icons are small carved stone tablets, each bearing a glowing alchemical rune glyph at center. Same silhouette across all five; differentiated by stone color, rune glyph, and rune glow color.

### Why this direction

- **Distinct from the castle sprites** — castles are warm brown/yellow cottage architecture with thatched roofs. Rune stones are cool, ancient, and ritual. They will not read as miniature castles.
- **Cohesive yet distinct** — the shared silhouette + frame ties the set together visually so they look like a curated in-game item set. Each rune is geometrically different (sun vs. leaf vs. square vs. arrow vs. star) so they remain distinguishable at 24 px and at the hex-map scale (~11 px effective at 0.45x).
- **Reads well tiny** — a single central glyph + stone frame is the highest-contrast composition possible. No detail that disappears at small sizes.
- **Fits HoMM fantasy canon** — rune stones are a familiar fantasy trope; players will grok "I can pick that up."

### Composition rules

- Canvas is **32×32 px**, transparent background.
- Stone tablet is **24×24** centered at (4,4)–(27,27).
- **1 px outline** around the tablet (per-resource `outline` color), traced even through the chip pixels.
- **1 px chip** at top-left (4,4) and bottom-right (27,27) corners gives a hand-carved feel — not a clean rectangle.
- **1 px top highlight + 1 px bottom shadow** = subtle bevel.
- **1 px carved inner frame**, inset 3 px, in `stoneDk` — looks like an engraved border around the glyph area.
- Rune is centered at (16,16) and bounded by **x ∈ [10..22], y ∈ [10..22]** to leave breathing room from the inner frame.
- Each rune has 1–2 px "glow tip" pixels in `glow` color just outside the rune to suggest emitted light.
- An optional 1 px bright core (`#ffffff`) at the rune's center for arcane and gold only.

### Palette (per resource)

| Resource | Stone       | Stone Dark | Stone Hi  | Outline   | Rune     | Glow      |
|----------|-------------|------------|-----------|-----------|----------|-----------|
| Gold     | `#c8a868`   | `#7a5a30`  | `#ecd49a` | `#1a1208` | `#ffd84a`| `#fff200` |
| Wood     | `#8aa66c`   | `#4a5a30`  | `#b8c898` | `#10180a` | `#a8e860`| `#e8ffb0` |
| Stone    | `#a8a8a0`   | `#585850`  | `#d0d0c8` | `#101010` | `#e8e8e0`| `#ffffff` |
| Iron     | `#787886`   | `#383848`  | `#a0a0b0` | `#0a0a0e` | `#e87a5a`| `#ffb070` |
| Arcane   | `#5a4878`   | `#2a1838`  | `#8870a0` | `#08040a` | `#d098ff`| `#f8d8ff` |

### Rune glyph vocabulary

| Resource | Glyph                          | Alchemical reading     |
|----------|--------------------------------|------------------------|
| Gold     | filled disc + 4 cardinal rays  | Sun (☉) — alchemical gold |
| Wood     | 5-wide leaf with 4-px stem     | Sapling / leaf — alchemical wood |
| Stone    | square outline + interior cross| Earth (⊕) — alchemical earth |
| Iron     | upward arrow + crossbar        | Mars (♂) — alchemical iron |
| Arcane   | plus-sign with diamond core    | Star (✦) — quintessence |

### How to extend (adding a new resource)

1. Add an entry to `RESOURCE_PAL` with `stone`, `stoneDk`, `stoneHi`, `outline`, `rune`, `glow` colors.
2. Implement a `drawResource<Name>(ctx)` that calls `drawStone(ctx, p)` then draws the rune inside x ∈ [10..22], y ∈ [10..22].
3. Add `<canvas id="resource-<name>" width="32" height="32">` to the grid in `pixel-art.html`.
4. Add the new id to the `sprites` array in `tools/sprites/pixel-gen.mjs`.
5. Add the new `drawResource<Name>(makeCtx(...))` call in the run block of `pixel-art.html`.
6. Re-run `node tools/sprites/pixel-gen.mjs`.

### Anti-patterns

- Don't make runes fill the whole inner frame — keep the 3 px margin.
- Don't use gradients or anti-aliasing — solid pixels only.
- Don't add an opaque background — the icons need transparency to overlay the hex terrain.
- Don't drop the 1 px outline — it makes the icon legible against any terrain color.
- Don't break the shared silhouette too much — the visual cohesion comes from the shared stone shape.
- Don't draw runes that look the same at 11 px — silhouette + color is what reads, not fine detail.

## Skybox backgrounds (City View)

The city-view overlay renders a multi-layer parallax skybox behind the isometric grid. The backgrounds are digital watercolor paintings, generated via DeepInfra FLUX API and split into depth layers for parallax scrolling.

### Aesthetic direction

- **Digital watercolor** — painterly wet-on-wet technique, visible brushstrokes, soft atmospheric haze, paper-texture feel. No hard edges or cel-shading.
- **Landscapes only** — no buildings, figures, or man-made structures. The skybox is pure environment so the isometric city reads on top without competing.
- **White/light gradient at top** — sky fades to near-white, blending naturally into the adventure-map overlay dim.

### Variant catalog

| Variant | Theme       | Palette / mood                                |
|---------|-------------|-----------------------------------------------|
| 1       | Base        | Original skybox (non-FLUX, hand-authored)     |
| 2       | Mountains   | Misty blue peaks, indigo/slate washes, sunrise |
| 3       | Plains      | Rolling green hills, golden fields, afternoon  |
| 4       | Riverlands  | Winding rivers, teal/sage wetlands, lush       |

Variants 2–4 are generated via `tools/sprites/flux-skybox.mjs` and split into parallax layers (2/3/4-layer breakdowns) by `scripts/split-skybox-layers.ts`. The city view renderer draws the variant named by the global `spriteVariant` setting (`src/state/settings.ts`); it does not select a variant per settlement.

### Pipeline

1. Generate the base 1024×576 PNGs: `$env:DEEPINFRA_API_KEY="..." ; node tools/sprites/flux-skybox.mjs`
2. Split into alpha-blended parallax layers: `npm run skybox:split`
3. Output lands in `src/resources/skybox/` as `cityView-background-variant<n>-layer<m>.png`

Each variant produces 2-layer, 3-layer, and 4-layer breakdowns, all with 18% feathered band transitions so layers composite seamlessly when parallax-shifted.

### How to extend (adding a new variant)

1. Add a new entry to the `VARIANTS` map in `tools/sprites/flux-skybox.mjs` with a `variant` number, `prompt`, and `seed`.
2. Run generation and layer splitting as above.
3. Extend `spriteVariantOptions()` and the sprite-variant clamp in `src/state/settings.ts` so the new variant is selectable.

## Settlement diorama (City View backdrop, default)

The default city-view backdrop is a procedural **settlement diorama**: a floating organic terrain plate around the settlement with no skyline. It replaces the static watercolor skybox as the default; Settings → **City view backdrop** switches back to `Watercolor skybox (static variants)`.

### Per-settlement signature

`sampleCityBackdrop(map, q, r, seed)` (`packages/engine/src/map/gameMap.ts`) samples the settlement tile and its six neighbors in `NEIGHBOR_DIRS` order (E, NE, NW, W, SW, SE) and mixes a deterministic seed from `q`, `r`, and the game's `castleSeed`. `GameEngine` samples it when a city view opens and passes it through `CityView.open` → `buildCityScene` → the `citySkybox` node's `backdrop`, so the same settlement always renders the same plate.

### Biome-matched palette

This is the load-bearing art rule: **the plate palette comes from the settlement's biome and its neighbors**, never from a fixed palette. Each of the nine terrain palettes — grass, dirt, water, forest, dense forest, desert, mountain, swamp, snow — is derived from `TERRAIN_COLORS[terrain]` by mixing toward `MIST` (`#ece6d8`):

| Slot     | Derivation                          | Used by                          |
|----------|-------------------------------------|----------------------------------|
| `sky`    | `mix(fill, MIST, 0.84)`             | background gradient, upper wash  |
| `far`    | `mix(fill, MIST, 0.58)`             | distant plate tone               |
| `mid`    | `mix(fill, MIST, 0.26)`             | sector patches                   |
| `near`   | `mix(fill, MIST, 0.08)`             | plate edge, calm center, props   |
| `accent` | `mix(lighten(fill, 0.35), MIST, 0.18)` | highlights                   |

Water is a special case (`mix(fill, #d7eaf0, 0.32)`). The plate base blends the center biome at 2× and each neighbor at 1×, then mixes only 16% toward a grass/dirt calm blend (18% at the near edge, 14% at the far band) — enough to keep the area under the city calm without neutralizing the biome. Biome patch grounds use `near` mixed 18% toward the plate base. Keep the mist mixes above 0.2 out of `near`/`mid`: at 0.34/0.12 the swamp and dirt plates converged to within ~4% per channel and read as the same settlement.

### Renderer and cache

`paintCityDiorama` (`src/render/scene/paint2d/cityDiorama.ts`) is a deterministic mulberry32 renderer: ragged plate outline, cliff underside and drop shadow, radial mist mask, six neighbor sector blobs, biome paths, and per-biome props (broadleaf/conifer, boulders, peaks, mesas and cacti, reeds and pools, tufts and flowers). It draws into an offscreen canvas cached by `center|neighbors|seed|WxH|tier|dpr|footprint` under a ~24M-pixel budget (LRU), then blits at the device-pixel scale. `paintCitySkybox` in `paint2d/index.ts` early-returns to it when the node's `backdropMode` is `diorama`.

The plate is sized from the city grid's measured footprint (`CitySkyboxNode.gridFootprint`) with a tier scale (10×10 ×1.08, 15×15 ×1.16) as a floor, capped inside the viewport; the calm centre follows the same footprint, so props stay off the playable cells. The mask's fully-opaque radius moves out with the tier (0.78 / 0.86 / 0.90 of the plate radius) so a large grid never sits in the faded edge.

The city grid has **no floor**: `paintCityCell` paints only the cell outline, so the diorama ground shows through under the buildings. `cityGridLines` (Settings → City grid lines, default on) turns the outline off; hover and buildable affordances still paint.

### Constraints

- Deterministic: identical signature + viewport always yields identical pixels (the visual-regression baseline depends on it).
- No authored assets and no per-frame cost after the first draw.
- Palette changes are a visual-baseline change: justify them in the PR, per `npm run test:visual`'s header.
- The two `city-view-parallax-*` baselines pin `cityBackdrop: "skybox"`; `city-view-diorama` pins the diorama.

## Future directions (parked)

If the alchemical-stone direction needs to evolve, here are alternative directions that were considered but not chosen:

- **Old cartography map pins** — parchment-circle tokens with hand-drawn symbols, woodcut feel.
- **Mystical constellation tokens** — star-map medallions, one per constellation.
- **Heraldic animal crests** — banner shields with stylized animals.
- **Botanical dioramas** — tiny framed cross-sections (wheat ear, pine cone, crystal cluster, rusted nails, glowing mushroom).

These can be revisited; the rune-stone theme was chosen because it has the highest silhouette distinctiveness at the smallest playable scale.
